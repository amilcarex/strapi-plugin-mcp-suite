import type { Core } from "@strapi/strapi";

/**
 * Recursive populate-tree generator for `strapi.documents().findMany({populate})`.
 *
 * Strapi 5's `populate: '*'` only fetches the first level. For an entry whose
 * relations contain components that contain media that contain more relations,
 * you need an explicit tree:
 *
 *   { blocks: { populate: { cards: { populate: { image: true, author: { populate: '*' } } } } } }
 *
 * Hand-writing those trees is infeasible for an LLM. This walker reads the
 * live schema (`strapi.contentTypes`, `strapi.components`) and produces the
 * tree automatically up to `depth` levels.
 *
 * Behavior:
 *   - Scalars are omitted (no populate needed).
 *   - Relations: recurse on the target content-type with `depth - 1`.
 *   - Components: recurse on the component with `depth - 1`.
 *   - Dynamic zones: `{ on: { 'comp.uid': {...recursed...} } }` — Strapi's syntax
 *     for polymorphic dynzone population.
 *   - Media: `true` (Strapi fetches the file metadata, no sub-tree needed).
 *
 * Loop prevention: `visited` Set tracks which content-type UIDs we've already
 * entered on the current branch. If a relation points back to a UID we're
 * inside of, we return `'*'` (shallow populate) instead of recursing — this
 * keeps bidirectional relations (`A → B → A`) from spinning forever.
 *
 * System-model relations (admin users, perms) get shallow populate too — they
 * are large trees that are almost never useful to fetch in full from an MCP.
 */

const SCALAR_TYPES = [
  "string",
  "text",
  "richtext",
  "email",
  "password",
  "integer",
  "biginteger",
  "float",
  "decimal",
  "date",
  "time",
  "datetime",
  "timestamp",
  "boolean",
  "enumeration",
  "json",
  "uid",
  "blocks",
];

const SYSTEM_MODELS = [
  "admin::user",
  "admin::role",
  "admin::permission",
  "plugin::users-permissions.user",
  "plugin::users-permissions.role",
  "plugin::users-permissions.permission",
];

const IGNORED_ATTRIBUTE_NAMES = [
  "createdAt",
  "updatedAt",
  "publishedAt",
  "locale",
  "documentId",
  "id",
  "createdBy",
  "updatedBy",
];

export const MAX_POPULATE_DEPTH = 6;
export const DEFAULT_POPULATE_DEPTH = 4;

/**
 * Recursively builds a populate tree for a content-type.
 *
 * @param strapi  the live Strapi instance
 * @param uid     content-type UID (e.g. 'api::page.page')
 * @param depth   remaining recursion budget; when ≤ 0 returns '*' (shallow)
 * @param visited UIDs already entered in this branch (defaults to empty)
 * @returns populate object suitable for `strapi.documents(uid).findMany({populate})`,
 *          or `'*'` when depth is exhausted / a cycle is detected
 */
export function generateDeepPopulate(
  strapi: Core.Strapi,
  uid: string,
  depth: number = DEFAULT_POPULATE_DEPTH,
  visited: Set<string> = new Set()
): any {
  if (depth <= 0) return "*";
  if (visited.has(uid)) return "*";

  const contentType = (strapi.contentTypes as any)?.[uid];
  if (!contentType) return "*";

  const branchVisited = new Set(visited);
  branchVisited.add(uid);

  const populate: Record<string, any> = {};

  for (const [attrName, attr] of Object.entries(contentType.attributes ?? {})) {
    if (IGNORED_ATTRIBUTE_NAMES.includes(attrName)) continue;
    const a = attr as any;
    if (SCALAR_TYPES.includes(a.type)) continue;

    if (a.type === "media") {
      populate[attrName] = true;
      continue;
    }

    if (a.type === "relation") {
      if (!a.target) continue;
      if (SYSTEM_MODELS.includes(a.target)) {
        populate[attrName] = true;
      } else {
        populate[attrName] = {
          populate: generateDeepPopulate(strapi, a.target, depth - 1, branchVisited),
        };
      }
      continue;
    }

    if (a.type === "component" && a.component) {
      populate[attrName] = generateComponentPopulate(
        strapi,
        a.component,
        depth - 1,
        branchVisited
      );
      continue;
    }

    if (a.type === "dynamiczone" && Array.isArray(a.components)) {
      populate[attrName] = generateDynamicZonePopulate(
        strapi,
        a.components,
        depth - 1,
        branchVisited
      );
      continue;
    }
  }

  return populate;
}

/**
 * Recursively builds a populate node for a single component.
 *
 * Returns:
 *   - `true` if the component has no relations/components/media (nothing to expand)
 *   - `{ populate: {...} }` otherwise
 */
export function generateComponentPopulate(
  strapi: Core.Strapi,
  componentUid: string,
  depth: number,
  visited: Set<string>
): any {
  if (depth <= 0) return true;

  const component = (strapi.components as any)?.[componentUid];
  if (!component) return true;

  const componentPopulate: Record<string, any> = {};
  let hasComplexFields = false;

  for (const [attrName, attr] of Object.entries(component.attributes ?? {})) {
    const a = attr as any;
    if (SCALAR_TYPES.includes(a.type)) continue;

    if (a.type === "media") {
      componentPopulate[attrName] = true;
      hasComplexFields = true;
      continue;
    }

    if (a.type === "relation") {
      if (!a.target) continue;
      if (SYSTEM_MODELS.includes(a.target) || visited.has(a.target)) {
        componentPopulate[attrName] = true;
      } else {
        componentPopulate[attrName] = {
          populate: generateDeepPopulate(strapi, a.target, depth - 1, visited),
        };
      }
      hasComplexFields = true;
      continue;
    }

    if (a.type === "component" && a.component) {
      componentPopulate[attrName] = generateComponentPopulate(
        strapi,
        a.component,
        depth - 1,
        visited
      );
      hasComplexFields = true;
      continue;
    }

    if (a.type === "dynamiczone" && Array.isArray(a.components)) {
      componentPopulate[attrName] = generateDynamicZonePopulate(
        strapi,
        a.components,
        depth - 1,
        visited
      );
      hasComplexFields = true;
      continue;
    }
  }

  if (!hasComplexFields) return true;
  return { populate: componentPopulate };
}

/**
 * Builds the `{ on: {...} }` populate node for a dynamic zone.
 *
 * Strapi's syntax for populating a polymorphic dynzone is:
 *   { on: { 'sections.hero': { populate: '*' }, 'sections.cta': { populate: '*' } } }
 *
 * Each component is recursed independently.
 */
export function generateDynamicZonePopulate(
  strapi: Core.Strapi,
  components: string[],
  depth: number,
  visited: Set<string>
): any {
  if (depth <= 0) return { on: {} };

  const componentsPopulate: Record<string, any> = {};
  for (const componentUid of components) {
    componentsPopulate[componentUid] = generateComponentPopulate(
      strapi,
      componentUid,
      depth,
      visited
    );
  }
  return { on: componentsPopulate };
}
