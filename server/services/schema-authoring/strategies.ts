import type { Core } from "@strapi/strapi";
import type { Violation } from "./validator";

/**
 * Schema strategies — actionable responses when a component proposal exceeds
 * Strapi's UI depth limit (1 level of component nesting).
 *
 * Background: Strapi's Content-Type Builder UI rejects components that contain
 * components which themselves contain components. The validator catches this
 * with NESTED_COMPONENT_DEPTH_EXCEEDED. Before v0.5.0 the only response was
 * "error + textual suggestion". This module provides three concrete paths the
 * LLM can pick from:
 *
 *   - flat: inline the nested component's attributes into the parent (with
 *           a prefix to avoid name collisions). One JSON file, no wiring.
 *   - modular: keep components separate, but emit explicit instructions on
 *              how the user must wire them in the parent CT's schema. Best
 *              for reusable components.
 *   - dynamiczone: convert the offending attribute to a dynamiczone (which
 *                  resets Strapi's depth counter). Only applies when the
 *                  parent is a content-type.
 *
 * The flat strategy is refused for repeatable parent components, because
 * inlining "card_button_label" into a repeatable card doesn't preserve the
 * 1:N semantics the user originally expressed.
 */

export type FlattenSuccess = {
  ok: true;
  flat_attributes: Record<string, any>;
  renamed: Array<{ from: string; to: string }>;
};

export type FlattenFailure = {
  ok: false;
  reason: "PARENT_REPEATABLE" | "NESTED_NOT_FOUND" | "NAME_COLLISION";
  explanation: string;
};

export type FlattenResult = FlattenSuccess | FlattenFailure;

/**
 * Inline a nested component's attributes into the parent's attributes.
 *
 * @param strapi              live Strapi instance (used to look up the nested component)
 * @param parentAttrs         the parent component's `attributes` object (read-only)
 * @param nestedAttrName      the key in parentAttrs that holds the nested component reference
 * @param nestedComponentUid  the nested component's UID (e.g. 'atoms.button')
 *
 * Returns the new flat attributes map and a `renamed` array describing the
 * `{from: 'icon'} → {to: 'button_icon'}` pairs the LLM should be aware of.
 *
 * Refused if:
 *   - parent attribute is `repeatable: true` (semantic mismatch)
 *   - nested component doesn't exist in strapi.components
 *   - any inlined attribute name (after prefixing) would collide with an
 *     existing parent attribute
 */
export function flattenComponent(
  strapi: Core.Strapi,
  parentAttrs: Record<string, any>,
  nestedAttrName: string,
  nestedComponentUid: string
): FlattenResult {
  const parentRef = parentAttrs[nestedAttrName];
  if (parentRef?.repeatable === true) {
    return {
      ok: false,
      reason: "PARENT_REPEATABLE",
      explanation:
        `El attribute "${nestedAttrName}" del componente padre es repeatable. ` +
        `Aplanar sus campos rompería la semántica 1:N (cada "${nestedAttrName}" debería tener sus propios valores ` +
        `de los campos inlineados). Usá la estrategia "modular" o "dynamiczone" para preservar el repetible.`,
    };
  }

  const nested = (strapi.components as any)?.[nestedComponentUid];
  if (!nested) {
    return {
      ok: false,
      reason: "NESTED_NOT_FOUND",
      explanation:
        `No pude leer "${nestedComponentUid}" desde strapi.components. ` +
        `Probablemente el componente no existe todavía (creálo primero con create_component).`,
    };
  }

  const prefix = `${nestedAttrName}_`;
  const renamed: Array<{ from: string; to: string }> = [];
  const flat: Record<string, any> = {};

  for (const [k, v] of Object.entries(parentAttrs)) {
    if (k === nestedAttrName) continue;
    flat[k] = v;
  }

  for (const [innerName, innerAttr] of Object.entries(nested.attributes ?? {})) {
    const newName = `${prefix}${innerName}`;
    if (newName in flat) {
      return {
        ok: false,
        reason: "NAME_COLLISION",
        explanation:
          `El atributo "${newName}" (prefijo "${prefix}" + campo "${innerName}" del nested) ` +
          `chocaría con un atributo existente del componente padre. ` +
          `Renombrá manualmente uno de los dos o usá la estrategia "modular" para evitar el merge.`,
      };
    }
    flat[newName] = innerAttr;
    renamed.push({ from: innerName, to: newName });
  }

  return { ok: true, flat_attributes: flat, renamed };
}

export type StrategyName = "flat" | "modular" | "dynamiczone" | "as-proposed";

export interface Strategy {
  name: StrategyName;
  description: string;
  available: boolean;
  unavailable_reason?: string;
  /**
   * For `flat`: the new flat schema (replaces the original component proposal).
   * For `modular`: the parent component proposal WITHOUT the offending nested
   *                attribute (the parent stays editable, the nested component
   *                stays usable on its own; the user wires them where needed).
   * For `dynamiczone`: the parent schema with the attribute converted to dynzone.
   */
  schema?: any;
  /**
   * For `modular`: the nested component schemas that should be created standalone
   * (typically just the offending nested component). Each entry is `{uid, schema}`
   * so the LLM knows what to create with `create_component`.
   */
  side_schemas?: Array<{ uid: string; schema: any }>;
  /**
   * For `modular`: a copy-pasteable snippet the user must add to the parent CT
   * (or some other parent) to wire the relationship the MCP can't materialize
   * itself.
   */
  wiring_instructions?: string;
  trade_offs: string[];
}

/**
 * Input shape for the strategy proposer. Today only supports component proposals
 * since the validator only emits NESTED_COMPONENT_DEPTH_EXCEEDED for components.
 */
export type ComponentProposal = {
  kind: "component";
  uid: string;
  schema: { attributes: Record<string, any>; [k: string]: any };
};

export interface ProposeStrategiesResult {
  strategies: Strategy[];
  original_violation: Violation;
}

/**
 * Given a component proposal that triggered NESTED_COMPONENT_DEPTH_EXCEEDED,
 * produce the three strategy options. The validator must have already run and
 * produced the violation — this function does not re-detect it.
 *
 * The violation's `path` is parsed to extract the offending attribute name and
 * the nested component UID. Format expected (see validator.ts:354):
 *   `attributes.{attrName}.component → {nestedUid}.attributes.{innerName}`
 */
export function proposeSchemaStrategies(
  strapi: Core.Strapi,
  proposal: ComponentProposal,
  violation: Violation
): ProposeStrategiesResult {
  const parsed = parseDepthViolationPath(violation.path);
  if (!parsed) {
    // Defensive: if we can't parse the path, return a single "modular" strategy
    // with a generic explanation. Should not happen in practice.
    return {
      strategies: [genericModularFallback(proposal)],
      original_violation: violation,
    };
  }

  const { offendingAttrName, nestedUid } = parsed;
  const parentAttrs = proposal.schema?.attributes ?? {};

  return {
    strategies: [
      buildFlatStrategy(strapi, proposal, offendingAttrName, nestedUid, parentAttrs),
      buildModularStrategy(proposal, offendingAttrName, nestedUid, parentAttrs),
      buildDynamicZoneStrategy(),
      buildAsProposedStrategy(proposal, offendingAttrName, nestedUid),
    ],
    original_violation: violation,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseDepthViolationPath(
  path: string
): { offendingAttrName: string; nestedUid: string; innerAttrName: string } | null {
  // Format: "attributes.{attrName}.component → {nestedUid}.attributes.{innerName}"
  const m = path.match(/^attributes\.([^.]+)\.component → ([^.]+\.[^.]+)\.attributes\.(.+)$/);
  if (!m) return null;
  return { offendingAttrName: m[1], nestedUid: m[2], innerAttrName: m[3] };
}

function buildFlatStrategy(
  strapi: Core.Strapi,
  proposal: ComponentProposal,
  offendingAttrName: string,
  nestedUid: string,
  parentAttrs: Record<string, any>
): Strategy {
  const flat = flattenComponent(strapi, parentAttrs, offendingAttrName, nestedUid);
  if (flat.ok === false) {
    return {
      name: "flat",
      description:
        `Inlinea los campos de "${nestedUid}" dentro de "${proposal.uid}" con prefijo "${offendingAttrName}_".`,
      available: false,
      unavailable_reason: flat.explanation,
      trade_offs: [],
    };
  }

  const flatSchema = {
    ...proposal.schema,
    attributes: flat.flat_attributes,
  };
  return {
    name: "flat",
    description:
      `Aplana "${nestedUid}" dentro del componente padre. Sus campos quedan inlineados con el prefijo "${offendingAttrName}_". ` +
      `Resultado: 1 solo archivo, sin necesidad de wiring manual.`,
    available: true,
    schema: flatSchema,
    trade_offs: [
      `Pierde reutilización: "${nestedUid}" deja de existir como entidad separada dentro de este componente.`,
      `Si más adelante necesitás el mismo nested en otro componente, vas a duplicar campos.`,
      `Los renombres aplicados son: ${flat.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}.`,
    ],
  };
}

function buildModularStrategy(
  proposal: ComponentProposal,
  offendingAttrName: string,
  nestedUid: string,
  parentAttrs: Record<string, any>
): Strategy {
  // Parent without the offending nested attribute — keeps the parent legal.
  const parentMinusNested: Record<string, any> = {};
  for (const [k, v] of Object.entries(parentAttrs)) {
    if (k !== offendingAttrName) parentMinusNested[k] = v;
  }
  const parentSchemaModular = {
    ...proposal.schema,
    attributes: parentMinusNested,
  };

  // The nested component is kept as-is (assumed to exist or to be created separately
  // by the user). We don't ship a side_schema for it because we don't know its
  // current state — if it doesn't exist the user will get a clear error when they
  // try to wire it. The wiring_instructions tell them exactly what to do.
  const wiring =
    `Para usar "${nestedUid}" dentro de "${proposal.uid}", agregá manualmente el siguiente atributo al schema del PADRE ` +
    `(o de cualquier content-type que quiera usarlo) en src/components/${proposal.uid.replace(".", "/")}.json:\n\n` +
    `  "${offendingAttrName}": {\n` +
    `    "type": "component",\n` +
    `    "component": "${nestedUid}",\n` +
    `    "repeatable": ${(parentAttrs[offendingAttrName] as any)?.repeatable === true ? "true" : "false"}\n` +
    `  }\n\n` +
    `IMPORTANTE: Strapi solo permite 1 nivel de nesting de components. Si "${nestedUid}" a su vez tiene un component nested ` +
    `(que es lo que generó la violación original), el wiring va a fallar en runtime. Considerá flattenear "${nestedUid}" primero.`;

  return {
    name: "modular",
    description:
      `Crea/mantiene "${proposal.uid}" SIN la referencia a "${nestedUid}". El nested queda como componente independiente y reutilizable. ` +
      `Vos te encargás del wiring manual donde lo necesités.`,
    available: true,
    schema: parentSchemaModular,
    wiring_instructions: wiring,
    trade_offs: [
      `Componentes desacoplados: máxima reutilización de "${nestedUid}".`,
      `Requiere acción manual: el MCP no puede agregar la referencia al schema del padre por la regla de Strapi.`,
      `Si nunca agregás la referencia, el nested no aparece en ningún entry — funciona como "componente de biblioteca".`,
    ],
  };
}

function buildAsProposedStrategy(
  proposal: ComponentProposal,
  offendingAttrName: string,
  nestedUid: string
): Strategy {
  return {
    name: "as-proposed",
    description:
      `Escribe el component EXACTAMENTE como lo propusiste, conservando la profundidad. ` +
      `Esto excede el límite del Strapi Content-Type Builder UI (1 nivel), pero el backend ` +
      `(DB, REST, GraphQL, lifecycle, populate) funciona sin problemas con anidamiento más profundo. ` +
      `Para futuras modificaciones de "${proposal.uid}" tendrás que editar el JSON manualmente — ` +
      `no podrás abrirlo desde el Content-Type Builder.`,
    available: true,
    schema: proposal.schema,
    trade_offs: [
      `Máxima fidelidad: ${nestedUid} permanece como referencia anidada en "${offendingAttrName}", no se aplana ni se separa.`,
      `Pérdida de editabilidad UI: el Content-Type Builder rechaza abrir "${proposal.uid}" para editar (el botón puede aparecer en el sidebar pero la apertura va a fallar).`,
      `Otras consecuencias UI menores: el form auto-generado del Content Manager para entries que usen "${proposal.uid}" puede renderizar el atributo "${offendingAttrName}" parcialmente o no renderizarlo (la edición del entry sigue funcionando por API).`,
      `Riesgo de colaboración: alguien sin contexto que intente "arreglar" el component desde la UI puede borrar el atributo "${offendingAttrName}" sin darse cuenta. Documentá la decisión en el README o en un comentario JSON.`,
      `Migración inversa: si más adelante querés volver al modo UI-friendly, podés aplicar la estrategia "flat" o "modular" sobre el component existente.`,
    ],
  };
}

function buildDynamicZoneStrategy(): Strategy {
  return {
    name: "dynamiczone",
    description:
      `Convertir el atributo a dynamiczone. Strapi resetea el contador de profundidad ` +
      `cuando un component se llega via dynamiczone, así que la cadena queda permitida.`,
    available: false,
    unavailable_reason:
      "Dynamiczones solo pueden vivir en content-types, no en components. " +
      "Para usar esta estrategia, considerá promover el componente padre a un content-type, o aplicar el cambio desde el schema del CT que va a consumir estos components.",
    trade_offs: [
      "Si después promovés el padre a CT: dynamiczone permite múltiples instancias polimórficas.",
      "Si decidís no promover: ignorá esta opción y usá flat o modular.",
    ],
  };
}

/**
 * Apply a chosen strategy to a proposal that originally triggered a depth
 * violation. Returns the materialized schema (and any side-effects like
 * wiring_instructions) so the caller can re-validate and write.
 */
export type ApplyStrategyResult =
  | {
      ok: true;
      schema: any;
      side_schemas?: Array<{ uid: string; schema: any }>;
      wiring_instructions?: string;
      renamed?: Array<{ from: string; to: string }>;
    }
  | { ok: false; reason: string };

export function applyStrategyToProposal(
  strapi: Core.Strapi,
  proposal: ComponentProposal,
  violation: Violation,
  strategyName: StrategyName
): ApplyStrategyResult {
  const result = proposeSchemaStrategies(strapi, proposal, violation);
  const chosen = result.strategies.find((s) => s.name === strategyName);
  if (!chosen) {
    return { ok: false, reason: `Strategy "${strategyName}" no se generó para esta proposal.` };
  }
  if (!chosen.available) {
    return {
      ok: false,
      reason: chosen.unavailable_reason ?? `Strategy "${strategyName}" no disponible.`,
    };
  }
  if (!chosen.schema) {
    return { ok: false, reason: `Strategy "${strategyName}" no devolvió un schema concreto.` };
  }
  return {
    ok: true,
    schema: chosen.schema,
    side_schemas: chosen.side_schemas,
    wiring_instructions: chosen.wiring_instructions,
  };
}

function genericModularFallback(proposal: ComponentProposal): Strategy {
  return {
    name: "modular",
    description:
      `Crear "${proposal.uid}" sin las referencias nested. Solo se materializa el shell.`,
    available: true,
    schema: proposal.schema,
    wiring_instructions:
      "El path de la violación no pude parsearlo. Revisá manualmente qué componente nested está causando el problema y o aplanalo o sacalo del padre.",
    trade_offs: ["Fallback genérico — no detecté qué atributo específico causó la violación."],
  };
}
