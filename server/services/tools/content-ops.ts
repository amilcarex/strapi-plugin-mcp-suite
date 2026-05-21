import type { ToolDefinition } from "./types";
import { buildSchemaCatalog } from "../schema-derivation/build-catalog";
import { deriveContentTypeFields, deriveComponentFields } from "../schema-derivation/derive";
import {
  generateDeepPopulate,
  DEFAULT_POPULATE_DEPTH,
  MAX_POPULATE_DEPTH,
} from "../populate/deep-populate";

/**
 * Tools genéricas de gestión de contenido. Delegan a `strapi.documents()` para
 * que pasen por validación, lifecycle hooks, sanitización y D&P nativos.
 *
 * Todas reciben `uid` (api::*) y operan sobre cualquier content-type.
 */

function assertContentType(strapi: any, uid: string): any {
  const ct = strapi.contentTypes?.[uid];
  if (!ct) {
    throw new Error(
      `Content-type "${uid}" no existe. Llama a list_content_types para ver los disponibles.`
    );
  }
  if (!uid.startsWith("api::")) {
    throw new Error(
      `Solo se pueden operar content-types de proyecto (api::*). "${uid}" es interno de Strapi.`
    );
  }
  return ct;
}

/**
 * Clamps the user-provided populate_depth to [1, MAX_POPULATE_DEPTH]. The JSON
 * Schema validator should reject values outside this range before we get here,
 * but we re-clamp defensively in case the schema is bypassed (e.g. registry
 * tools that re-invoke handlers programmatically).
 */
function clampPopulateDepth(requested: unknown): number {
  const n = typeof requested === "number" && Number.isFinite(requested)
    ? Math.floor(requested)
    : DEFAULT_POPULATE_DEPTH;
  return Math.min(Math.max(1, n), MAX_POPULATE_DEPTH);
}

export const contentOpsTools: ToolDefinition[] = [
  // ── 1. list_content_types ───────────────────────────────────────────────────
  {
    name: "list_content_types",
    description:
      "Lista todos los content-types y components del proyecto (live). Después de un create_content_type + reinicio, los nuevos UIDs aparecen automáticamente. Devuelve para cada CT: uid, kind, displayName, draftAndPublish, i18n y fields formateados.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async ({ strapi }) => {
      return buildSchemaCatalog(strapi);
    },
  },

  // ── 2. get_content_type_schema ─────────────────────────────────────────────
  {
    name: "get_content_type_schema",
    description:
      "Devuelve el schema completo de un content-type o component, con los fields formateados de manera legible. Incluye expansión de components anidados si include_nested=true.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        include_nested: { type: "boolean", default: false, description: "Si true, expande recursivamente los components referenciados." },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const isComponent = !args.uid.startsWith("api::");
      const base = isComponent
        ? deriveComponentFields(strapi, args.uid)
        : deriveContentTypeFields(strapi, args.uid);
      if (!base) {
        throw new Error(`Schema "${args.uid}" no encontrado.`);
      }

      const result: any = { uid: args.uid, ...base };

      if (args.include_nested) {
        const source = isComponent
          ? (strapi.components as any)[args.uid]
          : (strapi.contentTypes as any)[args.uid];
        const nested: Record<string, any> = {};
        for (const [, attr] of Object.entries<any>(source.attributes ?? {})) {
          if (attr?.type === "component" && attr.component && !nested[attr.component]) {
            nested[attr.component] = deriveComponentFields(strapi, attr.component);
          }
          if (attr?.type === "dynamiczone" && Array.isArray(attr.components)) {
            for (const compUid of attr.components) {
              if (!nested[compUid]) {
                nested[compUid] = deriveComponentFields(strapi, compUid);
              }
            }
          }
        }
        result.nested_components = nested;
      }

      return result;
    },
  },

  // ── 3. find_entries ─────────────────────────────────────────────────────────
  {
    name: "find_entries",
    description:
      "Busca entries de un content-type. Soporta filters (sintaxis de Strapi: {field: {$eq: val}}), sort, pagination, populate y status (draft|published). Delega a strapi.documents().findMany. Para traer relations/components anidados sin armar el tree a mano, pasá populate_deep:true (auto-genera el populate recursivo hasta populate_depth niveles).",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        filters: { type: "object", description: 'Sintaxis Strapi: {"slug": {"$eq": "demo"}}.' },
        sort: { description: "Array u objeto: ['createdAt:desc']." },
        pagination: {
          type: "object",
          properties: {
            page: { type: "integer", default: 1 },
            pageSize: { type: "integer", default: 25 },
          },
        },
        populate: { description: "* | string[] | object — qué relaciones/components traer. Ignorado si populate_deep=true." },
        populate_deep: {
          type: "boolean",
          default: false,
          description: "Si true, ignora populate y auto-genera el tree recursivo hasta populate_depth niveles (relations, components, dynamiczones, media). Trade-off: queries más grandes y lentas; usá solo cuando necesités contexto completo.",
        },
        populate_depth: {
          type: "integer",
          minimum: 1,
          maximum: MAX_POPULATE_DEPTH,
          default: DEFAULT_POPULATE_DEPTH,
          description: `Profundidad del auto-populate cuando populate_deep=true. Hard cap ${MAX_POPULATE_DEPTH} para evitar explosiones combinatorias.`,
        },
        status: { type: "string", enum: ["draft", "published"] },
        locale: { type: "string" },
        fields: { description: "Lista de campos a devolver." },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      assertContentType(strapi, args.uid);
      const query: any = {};
      if (args.filters) query.filters = args.filters;
      if (args.sort) query.sort = args.sort;
      if (args.status) query.status = args.status;
      if (args.locale) query.locale = args.locale;
      if (args.fields) query.fields = args.fields;

      // populate_deep tiene precedencia sobre populate. Si ambos vienen, ignoramos
      // populate y devolvemos warning para que el LLM sepa qué pasó.
      let populateWarning: string | undefined;
      if (args.populate_deep === true) {
        const depth = clampPopulateDepth(args.populate_depth);
        query.populate = generateDeepPopulate(strapi, args.uid, depth);
        if (args.populate !== undefined) {
          populateWarning = `El argumento "populate" fue ignorado porque populate_deep=true. Se generó el tree automáticamente con depth=${depth}.`;
        }
      } else if (args.populate !== undefined) {
        query.populate = args.populate;
      }

      const page = args.pagination?.page ?? 1;
      // Cap defensivo: pageSize máximo 200 — evita que el LLM pida 100k entries
      // y revente memoria/DB. Hard cap, no override.
      const PAGE_SIZE_HARD_CAP = 200;
      const requestedPageSize = args.pagination?.pageSize ?? 25;
      const pageSize = Math.min(Math.max(1, requestedPageSize), PAGE_SIZE_HARD_CAP);
      query.start = (page - 1) * pageSize;
      query.limit = pageSize;

      const docs = await strapi.documents(args.uid as any).findMany(query);
      const total = await strapi.documents(args.uid as any).count(args.filters ? { filters: args.filters } : ({} as any));

      const result: any = {
        data: docs,
        pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
      };
      if (requestedPageSize > PAGE_SIZE_HARD_CAP) {
        result.pagination_capped = `Solicitaste pageSize=${requestedPageSize} pero el cap es ${PAGE_SIZE_HARD_CAP}. Se aplicó ${PAGE_SIZE_HARD_CAP}.`;
      }
      if (populateWarning) result.warning = populateWarning;
      return result;
    },
  },

  // ── 4. get_entry ────────────────────────────────────────────────────────────
  {
    name: "get_entry",
    description:
      "Devuelve un entry por documentId. Soporta populate, status y locale. Para traer todo el árbol de relaciones/components sin armar populate a mano, pasá populate_deep:true.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        documentId: { type: "string" },
        populate: { description: "Ignorado si populate_deep=true." },
        populate_deep: {
          type: "boolean",
          default: false,
          description: "Si true, ignora populate y auto-genera el tree recursivo hasta populate_depth niveles.",
        },
        populate_depth: {
          type: "integer",
          minimum: 1,
          maximum: MAX_POPULATE_DEPTH,
          default: DEFAULT_POPULATE_DEPTH,
          description: `Profundidad del auto-populate cuando populate_deep=true. Hard cap ${MAX_POPULATE_DEPTH}.`,
        },
        status: { type: "string", enum: ["draft", "published"] },
        locale: { type: "string" },
      },
      required: ["uid", "documentId"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      assertContentType(strapi, args.uid);

      let populate = args.populate;
      let warning: string | undefined;
      if (args.populate_deep === true) {
        const depth = clampPopulateDepth(args.populate_depth);
        populate = generateDeepPopulate(strapi, args.uid, depth);
        if (args.populate !== undefined) {
          warning = `El argumento "populate" fue ignorado porque populate_deep=true. Se generó el tree automáticamente con depth=${depth}.`;
        }
      }

      const doc = await strapi.documents(args.uid as any).findOne({
        documentId: args.documentId,
        populate,
        status: args.status,
        locale: args.locale,
      } as any);
      if (!doc) throw new Error(`Entry ${args.documentId} no encontrado en ${args.uid}.`);
      return warning ? { ...(doc as any), warning } : doc;
    },
  },

  // ── 5. create_entry ─────────────────────────────────────────────────────────
  {
    name: "create_entry",
    description:
      "Crea un entry. data debe respetar el schema vivo. Por default crea en draft (si el CT tiene draftAndPublish). Pasa status='published' para publicar inmediatamente.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        data: { type: "object" },
        status: { type: "string", enum: ["draft", "published"], default: "draft" },
        locale: { type: "string" },
      },
      required: ["uid", "data"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      assertContentType(strapi, args.uid);
      const created = await strapi.documents(args.uid as any).create({
        data: args.data,
        status: args.status ?? "draft",
        locale: args.locale,
      } as any);
      return { success: true, entry: created };
    },
  },

  // ── 6. update_entry ─────────────────────────────────────────────────────────
  {
    name: "update_entry",
    description:
      "Actualiza un entry por documentId. data hace merge parcial (solo los campos enviados se modifican).",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        documentId: { type: "string" },
        data: { type: "object" },
        status: { type: "string", enum: ["draft", "published"] },
        locale: { type: "string" },
      },
      required: ["uid", "documentId", "data"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      assertContentType(strapi, args.uid);
      const updated = await strapi.documents(args.uid as any).update({
        documentId: args.documentId,
        data: args.data,
        status: args.status,
        locale: args.locale,
      } as any);
      return { success: true, entry: updated };
    },
  },

  // ── 7. delete_entry ─────────────────────────────────────────────────────────
  {
    name: "delete_entry",
    description:
      "Elimina un entry (draft + published) por documentId. REQUIERE confirm:true.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        documentId: { type: "string" },
        confirm: { type: "boolean" },
        locale: { type: "string" },
      },
      required: ["uid", "documentId", "confirm"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      assertContentType(strapi, args.uid);
      if (args.confirm !== true) {
        throw new Error(`delete_entry requiere confirm:true. Esta acción borra el entry ${args.documentId} en ${args.uid}.`);
      }
      const result = await strapi.documents(args.uid as any).delete({
        documentId: args.documentId,
        locale: args.locale,
      } as any);
      return { success: true, deleted: result };
    },
  },

  // ── 8. publish_entry ────────────────────────────────────────────────────────
  {
    name: "publish_entry",
    description:
      "Publica el draft de un entry (solo CTs con draftAndPublish:true). REQUIERE confirm:true.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        documentId: { type: "string" },
        confirm: { type: "boolean" },
        locale: { type: "string" },
      },
      required: ["uid", "documentId", "confirm"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const ct = assertContentType(strapi, args.uid);
      if (!ct.options?.draftAndPublish) {
        throw new Error(`Content-type "${args.uid}" no tiene draftAndPublish habilitado.`);
      }
      if (args.confirm !== true) {
        throw new Error(`publish_entry requiere confirm:true.`);
      }
      const result = await strapi.documents(args.uid as any).publish({
        documentId: args.documentId,
        locale: args.locale,
      } as any);
      return { success: true, result };
    },
  },

  // ── 9. unpublish_entry ──────────────────────────────────────────────────────
  {
    name: "unpublish_entry",
    description:
      "Despublica un entry (lo deja solo como draft). REQUIERE confirm:true.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        documentId: { type: "string" },
        confirm: { type: "boolean" },
        locale: { type: "string" },
      },
      required: ["uid", "documentId", "confirm"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const ct = assertContentType(strapi, args.uid);
      if (!ct.options?.draftAndPublish) {
        throw new Error(`Content-type "${args.uid}" no tiene draftAndPublish habilitado.`);
      }
      if (args.confirm !== true) {
        throw new Error(`unpublish_entry requiere confirm:true.`);
      }
      const result = await strapi.documents(args.uid as any).unpublish({
        documentId: args.documentId,
        locale: args.locale,
      } as any);
      return { success: true, result };
    },
  },
];
