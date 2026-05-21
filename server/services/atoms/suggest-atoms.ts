import type { Core } from "@strapi/strapi";

/**
 * Repeated-field-pattern analyzer for the `suggest_reusable_atoms` tool.
 *
 * Walks every component and content-type in the project, counts how often each
 * `(fieldName, type)` pattern appears, and flags the ones repeated enough to be
 * worth promoting into a reusable atom component.
 *
 * The motivating case: a project where `title: string` is copy-pasted into 8
 * different section components. Each one is an independent field — change the
 * design intent (e.g. "headings should support an h-tag and an alignment") and
 * you have 8 places to edit. Promoting `title` to `atoms.heading` once and
 * referencing it everywhere collapses that to a single source of truth.
 *
 * This module is pure analysis — it never writes. It produces an execution
 * plan (concrete `create_component` + `modify_schema` calls) the caller can run
 * after human review.
 */

const IGNORED_FIELD_NAMES = new Set([
  "id",
  "documentId",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "createdBy",
  "updatedBy",
  "locale",
  "localizations",
]);

/** Scalar types whose repetition is worth promoting. */
const PROMOTABLE_TYPES = new Set(["string", "text", "richtext"]);

/**
 * Field names that map to a known richer atom. The schema here is a STARTER —
 * the caller is expected to enrich it (add variants, options) before applying.
 */
const ENRICHMENT: Record<string, { atomUid: string; schema: any }> = {
  title: {
    atomUid: "atoms.heading",
    schema: {
      info: { displayName: "Heading", icon: "feather", description: "Encabezado reutilizable con tag y alineación" },
      attributes: {
        text: { type: "string", required: true },
        tag: { type: "enumeration", enum: ["h1", "h2", "h3", "h4", "h5", "h6", "p"], default: "h2" },
        align: { type: "enumeration", enum: ["left", "center", "right"], default: "left" },
      },
    },
  },
  heading: { atomUid: "atoms.heading", schema: null as any },
  headline: { atomUid: "atoms.heading", schema: null as any },
  eyebrow: {
    atomUid: "atoms.eyebrow",
    schema: {
      info: { displayName: "Eyebrow", icon: "feather", description: "Texto pequeño sobre el título" },
      attributes: {
        text: { type: "string", required: true },
        color: { type: "string" },
      },
    },
  },
  icon: {
    atomUid: "atoms.icon",
    schema: {
      info: { displayName: "Icon", icon: "cube", description: "Icono reutilizable (nombre del set + tamaño + color)" },
      attributes: {
        name: { type: "string", required: true },
        size: { type: "enumeration", enum: ["sm", "md", "lg", "xl"], default: "md" },
        color: { type: "string" },
      },
    },
  },
  badge: {
    atomUid: "atoms.badge",
    schema: {
      info: { displayName: "Badge", icon: "bell", description: "Etiqueta/pill reutilizable" },
      attributes: {
        text: { type: "string", required: true },
        variant: { type: "enumeration", enum: ["neutral", "info", "success", "warning"], default: "neutral" },
      },
    },
  },
};
// heading/headline reuse the title schema.
ENRICHMENT.heading.schema = ENRICHMENT.title.schema;
ENRICHMENT.headline.schema = ENRICHMENT.title.schema;

export type Recommendation = "promote" | "review" | "already_component";

export interface AtomCandidate {
  field_name: string;
  type: string;
  occurrences: number;
  used_in: string[];
  recommendation: Recommendation;
  rationale: string;
  suggested_atom?: { uid: string; schema: any };
  execution_plan?: Array<{ step: number; tool: string; args: any; note?: string }>;
  depth_warnings?: string[];
  data_migration_note?: string;
}

export interface SuggestAtomsResult {
  scope: string;
  min_occurrences: number;
  candidates: AtomCandidate[];
  summary: string;
  notes: string[];
}

type FieldOccurrence = { schemaUid: string; field: any };

/**
 * Builds the set of UIDs that are nested inside ANOTHER component (i.e. they
 * are referenced via a `component`-type attribute somewhere). Promoting a
 * scalar field to a component reference inside one of these would push the
 * consumer to depth 2 — which the Strapi CTB UI rejects. We surface that as a
 * warning, not a hard block.
 */
function buildNestedUidSet(strapi: Core.Strapi): Set<string> {
  const nested = new Set<string>();
  const scan = (attrs: any) => {
    for (const a of Object.values<any>(attrs ?? {})) {
      if (a?.type === "component" && a.component) nested.add(a.component);
      if (a?.type === "dynamiczone" && Array.isArray(a.components)) {
        for (const c of a.components) nested.add(c);
      }
    }
  };
  for (const comp of Object.values<any>((strapi.components as any) ?? {})) {
    scan(comp.attributes);
  }
  return nested;
}

export function suggestReusableAtoms(
  strapi: Core.Strapi,
  opts: { scope?: "all" | "components" | "content-types"; minOccurrences?: number } = {}
): SuggestAtomsResult {
  const scope = opts.scope ?? "all";
  const minOccurrences = Math.max(2, opts.minOccurrences ?? 3);

  // ── Collect every (fieldName, type) occurrence in scope ──
  const patterns = new Map<string, FieldOccurrence[]>();
  const collect = (schemaUid: string, attrs: any) => {
    for (const [fieldName, field] of Object.entries<any>(attrs ?? {})) {
      if (IGNORED_FIELD_NAMES.has(fieldName)) continue;
      if (!field?.type) continue;
      const key = `${fieldName}|${field.type}`;
      if (!patterns.has(key)) patterns.set(key, []);
      patterns.get(key)!.push({ schemaUid, field });
    }
  };

  if (scope === "all" || scope === "components") {
    for (const [uid, comp] of Object.entries<any>((strapi.components as any) ?? {})) {
      collect(uid, comp.attributes);
    }
  }
  if (scope === "all" || scope === "content-types") {
    for (const [uid, ct] of Object.entries<any>((strapi.contentTypes as any) ?? {})) {
      if (!uid.startsWith("api::")) continue; // solo CTs de proyecto
      collect(uid, ct.attributes);
    }
  }

  const nestedUids = buildNestedUidSet(strapi);
  const candidates: AtomCandidate[] = [];

  for (const [key, occ] of patterns.entries()) {
    if (occ.length < minOccurrences) continue;
    const [fieldName, type] = key.split("|");
    const usedIn = occ.map((o) => o.schemaUid).sort();

    // Already a component → it's reusable by definition. Informational only.
    if (type === "component") {
      candidates.push({
        field_name: fieldName,
        type,
        occurrences: occ.length,
        used_in: usedIn,
        recommendation: "already_component",
        rationale: `"${fieldName}" ya es un component referenciado en ${occ.length} schemas — ya es reutilizable. Sin acción necesaria.`,
      });
      continue;
    }

    if (!PROMOTABLE_TYPES.has(type)) {
      // Repeated scalar but not a text-like field (boolean/enum/number/etc.).
      // Repetition is usually fine; flag as "review" without a plan.
      candidates.push({
        field_name: fieldName,
        type,
        occurrences: occ.length,
        used_in: usedIn,
        recommendation: "review",
        rationale: `"${fieldName}" (${type}) se repite en ${occ.length} schemas. Promover tipos no-textuales a component raramente vale la pena — revisá si la repetición es un problema real.`,
      });
      continue;
    }

    // Promotable: build the suggestion + execution plan.
    const enrich = ENRICHMENT[fieldName];
    const atomUid = enrich?.atomUid ?? `atoms.${fieldName}`;
    const [atomCategory, atomName] = atomUid.split(".");
    const innerFieldName = enrich ? "text" : "value";
    const atomSchema = enrich
      ? {
          collectionName: `components_${atomCategory}_${atomName.replace(/-/g, "_")}s`,
          ...enrich.schema,
        }
      : {
          collectionName: `components_${atomCategory}_${atomName.replace(/-/g, "_")}s`,
          info: { displayName: atomName, description: `Atom reutilizable promovido desde el campo "${fieldName}"` },
          attributes: { [innerFieldName]: { type } },
        };

    const depthWarnings: string[] = [];
    for (const uid of usedIn) {
      if (nestedUids.has(uid)) {
        depthWarnings.push(
          `"${uid}" ya está anidado dentro de otro component. Promover "${fieldName}" a component ahí crea profundidad 2 — el Strapi CTB UI no podrá editar el parent. Usá create_component con strategy 'as-proposed' si aceptás ese trade-off.`
        );
      }
    }

    const plan: AtomCandidate["execution_plan"] = [
      {
        step: 1,
        tool: "create_component",
        args: { category: atomCategory, name: atomName, schema: atomSchema },
        note: `Crea el atom "${atomUid}". ENRIQUECÉ el schema antes de aplicar — esto es un starter.`,
      },
    ];
    usedIn.forEach((uid, i) => {
      plan.push({
        step: i + 2,
        tool: "modify_schema",
        args: {
          uid,
          remove: [fieldName],
          add: [
            {
              field_name: fieldName,
              field: { type: "component", component: atomUid, repeatable: false },
            },
          ],
        },
        note: `Reemplaza el campo escalar "${fieldName}" en "${uid}" por la referencia al atom.`,
      });
    });

    candidates.push({
      field_name: fieldName,
      type,
      occurrences: occ.length,
      used_in: usedIn,
      recommendation: "promote",
      rationale: `"${fieldName}" (${type}) aparece en ${occ.length} schemas como campo escalar suelto. Promoverlo a "${atomUid}" centraliza la definición: un cambio de diseño se hace una vez.`,
      suggested_atom: { uid: atomUid, schema: atomSchema },
      execution_plan: plan,
      depth_warnings: depthWarnings.length > 0 ? depthWarnings : undefined,
      data_migration_note: `Los entries existentes tienen valores en el campo escalar "${fieldName}". Al promoverlo a component, esos valores NO migran automáticamente — hay que moverlos manualmente (o vía script) al campo "${innerFieldName}" del component nuevo. Hacé esto en una ventana de mantenimiento.`,
    });
  }

  // Orden: promote primero (por occurrences desc), después review, después already_component.
  const tierRank: Record<Recommendation, number> = { promote: 0, review: 1, already_component: 2 };
  candidates.sort((a, b) => {
    if (tierRank[a.recommendation] !== tierRank[b.recommendation]) {
      return tierRank[a.recommendation] - tierRank[b.recommendation];
    }
    return b.occurrences - a.occurrences;
  });

  const promoteCount = candidates.filter((c) => c.recommendation === "promote").length;
  return {
    scope,
    min_occurrences: minOccurrences,
    candidates,
    summary:
      promoteCount > 0
        ? `${promoteCount} candidato(s) fuertes para promover a atoms reutilizables. ${candidates.length} patrones repetidos en total.`
        : `Ningún candidato fuerte de promoción. ${candidates.length} patrones repetidos detectados (revisá los 'review').`,
    notes: [
      "Esta tool NO escribe nada — es análisis puro.",
      "Los schemas en suggested_atom son STARTERS: enriquecelos (variants, options) antes de ejecutar.",
      "execution_plan es ejecutable: create_component + un modify_schema por cada consumidor.",
      "Cada promoción de campo escalar a component requiere migración manual de datos — ver data_migration_note.",
    ],
  };
}
