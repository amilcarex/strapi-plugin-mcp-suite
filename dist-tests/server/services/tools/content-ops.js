"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentOpsTools = void 0;
const build_catalog_1 = require("../schema-derivation/build-catalog");
const derive_1 = require("../schema-derivation/derive");
/**
 * Tools genéricas de gestión de contenido. Delegan a `strapi.documents()` para
 * que pasen por validación, lifecycle hooks, sanitización y D&P nativos.
 *
 * Todas reciben `uid` (api::*) y operan sobre cualquier content-type.
 */
function assertContentType(strapi, uid) {
    var _a;
    const ct = (_a = strapi.contentTypes) === null || _a === void 0 ? void 0 : _a[uid];
    if (!ct) {
        throw new Error(`Content-type "${uid}" no existe. Llama a list_content_types para ver los disponibles.`);
    }
    if (!uid.startsWith("api::")) {
        throw new Error(`Solo se pueden operar content-types de proyecto (api::*). "${uid}" es interno de Strapi.`);
    }
    return ct;
}
exports.contentOpsTools = [
    // ── 1. list_content_types ───────────────────────────────────────────────────
    {
        name: "list_content_types",
        description: "Lista todos los content-types y components del proyecto (live). Después de un create_content_type + reinicio, los nuevos UIDs aparecen automáticamente. Devuelve para cada CT: uid, kind, displayName, draftAndPublish, i18n y fields formateados.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: async ({ strapi }) => {
            return (0, build_catalog_1.buildSchemaCatalog)(strapi);
        },
    },
    // ── 2. get_content_type_schema ─────────────────────────────────────────────
    {
        name: "get_content_type_schema",
        description: "Devuelve el schema completo de un content-type o component, con los fields formateados de manera legible. Incluye expansión de components anidados si include_nested=true.",
        inputSchema: {
            type: "object",
            properties: {
                uid: { type: "string" },
                include_nested: { type: "boolean", default: false, description: "Si true, expande recursivamente los components referenciados." },
            },
            required: ["uid"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a;
            const isComponent = !args.uid.startsWith("api::");
            const base = isComponent
                ? (0, derive_1.deriveComponentFields)(strapi, args.uid)
                : (0, derive_1.deriveContentTypeFields)(strapi, args.uid);
            if (!base) {
                throw new Error(`Schema "${args.uid}" no encontrado.`);
            }
            const result = { uid: args.uid, ...base };
            if (args.include_nested) {
                const source = isComponent
                    ? strapi.components[args.uid]
                    : strapi.contentTypes[args.uid];
                const nested = {};
                for (const [, attr] of Object.entries((_a = source.attributes) !== null && _a !== void 0 ? _a : {})) {
                    if ((attr === null || attr === void 0 ? void 0 : attr.type) === "component" && attr.component && !nested[attr.component]) {
                        nested[attr.component] = (0, derive_1.deriveComponentFields)(strapi, attr.component);
                    }
                    if ((attr === null || attr === void 0 ? void 0 : attr.type) === "dynamiczone" && Array.isArray(attr.components)) {
                        for (const compUid of attr.components) {
                            if (!nested[compUid]) {
                                nested[compUid] = (0, derive_1.deriveComponentFields)(strapi, compUid);
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
        description: "Busca entries de un content-type. Soporta filters (sintaxis de Strapi: {field: {$eq: val}}), sort, pagination, populate y status (draft|published). Delega a strapi.documents().findMany.",
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
                populate: { description: "* | string[] | object — qué relaciones/components traer." },
                status: { type: "string", enum: ["draft", "published"] },
                locale: { type: "string" },
                fields: { description: "Lista de campos a devolver." },
            },
            required: ["uid"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d;
            assertContentType(strapi, args.uid);
            const query = {};
            if (args.filters)
                query.filters = args.filters;
            if (args.sort)
                query.sort = args.sort;
            if (args.populate)
                query.populate = args.populate;
            if (args.status)
                query.status = args.status;
            if (args.locale)
                query.locale = args.locale;
            if (args.fields)
                query.fields = args.fields;
            const page = (_b = (_a = args.pagination) === null || _a === void 0 ? void 0 : _a.page) !== null && _b !== void 0 ? _b : 1;
            // Cap defensivo: pageSize máximo 200 — evita que el LLM pida 100k entries
            // y revente memoria/DB. Hard cap, no override.
            const PAGE_SIZE_HARD_CAP = 200;
            const requestedPageSize = (_d = (_c = args.pagination) === null || _c === void 0 ? void 0 : _c.pageSize) !== null && _d !== void 0 ? _d : 25;
            const pageSize = Math.min(Math.max(1, requestedPageSize), PAGE_SIZE_HARD_CAP);
            query.start = (page - 1) * pageSize;
            query.limit = pageSize;
            const docs = await strapi.documents(args.uid).findMany(query);
            const total = await strapi.documents(args.uid).count(args.filters ? { filters: args.filters } : {});
            const result = {
                data: docs,
                pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
            };
            if (requestedPageSize > PAGE_SIZE_HARD_CAP) {
                result.pagination_capped = `Solicitaste pageSize=${requestedPageSize} pero el cap es ${PAGE_SIZE_HARD_CAP}. Se aplicó ${PAGE_SIZE_HARD_CAP}.`;
            }
            return result;
        },
    },
    // ── 4. get_entry ────────────────────────────────────────────────────────────
    {
        name: "get_entry",
        description: "Devuelve un entry por documentId. Soporta populate, status y locale.",
        inputSchema: {
            type: "object",
            properties: {
                uid: { type: "string" },
                documentId: { type: "string" },
                populate: {},
                status: { type: "string", enum: ["draft", "published"] },
                locale: { type: "string" },
            },
            required: ["uid", "documentId"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            assertContentType(strapi, args.uid);
            const doc = await strapi.documents(args.uid).findOne({
                documentId: args.documentId,
                populate: args.populate,
                status: args.status,
                locale: args.locale,
            });
            if (!doc)
                throw new Error(`Entry ${args.documentId} no encontrado en ${args.uid}.`);
            return doc;
        },
    },
    // ── 5. create_entry ─────────────────────────────────────────────────────────
    {
        name: "create_entry",
        description: "Crea un entry. data debe respetar el schema vivo. Por default crea en draft (si el CT tiene draftAndPublish). Pasa status='published' para publicar inmediatamente.",
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
        handler: async ({ strapi }, args) => {
            var _a;
            assertContentType(strapi, args.uid);
            const created = await strapi.documents(args.uid).create({
                data: args.data,
                status: (_a = args.status) !== null && _a !== void 0 ? _a : "draft",
                locale: args.locale,
            });
            return { success: true, entry: created };
        },
    },
    // ── 6. update_entry ─────────────────────────────────────────────────────────
    {
        name: "update_entry",
        description: "Actualiza un entry por documentId. data hace merge parcial (solo los campos enviados se modifican).",
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
        handler: async ({ strapi }, args) => {
            assertContentType(strapi, args.uid);
            const updated = await strapi.documents(args.uid).update({
                documentId: args.documentId,
                data: args.data,
                status: args.status,
                locale: args.locale,
            });
            return { success: true, entry: updated };
        },
    },
    // ── 7. delete_entry ─────────────────────────────────────────────────────────
    {
        name: "delete_entry",
        description: "Elimina un entry (draft + published) por documentId. REQUIERE confirm:true.",
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
        handler: async ({ strapi }, args) => {
            assertContentType(strapi, args.uid);
            if (args.confirm !== true) {
                throw new Error(`delete_entry requiere confirm:true. Esta acción borra el entry ${args.documentId} en ${args.uid}.`);
            }
            const result = await strapi.documents(args.uid).delete({
                documentId: args.documentId,
                locale: args.locale,
            });
            return { success: true, deleted: result };
        },
    },
    // ── 8. publish_entry ────────────────────────────────────────────────────────
    {
        name: "publish_entry",
        description: "Publica el draft de un entry (solo CTs con draftAndPublish:true). REQUIERE confirm:true.",
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
        handler: async ({ strapi }, args) => {
            var _a;
            const ct = assertContentType(strapi, args.uid);
            if (!((_a = ct.options) === null || _a === void 0 ? void 0 : _a.draftAndPublish)) {
                throw new Error(`Content-type "${args.uid}" no tiene draftAndPublish habilitado.`);
            }
            if (args.confirm !== true) {
                throw new Error(`publish_entry requiere confirm:true.`);
            }
            const result = await strapi.documents(args.uid).publish({
                documentId: args.documentId,
                locale: args.locale,
            });
            return { success: true, result };
        },
    },
    // ── 9. unpublish_entry ──────────────────────────────────────────────────────
    {
        name: "unpublish_entry",
        description: "Despublica un entry (lo deja solo como draft). REQUIERE confirm:true.",
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
        handler: async ({ strapi }, args) => {
            var _a;
            const ct = assertContentType(strapi, args.uid);
            if (!((_a = ct.options) === null || _a === void 0 ? void 0 : _a.draftAndPublish)) {
                throw new Error(`Content-type "${args.uid}" no tiene draftAndPublish habilitado.`);
            }
            if (args.confirm !== true) {
                throw new Error(`unpublish_entry requiere confirm:true.`);
            }
            const result = await strapi.documents(args.uid).unpublish({
                documentId: args.documentId,
                locale: args.locale,
            });
            return { success: true, result };
        },
    },
];
