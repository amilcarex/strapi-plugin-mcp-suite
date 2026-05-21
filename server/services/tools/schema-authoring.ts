import type { ToolDefinition } from "./types";
import { buildSchemaCatalog } from "../schema-derivation/build-catalog";
import {
  validateSchemaProposal,
  type SchemaProposal,
  type ValidationResult,
} from "../schema-authoring/validator";
import {
  writeFiles,
  readJson,
  pathsForComponent,
  pathsForContentType,
  controllerStub,
  routerStub,
  serviceStub,
  isProduction,
  productionRefusal,
  buildRestartInfo,
  type FileToWrite,
} from "../schema-authoring/writer";
import { acquirePathLock } from "../path-lock";
import {
  proposeSchemaStrategies,
  applyStrategyToProposal,
  type StrategyName,
} from "../schema-authoring/strategies";
import { suggestReusableAtoms } from "../atoms/suggest-atoms";

const VALID_STRATEGY_NAMES = ["flat", "modular", "dynamiczone", "as-proposed"] as const;

function hasErrors(v: ValidationResult): boolean {
  return v.violations.some((x) => x.severity === "error");
}

/**
 * Resolves the absolute schema.json path for a content-type UID (api::*) or a
 * component UID (category.name). Shared by add/delete/modify tools.
 */
function resolveSchemaPath(uid: string): string {
  const isComponent = !uid.startsWith("api::");
  return isComponent
    ? pathsForComponent(uid.split(".")[0], uid.split(".")[1])[0].path
    : pathsForContentType(uid.replace(/^api::/, "").split(".")[0]).schema;
}

/**
 * Scans every content-type and component for relations that point AT
 * `uid.fieldName` via inversedBy/mappedBy. Returns the blockers — deleting a
 * field that another schema's relation depends on would leave a dangling
 * reciprocal. Reused by delete_field_from_schema and modify_schema.
 */
function findRelationBlockers(
  strapi: any,
  uid: string,
  fieldName: string
): { from: string; via: string; reason: string }[] {
  const blockers: { from: string; via: string; reason: string }[] = [];
  const scan = (uidFrom: string, attrs: any) => {
    for (const [n, a] of Object.entries<any>(attrs ?? {})) {
      if (
        a?.type === "relation" &&
        a.target === uid &&
        (a.inversedBy === fieldName || a.mappedBy === fieldName)
      ) {
        blockers.push({
          from: uidFrom,
          via: n,
          reason: `tiene ${a.inversedBy ? "inversedBy" : "mappedBy"}="${fieldName}"`,
        });
      }
    }
  };
  for (const [otherUid, ct] of Object.entries<any>(strapi.contentTypes ?? {})) {
    if (otherUid !== uid) scan(otherUid, (ct as any).attributes);
  }
  for (const [otherUid, comp] of Object.entries<any>(strapi.components ?? {})) {
    if (otherUid !== uid) scan(otherUid, (comp as any).attributes);
  }
  return blockers;
}

function buildAuthoringResponse(
  validation: ValidationResult,
  writeResult: any,
  extra?: Record<string, any>
) {
  return {
    success: true,
    validation,
    ...writeResult,
    ...(extra ?? {}),
  };
}

export const schemaAuthoringTools: ToolDefinition[] = [
  // ── 1. list_existing_schemas ────────────────────────────────────────────────
  {
    name: "list_existing_schemas",
    description:
      "Enumera todos los content-types (api::*) y components del proyecto Strapi. Devuelve UIDs, displayName, descripción, kind, y atributos formateados. Útil ANTES de crear un nuevo schema para evitar colisiones de nombre o reusar uno existente.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async ({ strapi }) => {
      return buildSchemaCatalog(strapi);
    },
  },

  // ── 2. read_schema ──────────────────────────────────────────────────────────
  {
    name: "read_schema",
    description:
      "Lee el schema.json crudo de un content-type (uid api::*) o component. Requisito previo de add_field_to_schema/delete_field_from_schema. Devuelve también la lista de referencias inversas (qué otros schemas apuntan a este).",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "UID del content-type (ej: api::article.article) o component (ej: shared.media).",
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const { uid } = args;
      const isComponent = !uid.startsWith("api::");
      const source = isComponent
        ? (strapi.components as any)?.[uid]
        : (strapi.contentTypes as any)?.[uid];
      if (!source) {
        throw new Error(`Schema "${uid}" no encontrado en strapi.${isComponent ? "components" : "contentTypes"}.`);
      }

      // Inverse references: qué schemas apuntan a este uid
      const incoming: { from: string; via: string; type: string }[] = [];
      const scan = (uidFrom: string, attrs: any, kind: "component" | "content-type") => {
        for (const [name, attr] of Object.entries<any>(attrs ?? {})) {
          if (attr?.type === "component" && attr.component === uid) {
            incoming.push({ from: uidFrom, via: name, type: `component (${kind})` });
          }
          if (attr?.type === "dynamiczone" && Array.isArray(attr.components) && attr.components.includes(uid)) {
            incoming.push({ from: uidFrom, via: name, type: `dynamiczone (${kind})` });
          }
          if (attr?.type === "relation" && attr.target === uid) {
            incoming.push({ from: uidFrom, via: name, type: `relation:${attr.relation} (${kind})` });
          }
        }
      };
      for (const [otherUid, ct] of Object.entries<any>(strapi.contentTypes as any ?? {})) {
        if (otherUid !== uid) scan(otherUid, ct.attributes, "content-type");
      }
      for (const [otherUid, comp] of Object.entries<any>(strapi.components as any ?? {})) {
        if (otherUid !== uid) scan(otherUid, comp.attributes, "component");
      }

      return {
        uid,
        kind: isComponent ? "component" : source.kind ?? "collectionType",
        schema: {
          kind: source.kind,
          collectionName: source.collectionName,
          info: source.info,
          options: source.options,
          pluginOptions: source.pluginOptions,
          attributes: source.attributes,
        },
        incoming_references: incoming,
      };
    },
  },

  // ── 3. validate_schema_proposal ─────────────────────────────────────────────
  {
    name: "validate_schema_proposal",
    description:
      "Valida una propuesta de schema SIN ESCRIBIRLA. Detecta: NESTED_COMPONENT_DEPTH_EXCEEDED (Strapi UI solo permite 1 nivel de anidamiento de components), RESERVED_ATTRIBUTE_NAME (id, createdAt, etc.), INVALID_NAME, MISSING_REQUIRED_PROP, UNKNOWN_REFERENCE, CIRCULAR_REFERENCE, RELATION_RECIPROCITY_MISSING, COLLISION_COLLECTION_NAME. Devuelve {valid, violations[], warnings[]}.",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "UID propuesto (ej: api::demo.demo o atoms.button).",
        },
        kind: {
          type: "string",
          enum: ["content-type", "component"],
        },
        schema: {
          type: "object",
          description: "Schema completo propuesto (kind, collectionName, info, attributes, etc.).",
        },
        mode: {
          type: "string",
          enum: ["create", "update"],
          default: "create",
        },
      },
      required: ["uid", "kind", "schema"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const proposal: SchemaProposal = {
        uid: args.uid,
        kind: args.kind,
        schema: args.schema,
      };
      return validateSchemaProposal(strapi, proposal, args.mode ?? "create");
    },
  },

  // ── 4. create_component ─────────────────────────────────────────────────────
  {
    name: "create_component",
    description:
      "Crea un component nuevo escribiendo src/components/{category}/{name}.json. DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. La respuesta incluye `restart_info` con el tiempo estimado; espera ese período antes de la próxima llamada al MCP. Usa la tool `__health` para verificar que Strapi volvió. Valida la propuesta automáticamente — abortado si hay violations (a menos que force=true para warnings). Usa dry_run=true para ver qué se escribiría sin escribir. Si la propuesta excede el límite de profundidad del Strapi UI (1 nivel de nesting de components), la respuesta incluye `strategies` (flat/modular/dynamiczone) — vuelve a llamar con strategy:'flat' (o 'modular') para materializar la opción elegida.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Categoría del component (kebab-case). Ej: 'shared', 'atoms', 'molecules'." },
        name: { type: "string", description: "Nombre del component (kebab-case, sin extensión). Ej: 'button-cta'." },
        schema: {
          type: "object",
          description: "Schema del component: { collectionName, info: {displayName, icon?, description?}, options?, attributes }.",
        },
        strategy: {
          type: "string",
          enum: [...VALID_STRATEGY_NAMES],
          description: "Solo aplica si la propuesta original disparó NESTED_COMPONENT_DEPTH_EXCEEDED. Materializa la estrategia elegida (flat | modular | dynamiczone | as-proposed) en vez de rechazar la escritura. La estrategia 'as-proposed' es un escape hatch: escribe el schema EXACTAMENTE como lo enviaste, con un warning de que el component no será editable desde el Strapi Content-Type Builder UI (Strapi backend lo soporta perfecto).",
        },
        dry_run: { type: "boolean", default: false },
        force: { type: "boolean", default: false, description: "Suprime warnings (no errors)." },
        backup: { type: "boolean", default: true },
      },
      required: ["category", "name", "schema"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (isProduction()) productionRefusal();

      const uid = `${args.category}.${args.name}`;
      let effectiveSchema = args.schema;
      let strategyApplied: { name: StrategyName; wiring_instructions?: string } | undefined;

      // First-pass validation against the LLM's original proposal.
      const initialValidation = validateSchemaProposal(
        strapi,
        { uid, kind: "component", schema: args.schema },
        "create"
      );

      const depthViolation = initialValidation.violations.find(
        (v) => v.code === "NESTED_COMPONENT_DEPTH_EXCEEDED"
      );

      if (depthViolation) {
        // The LLM didn't pick a strategy yet — return the options without writing.
        if (!args.strategy) {
          const result = proposeSchemaStrategies(
            strapi,
            { kind: "component", uid, schema: args.schema },
            depthViolation
          );
          return {
            success: false,
            validation: initialValidation,
            strategies: result.strategies,
            hint: "Tu propuesta excede el límite de profundidad del Strapi UI. Elige una estrategia (flat | modular | dynamiczone) y vuelve a llamar con `strategy: '<nombre>'` para materializarla.",
            restart_required: false,
          };
        }

        // Strategy chosen — apply it and continue with the materialized schema.
        const applied = applyStrategyToProposal(
          strapi,
          { kind: "component", uid, schema: args.schema },
          depthViolation,
          args.strategy as StrategyName
        );
        if (applied.ok === false) {
          return {
            success: false,
            validation: initialValidation,
            error: `Strategy "${args.strategy}" no se pudo aplicar: ${applied.reason}`,
            restart_required: false,
          };
        }
        effectiveSchema = applied.schema;
        strategyApplied = { name: args.strategy, wiring_instructions: applied.wiring_instructions };
      }

      // Re-validate (post-strategy or original if no strategy involved).
      let validation = strategyApplied
        ? validateSchemaProposal(
            strapi,
            { uid, kind: "component", schema: effectiveSchema },
            "create"
          )
        : initialValidation;

      // The "as-proposed" escape hatch consciously accepts the depth violation
      // (Strapi backend handles it fine; only the CTB UI rejects it). Strip the
      // NESTED_COMPONENT_DEPTH_EXCEEDED violation from the re-validation so the
      // write can proceed, but downgrade it to a warning so the trade-off
      // remains documented in the response.
      if (strategyApplied?.name === "as-proposed") {
        const depthErrors = validation.violations.filter(
          (v) => v.code === "NESTED_COMPONENT_DEPTH_EXCEEDED"
        );
        validation = {
          ...validation,
          violations: validation.violations.filter(
            (v) => v.code !== "NESTED_COMPONENT_DEPTH_EXCEEDED"
          ),
          warnings: [
            ...validation.warnings,
            ...depthErrors.map((v) => ({
              ...v,
              severity: "warning" as const,
              message: `[as-proposed strategy] ${v.message} — aceptado conscientemente; el component no será editable desde el Content-Type Builder UI.`,
            })),
          ],
          valid: validation.violations.filter(
            (v) => v.code !== "NESTED_COMPONENT_DEPTH_EXCEEDED" && v.severity === "error"
          ).length === 0,
        };
      }

      if (hasErrors(validation)) {
        return { success: false, validation, restart_required: false };
      }
      // Bypass the warning-confirmation gate when strategy='as-proposed' was
      // explicitly chosen: the user already accepted the trade-off by picking
      // that strategy, requiring force=true on top would be double-confirmation.
      const bypassWarningGate = strategyApplied?.name === "as-proposed";
      if (validation.warnings.length > 0 && !args.force && !bypassWarningGate) {
        return {
          success: false,
          validation,
          hint: "Hay warnings. Revísalas y vuelve a llamar con force=true si quieres escribir igual.",
          restart_required: false,
        };
      }

      const filePath = pathsForComponent(args.category, args.name)[0].path;
      const files: FileToWrite[] = [
        { path: filePath, content: JSON.stringify(effectiveSchema, null, 2) + "\n" },
      ];

      if (args.dry_run) {
        return {
          dry_run: true,
          validation,
          files_to_write: files,
          restart_required: true,
          restart_info: buildRestartInfo(),
          ...(strategyApplied ? { strategy_applied: strategyApplied } : {}),
        };
      }

      const writeResult = await writeFiles(files, { backup: args.backup ?? true });
      return buildAuthoringResponse(validation, writeResult, {
        uid,
        ...(strategyApplied ? { strategy_applied: strategyApplied } : {}),
      });
    },
  },

  // ── 5. create_content_type ──────────────────────────────────────────────────
  {
    name: "create_content_type",
    description:
      "Crea un content-type nuevo: escribe schema.json + controllers/routes/services stubs (factories one-liners). DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. La respuesta incluye `restart_info` con el tiempo estimado; espera ese período antes de la próxima llamada al MCP. Usa la tool `__health` para verificar que Strapi volvió. Valida automáticamente. Strapi v5 NO autogenera controllers/routes/services — sin estos archivos los endpoints REST no se registran.",
    inputSchema: {
      type: "object",
      properties: {
        singular_name: {
          type: "string",
          description: "Nombre singular kebab-case. Ej: 'product'. Genera UID api::product.product.",
        },
        plural_name: {
          type: "string",
          description: "Nombre plural kebab-case. Ej: 'products'.",
        },
        display_name: { type: "string", description: "Display name para el admin UI. Ej: 'Product'." },
        description: { type: "string", default: "" },
        kind: { type: "string", enum: ["collectionType", "singleType"], default: "collectionType" },
        draft_and_publish: { type: "boolean", default: true },
        i18n: { type: "boolean", default: false },
        collection_name: {
          type: "string",
          description: "Nombre de la tabla en DB (snake_case plural). Default: plural_name con guiones → snake.",
        },
        attributes: {
          type: "object",
          description: "Atributos del content-type (sin id/documentId/timestamps que Strapi agrega).",
        },
        dry_run: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        backup: { type: "boolean", default: true },
      },
      required: ["singular_name", "plural_name", "display_name", "attributes"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (isProduction()) productionRefusal();

      const singularName = args.singular_name;
      const pluralName = args.plural_name;
      const uid = `api::${singularName}.${singularName}`;
      const collectionName = args.collection_name ?? pluralName.replace(/-/g, "_");

      const schema: any = {
        kind: args.kind ?? "collectionType",
        collectionName,
        info: {
          singularName,
          pluralName,
          displayName: args.display_name,
          description: args.description ?? "",
        },
        options: { draftAndPublish: args.draft_and_publish ?? true },
        pluginOptions: args.i18n ? { i18n: { localized: true } } : {},
        attributes: args.attributes ?? {},
      };

      const validation = validateSchemaProposal(strapi, { uid, kind: "content-type", schema }, "create");

      if (hasErrors(validation)) {
        return { success: false, validation, restart_required: false };
      }
      if (validation.warnings.length > 0 && !args.force) {
        return {
          success: false,
          validation,
          hint: "Hay warnings. Revísalas y vuelve a llamar con force=true si quieres escribir igual.",
          restart_required: false,
        };
      }

      const paths = pathsForContentType(singularName);
      const files: FileToWrite[] = [
        { path: paths.schema, content: JSON.stringify(schema, null, 2) + "\n" },
        { path: paths.controller, content: controllerStub(singularName) },
        { path: paths.router, content: routerStub(singularName) },
        { path: paths.service, content: serviceStub(singularName) },
      ];

      if (args.dry_run) {
        return {
          dry_run: true,
          validation,
          files_to_write: files,
          restart_required: true,
          restart_info: buildRestartInfo(),
        };
      }

      const writeResult = await writeFiles(files, { backup: args.backup ?? true });
      return buildAuthoringResponse(validation, writeResult, {
        uid,
        rest_endpoint: `/api/${pluralName}`,
      });
    },
  },

  // ── 6. add_field_to_schema ──────────────────────────────────────────────────
  {
    name: "add_field_to_schema",
    description:
      "Agrega UN atributo nuevo a un schema existente (content-type o component). Lee el schema.json del filesystem, agrega el atributo, valida la propuesta completa, escribe. DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. Mira `restart_info` en la respuesta y espera ese tiempo; usa `__health` para confirmar que volvió. ⚠️ Si necesitas agregar VARIOS campos al mismo schema, NO llames esta tool repetidamente — usá `add_fields_to_schema` (plural, batch) que aplica N campos en un solo restart. Hace backup .bak.{timestamp} antes de overwrite.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID del schema (api::* o category.name)." },
        field_name: { type: "string" },
        field: {
          type: "object",
          description: "Definición del atributo (type, required, etc.).",
        },
        dry_run: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        backup: { type: "boolean", default: true },
      },
      required: ["uid", "field_name", "field"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (isProduction()) productionRefusal();

      const isComponent = !args.uid.startsWith("api::");
      const sourcePath = isComponent
        ? pathsForComponent(args.uid.split(".")[0], args.uid.split(".")[1])[0].path
        : pathsForContentType(args.uid.replace(/^api::/, "").split(".")[0]).schema;

      // Lock por path para serializar read+modify+write. Si dos llamadas
      // concurrentes intentan modificar el mismo schema, la segunda espera a
      // que la primera termine — evita lost writes (H2).
      const release = await acquirePathLock(sourcePath);
      try {
        let schema: any;
        try {
          schema = await readJson(sourcePath);
        } catch (err) {
          throw new Error(`No pude leer schema.json en ${sourcePath}: ${(err as Error).message}`);
        }

        if (schema.attributes?.[args.field_name]) {
          throw new Error(
            `El atributo "${args.field_name}" ya existe en "${args.uid}". Usa delete_field_from_schema primero, o renómbralo.`
          );
        }

        schema.attributes = { ...(schema.attributes ?? {}), [args.field_name]: args.field };

        const validation = validateSchemaProposal(
          strapi,
          { uid: args.uid, kind: isComponent ? "component" : "content-type", schema },
          "update"
        );

        if (hasErrors(validation)) {
          return { success: false, validation, restart_required: false };
        }
        if (validation.warnings.length > 0 && !args.force) {
          return {
            success: false,
            validation,
            hint: "Hay warnings. Revísalas y vuelve a llamar con force=true si quieres escribir igual.",
            restart_required: false,
          };
        }

        const files: FileToWrite[] = [
          { path: sourcePath, content: JSON.stringify(schema, null, 2) + "\n" },
        ];

        if (args.dry_run) {
          return {
            dry_run: true,
            validation,
            files_to_write: files,
            restart_required: true,
            restart_info: buildRestartInfo(),
          };
        }

        const writeResult = await writeFiles(files, { backup: args.backup ?? true });
        return buildAuthoringResponse(validation, writeResult, { uid: args.uid, added_field: args.field_name });
      } finally {
        release();
      }
    },
  },

  // ── 7. add_fields_to_schema (BATCH) ─────────────────────────────────────────
  {
    name: "add_fields_to_schema",
    description:
      "BATCH version de add_field_to_schema: agrega N atributos en una sola escritura → un solo restart de Strapi (en vez de N restarts). Recomendado cuando vas a agregar 2+ campos seguidos al mismo schema. Lee el schema.json una vez, mergea todos los fields, valida la propuesta completa, escribe una vez. Si CUALQUIER field tiene problemas (validation error, conflicto de nombre, etc.) toda la operación se aborta sin escribir nada (atómico). DISPARA UN SOLO RESTART (~12s).",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID del schema (api::* o category.name)." },
        fields: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              field_name: { type: "string" },
              field: {
                type: "object",
                description: "Definición del atributo (type, required, etc.).",
              },
            },
            required: ["field_name", "field"],
            additionalProperties: false,
          },
          description: "Lista de {field_name, field} a agregar atómicamente. Mínimo 1.",
        },
        dry_run: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        backup: { type: "boolean", default: true },
      },
      required: ["uid", "fields"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (isProduction()) productionRefusal();

      // Pre-flight: catch duplicate field_names within the batch BEFORE touching
      // the filesystem. Atomic semantics → fail fast on bad args.
      const seenInBatch = new Set<string>();
      for (const entry of args.fields) {
        const name = entry.field_name;
        if (seenInBatch.has(name)) {
          throw new Error(
            `El campo "${name}" aparece duplicado dentro del batch fields[]. Cada field_name debe ser único.`
          );
        }
        seenInBatch.add(name);
      }

      const isComponent = !args.uid.startsWith("api::");
      const sourcePath = isComponent
        ? pathsForComponent(args.uid.split(".")[0], args.uid.split(".")[1])[0].path
        : pathsForContentType(args.uid.replace(/^api::/, "").split(".")[0]).schema;

      const release = await acquirePathLock(sourcePath);
      try {
        let schema: any;
        try {
          schema = await readJson(sourcePath);
        } catch (err) {
          throw new Error(`No pude leer schema.json en ${sourcePath}: ${(err as Error).message}`);
        }

        // Second check: existing-attribute collisions. Requires the schema in
        // memory. Same atomic semantics: ANY collision → abort entire batch.
        const existingAttrs = schema.attributes ?? {};
        for (const entry of args.fields) {
          if (existingAttrs[entry.field_name]) {
            throw new Error(
              `El atributo "${entry.field_name}" ya existe en "${args.uid}". Usá delete_field_from_schema primero, o renombralo en el batch. Toda la operación abortada sin escribir nada.`
            );
          }
        }

        // Merge all fields into a fresh attributes object.
        const mergedAttributes: Record<string, any> = { ...existingAttrs };
        for (const { field_name, field } of args.fields) {
          mergedAttributes[field_name] = field;
        }
        schema.attributes = mergedAttributes;

        const validation = validateSchemaProposal(
          strapi,
          { uid: args.uid, kind: isComponent ? "component" : "content-type", schema },
          "update"
        );

        if (hasErrors(validation)) {
          return { success: false, validation, restart_required: false };
        }
        if (validation.warnings.length > 0 && !args.force) {
          return {
            success: false,
            validation,
            hint: "Hay warnings. Revisalas y volvé a llamar con force=true si querés escribir igual.",
            restart_required: false,
          };
        }

        const files: FileToWrite[] = [
          { path: sourcePath, content: JSON.stringify(schema, null, 2) + "\n" },
        ];

        if (args.dry_run) {
          return {
            dry_run: true,
            validation,
            files_to_write: files,
            added_fields: args.fields.map((f: any) => f.field_name),
            restart_required: true,
            restart_info: buildRestartInfo(),
          };
        }

        const writeResult = await writeFiles(files, { backup: args.backup ?? true });
        return buildAuthoringResponse(validation, writeResult, {
          uid: args.uid,
          added_fields: args.fields.map((f: any) => f.field_name),
          batch_size: args.fields.length,
        });
      } finally {
        release();
      }
    },
  },

  // ── 8. delete_field_from_schema ─────────────────────────────────────────────
  {
    name: "delete_field_from_schema",
    description:
      "⚠️ DESTRUCTIVA. Elimina un atributo de un schema existente. USA ESTA TOOL SOLO cuando el usuario nombró EXPLÍCITAMENTE el campo a eliminar. NO la uses para 'arreglar' un problema no relacionado (ej. un error de profundidad) eliminando campos por tu cuenta — eso destruye trabajo deliberado del usuario; en ese caso, presentale el conflicto y dejá que decida. REFUSA si el atributo es referenciado desde otro schema vía inversedBy/mappedBy (te avisa cuál y cómo desconectarlo primero). DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. Mira `restart_info` en la respuesta y espera ese tiempo; usa `__health` para confirmar que volvió. Hace backup .bak.{timestamp} antes de borrar.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        field_name: { type: "string" },
        confirm: { type: "boolean", description: "Debe ser true para ejecutar." },
        dry_run: { type: "boolean", default: false },
        backup: { type: "boolean", default: true },
      },
      required: ["uid", "field_name", "confirm"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (isProduction()) productionRefusal();
      if (args.confirm !== true) {
        throw new Error(
          `delete_field_from_schema requiere confirm:true. Esta acción borra el atributo "${args.field_name}" de "${args.uid}".`
        );
      }

      const isComponent = !args.uid.startsWith("api::");
      const sourcePath = isComponent
        ? pathsForComponent(args.uid.split(".")[0], args.uid.split(".")[1])[0].path
        : pathsForContentType(args.uid.replace(/^api::/, "").split(".")[0]).schema;

      // Lock por path (ver H2 en add_field_to_schema).
      const release = await acquirePathLock(sourcePath);
      try {
        const schema = await readJson(sourcePath);
        const attr = schema.attributes?.[args.field_name];
        if (!attr) {
          throw new Error(`El atributo "${args.field_name}" no existe en "${args.uid}".`);
        }

        // Refusa si otro schema tiene inversedBy/mappedBy apuntando a este atributo
        const blockers: { from: string; via: string; reason: string }[] = [];
        const scan = (uidFrom: string, attrs: any) => {
          for (const [n, a] of Object.entries<any>(attrs ?? {})) {
            if (a?.type === "relation" && a.target === args.uid && (a.inversedBy === args.field_name || a.mappedBy === args.field_name)) {
              blockers.push({
                from: uidFrom,
                via: n,
                reason: `tiene ${a.inversedBy ? "inversedBy" : "mappedBy"}="${args.field_name}"`,
              });
            }
          }
        };
        for (const [otherUid, ct] of Object.entries<any>(strapi.contentTypes as any ?? {})) {
          if (otherUid !== args.uid) scan(otherUid, ct.attributes);
        }
        for (const [otherUid, comp] of Object.entries<any>(strapi.components as any ?? {})) {
          if (otherUid !== args.uid) scan(otherUid, comp.attributes);
        }

        if (blockers.length > 0) {
          return {
            success: false,
            refused: true,
            reason: `El atributo "${args.field_name}" está referenciado por ${blockers.length} schema(s). Quita esas referencias primero.`,
            blockers,
            restart_required: false,
          };
        }

        delete schema.attributes[args.field_name];

        const files: FileToWrite[] = [
          { path: sourcePath, content: JSON.stringify(schema, null, 2) + "\n" },
        ];

        if (args.dry_run) {
          return {
            dry_run: true,
            files_to_write: files,
            restart_required: true,
            restart_info: buildRestartInfo(),
          };
        }

        const writeResult = await writeFiles(files, { backup: args.backup ?? true });
        return {
          success: true,
          deleted_field: args.field_name,
          ...writeResult,
        };
      } finally {
        release();
      }
    },
  },

  // ── 9. propose_schema_strategy (read-only) ──────────────────────────────────
  {
    name: "propose_schema_strategy",
    description:
      "Dry-run de la lógica de strategies sobre una propuesta de component. Valida la propuesta SIN escribir nada, y si excede el límite de profundidad (NESTED_COMPONENT_DEPTH_EXCEEDED) devuelve las strategies disponibles (flat/modular/dynamiczone) con sus schemas materializados, wiring_instructions y trade-offs. Útil para explorar opciones antes de comprometerte con create_component.",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: "UID del component a proponer. Ej: 'molecules.card-with-button'.",
        },
        schema: {
          type: "object",
          description: "Mismo formato que create_component.schema: { collectionName?, info, attributes }.",
        },
      },
      required: ["uid", "schema"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const validation = validateSchemaProposal(
        strapi,
        { uid: args.uid, kind: "component", schema: args.schema },
        "create"
      );

      const depthViolation = validation.violations.find(
        (v) => v.code === "NESTED_COMPONENT_DEPTH_EXCEEDED"
      );

      if (!depthViolation) {
        return {
          valid: validation.violations.length === 0,
          validation,
          strategies: [],
          notes: ["La propuesta no disparó NESTED_COMPONENT_DEPTH_EXCEEDED. No hay strategies para proponer."],
        };
      }

      const result = proposeSchemaStrategies(
        strapi,
        { kind: "component", uid: args.uid, schema: args.schema },
        depthViolation
      );

      return {
        valid: false,
        validation,
        strategies: result.strategies,
        notes: [
          "Esta tool NO escribe archivos — es solo para explorar opciones.",
          "Para materializar una strategy, llama a create_component con `strategy: 'flat'` (o 'modular', 'dynamiczone').",
        ],
      };
    },
  },

  // ── 10. modify_schema (BATCH remove + add + update) ─────────────────────────
  {
    name: "modify_schema",
    description:
      "BATCH atómico de modificaciones de schema: combina remove[] (borrar campos), add[] (agregar campos nuevos) y update[] (reemplazar la definición de campos existentes — ej. cambiar el type) en UNA sola escritura → UN SOLO restart de Strapi. Reemplaza tener que encadenar delete_field_from_schema + add_fields_to_schema (que serían N restarts). Lee el schema una vez, aplica remove → update → add, valida el resultado completo, escribe. Si CUALQUIER operación falla (campo inexistente, colisión, relación bloqueante, validation error) toda la operación se aborta sin escribir nada. DISPARA UN SOLO RESTART (~12s).",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID del schema (api::* o category.name)." },
        remove: {
          type: "array",
          items: { type: "string" },
          description: "Nombres de atributos a eliminar. Cada uno debe existir. Refusa si un atributo está referenciado por inversedBy/mappedBy de otro schema.",
        },
        add: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field_name: { type: "string" },
              field: { type: "object", description: "Definición del atributo (type, required, etc.)." },
            },
            required: ["field_name", "field"],
            additionalProperties: false,
          },
          description: "Atributos nuevos a agregar. Cada field_name NO debe existir (salvo que esté en remove[]).",
        },
        update: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field_name: { type: "string" },
              field: { type: "object", description: "Nueva definición completa del atributo (reemplaza la anterior)." },
            },
            required: ["field_name", "field"],
            additionalProperties: false,
          },
          description: "Atributos existentes a reemplazar. Cada field_name DEBE existir. Útil para cambiar el type de un campo (ej. text → string) sin orquestar delete+add.",
        },
        dry_run: { type: "boolean", default: false },
        force: { type: "boolean", default: false, description: "Suprime warnings (no errors)." },
        backup: { type: "boolean", default: true },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (isProduction()) productionRefusal();

      const remove: string[] = Array.isArray(args.remove) ? args.remove : [];
      const add: { field_name: string; field: any }[] = Array.isArray(args.add) ? args.add : [];
      const update: { field_name: string; field: any }[] = Array.isArray(args.update) ? args.update : [];

      if (remove.length === 0 && add.length === 0 && update.length === 0) {
        throw new Error(
          "modify_schema requiere al menos una operación: remove[], add[] o update[]. Todas vacías."
        );
      }

      // ── Pre-flight: detectar conflictos entre las 3 listas (sin tocar fs) ──
      const removeSet = new Set(remove);
      const addNames = add.map((a) => a.field_name);
      const updateNames = update.map((u) => u.field_name);

      const dup = (arr: string[]) => arr.find((n, i) => arr.indexOf(n) !== i);
      const removeDup = dup(remove);
      if (removeDup) throw new Error(`"${removeDup}" duplicado en remove[].`);
      const addDup = dup(addNames);
      if (addDup) throw new Error(`"${addDup}" duplicado en add[].`);
      const updateDup = dup(updateNames);
      if (updateDup) throw new Error(`"${updateDup}" duplicado en update[].`);

      for (const n of addNames) {
        if (removeSet.has(n)) {
          throw new Error(
            `"${n}" está en remove[] y add[] a la vez. Para cambiar la definición de un campo existente usá update[], no remove+add.`
          );
        }
        if (updateNames.includes(n)) {
          throw new Error(`"${n}" está en add[] y update[] a la vez. Elegí una.`);
        }
      }
      for (const n of updateNames) {
        if (removeSet.has(n)) {
          throw new Error(`"${n}" está en remove[] y update[] a la vez. Elegí una.`);
        }
      }

      const isComponent = !args.uid.startsWith("api::");
      const sourcePath = resolveSchemaPath(args.uid);

      const release = await acquirePathLock(sourcePath);
      try {
        let schema: any;
        try {
          schema = await readJson(sourcePath);
        } catch (err) {
          throw new Error(`No pude leer schema.json en ${sourcePath}: ${(err as Error).message}`);
        }

        const attrs: Record<string, any> = { ...(schema.attributes ?? {}) };

        // ── Validar remove[]: cada campo existe + no tiene blockers ──
        const allBlockers: any[] = [];
        for (const name of remove) {
          if (!(name in attrs)) {
            throw new Error(`remove[]: el atributo "${name}" no existe en "${args.uid}".`);
          }
          const blockers = findRelationBlockers(strapi, args.uid, name);
          for (const b of blockers) allBlockers.push({ field: name, ...b });
        }
        if (allBlockers.length > 0) {
          return {
            success: false,
            refused: true,
            reason: `${allBlockers.length} atributo(s) en remove[] están referenciados por relaciones de otros schemas. Quitá esas referencias primero.`,
            blockers: allBlockers,
            restart_required: false,
          };
        }

        // ── Validar update[]: cada campo existe ──
        for (const { field_name } of update) {
          if (!(field_name in attrs)) {
            throw new Error(
              `update[]: el atributo "${field_name}" no existe en "${args.uid}". Para crear uno nuevo usá add[].`
            );
          }
        }

        // ── Validar add[]: cada campo NO existe (salvo que esté en remove) ──
        for (const { field_name } of add) {
          const existsAndNotRemoved = field_name in attrs && !removeSet.has(field_name);
          if (existsAndNotRemoved) {
            throw new Error(
              `add[]: el atributo "${field_name}" ya existe en "${args.uid}". Usá update[] para reemplazarlo, o ponelo en remove[] si querés recrearlo.`
            );
          }
        }

        // ── Aplicar en orden: remove → update → add ──
        for (const name of remove) delete attrs[name];
        for (const { field_name, field } of update) attrs[field_name] = field;
        for (const { field_name, field } of add) attrs[field_name] = field;
        schema.attributes = attrs;

        const validation = validateSchemaProposal(
          strapi,
          { uid: args.uid, kind: isComponent ? "component" : "content-type", schema },
          "update"
        );

        if (hasErrors(validation)) {
          return { success: false, validation, restart_required: false };
        }
        if (validation.warnings.length > 0 && !args.force) {
          return {
            success: false,
            validation,
            hint: "Hay warnings. Revisalas y volvé a llamar con force=true si querés escribir igual.",
            restart_required: false,
          };
        }

        const files: FileToWrite[] = [
          { path: sourcePath, content: JSON.stringify(schema, null, 2) + "\n" },
        ];
        const opSummary = {
          removed: remove,
          updated: updateNames,
          added: addNames,
        };

        if (args.dry_run) {
          return {
            dry_run: true,
            validation,
            files_to_write: files,
            operations: opSummary,
            restart_required: true,
            restart_info: buildRestartInfo(),
          };
        }

        const writeResult = await writeFiles(files, { backup: args.backup ?? true });
        return buildAuthoringResponse(validation, writeResult, {
          uid: args.uid,
          operations: opSummary,
        });
      } finally {
        release();
      }
    },
  },

  // ── 11. suggest_reusable_atoms (read-only analysis) ─────────────────────────
  {
    name: "suggest_reusable_atoms",
    description:
      "Analiza TODOS los components y content-types del proyecto buscando campos escalares repetidos (ej. 'title: string' en 8 sections) que valdría la pena promover a atoms reutilizables. Para cada candidato fuerte devuelve: dónde se usa, un schema starter del atom propuesto, y un execution_plan concreto (create_component + un modify_schema por consumidor) que podés ejecutar tras revisión. NO escribe nada — es análisis puro. Cierra el gap donde el LLM por default 'agrega más campos sueltos' en vez de 'extraer un átomo reutilizable'.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "components", "content-types"],
          default: "all",
          description: "Qué analizar. 'all' incluye components + content-types api::*.",
        },
        min_occurrences: {
          type: "integer",
          minimum: 2,
          default: 3,
          description: "Cuántas veces tiene que repetirse un patrón (field_name + type) para considerarse candidato.",
        },
      },
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      return suggestReusableAtoms(strapi, {
        scope: args?.scope ?? "all",
        minOccurrences: args?.min_occurrences,
      });
    },
  },
];
