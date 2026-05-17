"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemaAuthoringTools = void 0;
const build_catalog_1 = require("../schema-derivation/build-catalog");
const validator_1 = require("../schema-authoring/validator");
const writer_1 = require("../schema-authoring/writer");
const path_lock_1 = require("../path-lock");
function hasErrors(v) {
    return v.violations.some((x) => x.severity === "error");
}
function buildAuthoringResponse(validation, writeResult, extra) {
    return {
        success: true,
        validation,
        ...writeResult,
        ...(extra !== null && extra !== void 0 ? extra : {}),
    };
}
exports.schemaAuthoringTools = [
    // ── 1. list_existing_schemas ────────────────────────────────────────────────
    {
        name: "list_existing_schemas",
        description: "Enumera todos los content-types (api::*) y components del proyecto Strapi. Devuelve UIDs, displayName, descripción, kind, y atributos formateados. Útil ANTES de crear un nuevo schema para evitar colisiones de nombre o reusar uno existente.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
        handler: async ({ strapi }) => {
            return (0, build_catalog_1.buildSchemaCatalog)(strapi);
        },
    },
    // ── 2. read_schema ──────────────────────────────────────────────────────────
    {
        name: "read_schema",
        description: "Lee el schema.json crudo de un content-type (uid api::*) o component. Requisito previo de add_field_to_schema/delete_field_from_schema. Devuelve también la lista de referencias inversas (qué otros schemas apuntan a este).",
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
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d, _e;
            const { uid } = args;
            const isComponent = !uid.startsWith("api::");
            const source = isComponent
                ? (_a = strapi.components) === null || _a === void 0 ? void 0 : _a[uid]
                : (_b = strapi.contentTypes) === null || _b === void 0 ? void 0 : _b[uid];
            if (!source) {
                throw new Error(`Schema "${uid}" no encontrado en strapi.${isComponent ? "components" : "contentTypes"}.`);
            }
            // Inverse references: qué schemas apuntan a este uid
            const incoming = [];
            const scan = (uidFrom, attrs, kind) => {
                for (const [name, attr] of Object.entries(attrs !== null && attrs !== void 0 ? attrs : {})) {
                    if ((attr === null || attr === void 0 ? void 0 : attr.type) === "component" && attr.component === uid) {
                        incoming.push({ from: uidFrom, via: name, type: `component (${kind})` });
                    }
                    if ((attr === null || attr === void 0 ? void 0 : attr.type) === "dynamiczone" && Array.isArray(attr.components) && attr.components.includes(uid)) {
                        incoming.push({ from: uidFrom, via: name, type: `dynamiczone (${kind})` });
                    }
                    if ((attr === null || attr === void 0 ? void 0 : attr.type) === "relation" && attr.target === uid) {
                        incoming.push({ from: uidFrom, via: name, type: `relation:${attr.relation} (${kind})` });
                    }
                }
            };
            for (const [otherUid, ct] of Object.entries((_c = strapi.contentTypes) !== null && _c !== void 0 ? _c : {})) {
                if (otherUid !== uid)
                    scan(otherUid, ct.attributes, "content-type");
            }
            for (const [otherUid, comp] of Object.entries((_d = strapi.components) !== null && _d !== void 0 ? _d : {})) {
                if (otherUid !== uid)
                    scan(otherUid, comp.attributes, "component");
            }
            return {
                uid,
                kind: isComponent ? "component" : (_e = source.kind) !== null && _e !== void 0 ? _e : "collectionType",
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
        description: "Valida una propuesta de schema SIN ESCRIBIRLA. Detecta: NESTED_COMPONENT_DEPTH_EXCEEDED (Strapi UI solo permite 1 nivel de anidamiento de components), RESERVED_ATTRIBUTE_NAME (id, createdAt, etc.), INVALID_NAME, MISSING_REQUIRED_PROP, UNKNOWN_REFERENCE, CIRCULAR_REFERENCE, RELATION_RECIPROCITY_MISSING, COLLISION_COLLECTION_NAME. Devuelve {valid, violations[], warnings[]}.",
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
        handler: async ({ strapi }, args) => {
            var _a;
            const proposal = {
                uid: args.uid,
                kind: args.kind,
                schema: args.schema,
            };
            return (0, validator_1.validateSchemaProposal)(strapi, proposal, (_a = args.mode) !== null && _a !== void 0 ? _a : "create");
        },
    },
    // ── 4. create_component ─────────────────────────────────────────────────────
    {
        name: "create_component",
        description: "Crea un component nuevo escribiendo src/components/{category}/{name}.json. DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. La respuesta incluye `restart_info` con el tiempo estimado; espera ese período antes de la próxima llamada al MCP. Usa la tool `__health` para verificar que Strapi volvió. Valida la propuesta automáticamente — abortado si hay violations (a menos que force=true para warnings). Usa dry_run=true para ver qué se escribiría sin escribir.",
        inputSchema: {
            type: "object",
            properties: {
                category: { type: "string", description: "Categoría del component (kebab-case). Ej: 'shared', 'atoms', 'molecules'." },
                name: { type: "string", description: "Nombre del component (kebab-case, sin extensión). Ej: 'button-cta'." },
                schema: {
                    type: "object",
                    description: "Schema del component: { collectionName, info: {displayName, icon?, description?}, options?, attributes }.",
                },
                dry_run: { type: "boolean", default: false },
                force: { type: "boolean", default: false, description: "Suprime warnings (no errors)." },
                backup: { type: "boolean", default: true },
            },
            required: ["category", "name", "schema"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a;
            if ((0, writer_1.isProduction)())
                (0, writer_1.productionRefusal)();
            const uid = `${args.category}.${args.name}`;
            const validation = (0, validator_1.validateSchemaProposal)(strapi, { uid, kind: "component", schema: args.schema }, "create");
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
            const filePath = (0, writer_1.pathsForComponent)(args.category, args.name)[0].path;
            const files = [
                { path: filePath, content: JSON.stringify(args.schema, null, 2) + "\n" },
            ];
            if (args.dry_run) {
                return {
                    dry_run: true,
                    validation,
                    files_to_write: files,
                    restart_required: true,
                    restart_info: (0, writer_1.buildRestartInfo)(),
                };
            }
            const writeResult = await (0, writer_1.writeFiles)(files, { backup: (_a = args.backup) !== null && _a !== void 0 ? _a : true });
            return buildAuthoringResponse(validation, writeResult, { uid });
        },
    },
    // ── 5. create_content_type ──────────────────────────────────────────────────
    {
        name: "create_content_type",
        description: "Crea un content-type nuevo: escribe schema.json + controllers/routes/services stubs (factories one-liners). DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. La respuesta incluye `restart_info` con el tiempo estimado; espera ese período antes de la próxima llamada al MCP. Usa la tool `__health` para verificar que Strapi volvió. Valida automáticamente. Strapi v5 NO autogenera controllers/routes/services — sin estos archivos los endpoints REST no se registran.",
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
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d, _e, _f;
            if ((0, writer_1.isProduction)())
                (0, writer_1.productionRefusal)();
            const singularName = args.singular_name;
            const pluralName = args.plural_name;
            const uid = `api::${singularName}.${singularName}`;
            const collectionName = (_a = args.collection_name) !== null && _a !== void 0 ? _a : pluralName.replace(/-/g, "_");
            const schema = {
                kind: (_b = args.kind) !== null && _b !== void 0 ? _b : "collectionType",
                collectionName,
                info: {
                    singularName,
                    pluralName,
                    displayName: args.display_name,
                    description: (_c = args.description) !== null && _c !== void 0 ? _c : "",
                },
                options: { draftAndPublish: (_d = args.draft_and_publish) !== null && _d !== void 0 ? _d : true },
                pluginOptions: args.i18n ? { i18n: { localized: true } } : {},
                attributes: (_e = args.attributes) !== null && _e !== void 0 ? _e : {},
            };
            const validation = (0, validator_1.validateSchemaProposal)(strapi, { uid, kind: "content-type", schema }, "create");
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
            const paths = (0, writer_1.pathsForContentType)(singularName);
            const files = [
                { path: paths.schema, content: JSON.stringify(schema, null, 2) + "\n" },
                { path: paths.controller, content: (0, writer_1.controllerStub)(singularName) },
                { path: paths.router, content: (0, writer_1.routerStub)(singularName) },
                { path: paths.service, content: (0, writer_1.serviceStub)(singularName) },
            ];
            if (args.dry_run) {
                return {
                    dry_run: true,
                    validation,
                    files_to_write: files,
                    restart_required: true,
                    restart_info: (0, writer_1.buildRestartInfo)(),
                };
            }
            const writeResult = await (0, writer_1.writeFiles)(files, { backup: (_f = args.backup) !== null && _f !== void 0 ? _f : true });
            return buildAuthoringResponse(validation, writeResult, {
                uid,
                rest_endpoint: `/api/${pluralName}`,
            });
        },
    },
    // ── 6. add_field_to_schema ──────────────────────────────────────────────────
    {
        name: "add_field_to_schema",
        description: "Agrega un atributo nuevo a un schema existente (content-type o component). Lee el schema.json del filesystem, agrega el atributo, valida la propuesta completa, escribe. DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. Mira `restart_info` en la respuesta y espera ese tiempo; usa `__health` para confirmar que volvió. IMPORTANTE: si necesitas agregar varios campos, NO llames esta tool repetidamente (cada llamada dispara un restart de 12s). Mejor crea el content-type con todos los attributes de una vez, o si ya existe edita el schema.json a mano. Hace backup .bak.{timestamp} antes de overwrite.",
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
        handler: async ({ strapi }, args) => {
            var _a, _b, _c;
            if ((0, writer_1.isProduction)())
                (0, writer_1.productionRefusal)();
            const isComponent = !args.uid.startsWith("api::");
            const sourcePath = isComponent
                ? (0, writer_1.pathsForComponent)(args.uid.split(".")[0], args.uid.split(".")[1])[0].path
                : (0, writer_1.pathsForContentType)(args.uid.replace(/^api::/, "").split(".")[0]).schema;
            // Lock por path para serializar read+modify+write. Si dos llamadas
            // concurrentes intentan modificar el mismo schema, la segunda espera a
            // que la primera termine — evita lost writes (H2).
            const release = await (0, path_lock_1.acquirePathLock)(sourcePath);
            try {
                let schema;
                try {
                    schema = await (0, writer_1.readJson)(sourcePath);
                }
                catch (err) {
                    throw new Error(`No pude leer schema.json en ${sourcePath}: ${err.message}`);
                }
                if ((_a = schema.attributes) === null || _a === void 0 ? void 0 : _a[args.field_name]) {
                    throw new Error(`El atributo "${args.field_name}" ya existe en "${args.uid}". Usa delete_field_from_schema primero, o renómbralo.`);
                }
                schema.attributes = { ...((_b = schema.attributes) !== null && _b !== void 0 ? _b : {}), [args.field_name]: args.field };
                const validation = (0, validator_1.validateSchemaProposal)(strapi, { uid: args.uid, kind: isComponent ? "component" : "content-type", schema }, "update");
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
                const files = [
                    { path: sourcePath, content: JSON.stringify(schema, null, 2) + "\n" },
                ];
                if (args.dry_run) {
                    return {
                        dry_run: true,
                        validation,
                        files_to_write: files,
                        restart_required: true,
                        restart_info: (0, writer_1.buildRestartInfo)(),
                    };
                }
                const writeResult = await (0, writer_1.writeFiles)(files, { backup: (_c = args.backup) !== null && _c !== void 0 ? _c : true });
                return buildAuthoringResponse(validation, writeResult, { uid: args.uid, added_field: args.field_name });
            }
            finally {
                release();
            }
        },
    },
    // ── 7. delete_field_from_schema ─────────────────────────────────────────────
    {
        name: "delete_field_from_schema",
        description: "Elimina un atributo de un schema existente. REFUSA si el atributo es referenciado desde otro schema vía inversedBy/mappedBy (te avisa cuál y cómo desconectarlo primero). DISPARA RESTART DE STRAPI (dev mode) — el endpoint MCP estará caído ~12s. Mira `restart_info` en la respuesta y espera ese tiempo; usa `__health` para confirmar que volvió. Hace backup .bak.{timestamp} antes de borrar.",
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
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d;
            if ((0, writer_1.isProduction)())
                (0, writer_1.productionRefusal)();
            if (args.confirm !== true) {
                throw new Error(`delete_field_from_schema requiere confirm:true. Esta acción borra el atributo "${args.field_name}" de "${args.uid}".`);
            }
            const isComponent = !args.uid.startsWith("api::");
            const sourcePath = isComponent
                ? (0, writer_1.pathsForComponent)(args.uid.split(".")[0], args.uid.split(".")[1])[0].path
                : (0, writer_1.pathsForContentType)(args.uid.replace(/^api::/, "").split(".")[0]).schema;
            // Lock por path (ver H2 en add_field_to_schema).
            const release = await (0, path_lock_1.acquirePathLock)(sourcePath);
            try {
                const schema = await (0, writer_1.readJson)(sourcePath);
                const attr = (_a = schema.attributes) === null || _a === void 0 ? void 0 : _a[args.field_name];
                if (!attr) {
                    throw new Error(`El atributo "${args.field_name}" no existe en "${args.uid}".`);
                }
                // Refusa si otro schema tiene inversedBy/mappedBy apuntando a este atributo
                const blockers = [];
                const scan = (uidFrom, attrs) => {
                    for (const [n, a] of Object.entries(attrs !== null && attrs !== void 0 ? attrs : {})) {
                        if ((a === null || a === void 0 ? void 0 : a.type) === "relation" && a.target === args.uid && (a.inversedBy === args.field_name || a.mappedBy === args.field_name)) {
                            blockers.push({
                                from: uidFrom,
                                via: n,
                                reason: `tiene ${a.inversedBy ? "inversedBy" : "mappedBy"}="${args.field_name}"`,
                            });
                        }
                    }
                };
                for (const [otherUid, ct] of Object.entries((_b = strapi.contentTypes) !== null && _b !== void 0 ? _b : {})) {
                    if (otherUid !== args.uid)
                        scan(otherUid, ct.attributes);
                }
                for (const [otherUid, comp] of Object.entries((_c = strapi.components) !== null && _c !== void 0 ? _c : {})) {
                    if (otherUid !== args.uid)
                        scan(otherUid, comp.attributes);
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
                const files = [
                    { path: sourcePath, content: JSON.stringify(schema, null, 2) + "\n" },
                ];
                if (args.dry_run) {
                    return {
                        dry_run: true,
                        files_to_write: files,
                        restart_required: true,
                        restart_info: (0, writer_1.buildRestartInfo)(),
                    };
                }
                const writeResult = await (0, writer_1.writeFiles)(files, { backup: (_d = args.backup) !== null && _d !== void 0 ? _d : true });
                return {
                    success: true,
                    deleted_field: args.field_name,
                    ...writeResult,
                };
            }
            finally {
                release();
            }
        },
    },
];
