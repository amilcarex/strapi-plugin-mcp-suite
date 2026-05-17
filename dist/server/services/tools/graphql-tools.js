"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.graphqlTools = void 0;
exports.assertQueryLimits = assertQueryLimits;
/**
 * Tools de GraphQL — testing y exploración del endpoint /graphql.
 *
 * Gated por GRAPHQL_ENABLED=true (opt-in). Razón: el plugin @strapi/plugin-graphql
 * NO está instalado por default en Strapi v5 — el usuario decide si lo agrega.
 * Estas tools verifican en runtime que el plugin esté presente y devuelven
 * errores claros si no.
 *
 * Por defecto solo permite QUERIES. Para ejecutar mutations, pasar
 * `allow_mutations: true` explícito en graphql_query.
 *
 * Casos de uso:
 *   - Testear queries del frontend desde Claude antes de meterlas en el código
 *   - Introspeccionar el schema GraphQL del proyecto
 *   - Generar queries con populate correcto desde el schema del CT
 */
function getGraphqlPlugin(strapi) {
    var _a;
    const plugin = (_a = strapi.plugin) === null || _a === void 0 ? void 0 : _a.call(strapi, "graphql");
    if (!plugin) {
        const err = new Error("GRAPHQL_PLUGIN_NOT_INSTALLED");
        err.details = {
            reason: "El plugin @strapi/plugin-graphql NO está instalado. Instalalo con: pnpm add @strapi/plugin-graphql. Reiniciá Strapi y las tools van a funcionar.",
        };
        throw err;
    }
    return plugin;
}
function assertEnabled() {
    if (process.env.GRAPHQL_ENABLED !== "true") {
        const err = new Error("GRAPHQL_TOOLS_DISABLED");
        err.details = {
            reason: "Las tools de GraphQL están deshabilitadas. Setea GRAPHQL_ENABLED=true en .env y reinicia Strapi. Asegurate también de tener @strapi/plugin-graphql instalado.",
        };
        throw err;
    }
}
function detectsMutation(query) {
    // Detección simple pero robusta: busca la keyword 'mutation' fuera de strings/comments.
    // No es un parser completo pero atrapa el 99% de casos.
    const stripped = query
        .replace(/#[^\n]*/g, "") // comments
        .replace(/"""[\s\S]*?"""/g, "") // block strings
        .replace(/"(?:[^"\\]|\\.)*"/g, ""); // strings
    return /\bmutation\b/i.test(stripped);
}
const MAX_QUERY_DEPTH = 10;
const MAX_QUERY_ALIASES = 50;
const MAX_QUERY_LENGTH_BYTES = 16 * 1024; // 16KB
/**
 * Limita el costo de queries GraphQL para mitigar DoS por query bombs:
 *  - Largo máximo del string (16KB)
 *  - Profundidad máxima de braces (proxy de nesting)
 *  - Cantidad máxima de aliases (anti alias-bomb)
 *
 * Implementación naive pero suficiente para bloquear los patrones obvios.
 * Una solución completa usaría graphql-depth-limit + graphql-query-complexity,
 * pero esas son deps externas que solo importan si exponés GraphQL public.
 */
function assertQueryLimits(query) {
    var _a;
    if (query.length > MAX_QUERY_LENGTH_BYTES) {
        const err = new Error("QUERY_TOO_LONG");
        err.details = {
            reason: `GraphQL query supera ${MAX_QUERY_LENGTH_BYTES} bytes (got ${query.length}). Posible query bomb.`,
        };
        throw err;
    }
    // Conteo de profundidad de braces fuera de strings/comments
    const stripped = query
        .replace(/#[^\n]*/g, "")
        .replace(/"""[\s\S]*?"""/g, "")
        .replace(/"(?:[^"\\]|\\.)*"/g, "");
    let depth = 0;
    let maxDepth = 0;
    for (const ch of stripped) {
        if (ch === "{") {
            depth++;
            if (depth > maxDepth)
                maxDepth = depth;
        }
        else if (ch === "}") {
            depth--;
        }
    }
    if (maxDepth > MAX_QUERY_DEPTH) {
        const err = new Error("QUERY_DEPTH_EXCEEDED");
        err.details = {
            reason: `GraphQL query nesting depth=${maxDepth} excede el máximo ${MAX_QUERY_DEPTH}. Reducí los populate anidados.`,
        };
        throw err;
    }
    // Detección de aliases (patrón "alias: field" muchas veces). Heurística.
    const aliasMatches = (_a = stripped.match(/[A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*/g)) !== null && _a !== void 0 ? _a : [];
    if (aliasMatches.length > MAX_QUERY_ALIASES) {
        const err = new Error("QUERY_TOO_MANY_ALIASES");
        err.details = {
            reason: `GraphQL query tiene ~${aliasMatches.length} aliases (máximo ${MAX_QUERY_ALIASES}). Posible alias-bomb DoS.`,
        };
        throw err;
    }
}
async function executeGraphql(strapi, query, variables, auth, user) {
    var _a, _b;
    getGraphqlPlugin(strapi); // valida que esté instalado
    // El paquete `graphql` viene como peer dep de @strapi/plugin-graphql.
    // ts-expect-error: el módulo solo existe en runtime si el plugin está instalado.
    let graphqlModule;
    try {
        // @ts-expect-error optional dep
        graphqlModule = await Promise.resolve().then(() => __importStar(require("graphql")));
    }
    catch {
        throw new Error("Paquete 'graphql' no disponible — viene con @strapi/plugin-graphql. Reinstalá el plugin.");
    }
    const { graphql } = graphqlModule;
    // Estrategias para obtener el schema, en orden:
    let schema;
    const gqlPlugin = strapi.plugin("graphql");
    if (typeof (gqlPlugin === null || gqlPlugin === void 0 ? void 0 : gqlPlugin.service) === "function") {
        const contentApi = gqlPlugin.service("content-api");
        if (contentApi === null || contentApi === void 0 ? void 0 : contentApi.buildSchema) {
            schema = await contentApi.buildSchema();
        }
        else if (contentApi === null || contentApi === void 0 ? void 0 : contentApi.schema) {
            schema = contentApi.schema;
        }
    }
    if (!schema) {
        // Fallback: a veces el schema vive en otro lugar según versión.
        schema = (_a = gqlPlugin === null || gqlPlugin === void 0 ? void 0 : gqlPlugin.schema) !== null && _a !== void 0 ? _a : (_b = gqlPlugin === null || gqlPlugin === void 0 ? void 0 : gqlPlugin.contentApi) === null || _b === void 0 ? void 0 : _b.schema;
    }
    if (!schema) {
        throw new Error("No se pudo obtener el schema de GraphQL desde el plugin. Verificá la versión de @strapi/plugin-graphql.");
    }
    // SECURITY: usamos el auth real del request, NO un context vacío. El plugin
    // GraphQL de Strapi usa state.auth para enforce content-type permissions —
    // con auth vacío algunos resolvers tratan la request como "sin restricción"
    // y exponen campos que el token no debería ver. (Hallazgo H1 del audit.)
    const result = await graphql({
        schema,
        source: query,
        variableValues: variables,
        contextValue: {
            state: {
                auth: auth !== null && auth !== void 0 ? auth : { strategy: { name: "api-token" }, credentials: null },
                user: user !== null && user !== void 0 ? user : null,
            },
        },
    });
    return result;
}
// ─── Helpers para graphql_generate_query ────────────────────────────────────
function uidToGraphqlTypeName(uid, strapi) {
    var _a, _b, _c, _d, _e, _f;
    // Strapi v5 GraphQL plugin convierte UIDs a tipos así:
    //   api::article.article  → query 'article' / 'articles'
    //   api::pagina-alegra.pagina-alegra → 'paginaAlegra' / 'paginaAlegras'
    // Usa info.singularName / pluralName.
    const ct = (_a = strapi.contentTypes) === null || _a === void 0 ? void 0 : _a[uid];
    const singularName = (_d = (_c = (_b = ct === null || ct === void 0 ? void 0 : ct.info) === null || _b === void 0 ? void 0 : _b.singularName) !== null && _c !== void 0 ? _c : uid.split(".").pop()) !== null && _d !== void 0 ? _d : uid;
    const pluralName = (_f = (_e = ct === null || ct === void 0 ? void 0 : ct.info) === null || _e === void 0 ? void 0 : _e.pluralName) !== null && _f !== void 0 ? _f : `${singularName}s`;
    const camel = (s) => s
        .split("-")
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join("");
    return { single: camel(singularName), plural: camel(pluralName) };
}
exports.graphqlTools = [
    // ── 1. graphql_introspect ────────────────────────────────────────────────────
    {
        name: "graphql_introspect",
        description: "Devuelve el resultado de una introspection query sobre el schema GraphQL del proyecto. Útil para que el LLM sepa qué types, queries y mutations existen. Requiere @strapi/plugin-graphql instalado y GRAPHQL_ENABLED=true.",
        inputSchema: {
            type: "object",
            properties: {
                include_descriptions: { type: "boolean", default: true },
            },
            additionalProperties: false,
        },
        handler: async ({ strapi, auth, user }) => {
            assertEnabled();
            // @ts-expect-error optional dep — viene con @strapi/plugin-graphql
            const { getIntrospectionQuery } = await Promise.resolve().then(() => __importStar(require("graphql")));
            const query = getIntrospectionQuery({ descriptions: true });
            return executeGraphql(strapi, query, undefined, auth, user);
        },
    },
    // ── 2. graphql_query ─────────────────────────────────────────────────────────
    {
        name: "graphql_query",
        description: "Ejecuta una query GraphQL (o mutation, si pasás allow_mutations:true) contra el endpoint /graphql del proyecto Strapi. Soporta variables. Útil para testear queries que vas a usar en el frontend, o debuggear shapes de respuesta. Por seguridad, MUTACIONES requieren allow_mutations:true explícito — el MCP tiene tools nativas (create_entry/update_entry/delete_entry) que pasan por validaciones extra (atribución, confirms, etc.), preferí esas para escritura.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "GraphQL query o mutation body completo." },
                variables: { type: "object", description: "Variables del query (opcional)." },
                allow_mutations: {
                    type: "boolean",
                    default: false,
                    description: "Habilita explícitamente la ejecución de mutations. Por default rechazadas.",
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
        handler: async ({ strapi, auth, user }, args) => {
            var _a, _b;
            assertEnabled();
            // Limita el costo de la query (largo, depth, alias-bomb) antes de
            // ejecutarla. Mitiga DoS de queries maliciosas. (M1 del audit.)
            assertQueryLimits(args.query);
            const isMutation = detectsMutation(args.query);
            if (isMutation && !args.allow_mutations) {
                const err = new Error("MUTATION_REQUIRES_EXPLICIT_FLAG");
                err.details = {
                    reason: "Detecté la keyword 'mutation' en la query. Para ejecutar mutations pasá allow_mutations:true. Considerá usar las built-in del MCP (create_entry, update_entry, delete_entry) — pasan por más validaciones y registran atribución por usuario.",
                };
                throw err;
            }
            const result = await executeGraphql(strapi, args.query, args.variables, auth, user);
            return {
                was_mutation: isMutation,
                data: (_a = result.data) !== null && _a !== void 0 ? _a : null,
                errors: (_b = result.errors) !== null && _b !== void 0 ? _b : null,
            };
        },
    },
    // ── 3. graphql_generate_query ────────────────────────────────────────────────
    {
        name: "graphql_generate_query",
        description: "Genera una query GraphQL ARMADA contra el schema real del proyecto: dado un content-type UID y la lista de campos/relaciones que querés traer, devuelve la query GraphQL exacta lista para usar en el frontend. Maneja populate de relations y components automáticamente desde el schema. NO ejecuta la query — solo la construye.",
        inputSchema: {
            type: "object",
            properties: {
                uid: { type: "string", description: "UID del content-type. Ej: api::article.article." },
                operation: {
                    type: "string",
                    enum: ["findOne", "findMany"],
                    default: "findMany",
                    description: "findOne: una entry por documentId. findMany: lista con filters/pagination.",
                },
                fields: {
                    type: "array",
                    items: { type: "string" },
                    description: "Lista de campos top-level a incluir. Para relations/components, agregalos sin sub-selección y el MCP infiere la sub-selección de los campos básicos.",
                },
                deep_relations: {
                    type: "boolean",
                    default: false,
                    description: "Si true, para campos relation/component expande también sus campos básicos (1 nivel). Si false, solo incluye documentId/id.",
                },
            },
            required: ["uid", "fields"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d, _e, _f, _g;
            assertEnabled();
            const ct = (_a = strapi.contentTypes) === null || _a === void 0 ? void 0 : _a[args.uid];
            if (!ct)
                throw new Error(`Content-type "${args.uid}" no existe.`);
            const { single, plural } = uidToGraphqlTypeName(args.uid, strapi);
            const queryName = args.operation === "findOne" ? single : plural;
            // Para cada campo, decidir cómo expanderlo
            const fieldLines = ["documentId"];
            for (const fieldName of args.fields) {
                if (fieldName === "documentId" || fieldName === "id")
                    continue;
                const attr = (_b = ct.attributes) === null || _b === void 0 ? void 0 : _b[fieldName];
                if (!attr) {
                    fieldLines.push(`# WARNING: campo "${fieldName}" no existe en el schema del CT`);
                    continue;
                }
                if (attr.type === "relation") {
                    if (args.deep_relations) {
                        const targetCt = (_c = strapi.contentTypes) === null || _c === void 0 ? void 0 : _c[attr.target];
                        const basicFields = targetCt
                            ? Object.keys((_d = targetCt.attributes) !== null && _d !== void 0 ? _d : {})
                                .filter((k) => {
                                const a = targetCt.attributes[k];
                                return !["relation", "component", "dynamiczone", "media"].includes(a === null || a === void 0 ? void 0 : a.type);
                            })
                                .slice(0, 5)
                            : [];
                        fieldLines.push(`${fieldName} { documentId ${basicFields.join(" ")} }`);
                    }
                    else {
                        fieldLines.push(`${fieldName} { documentId }`);
                    }
                }
                else if (attr.type === "component") {
                    const compUid = attr.component;
                    const comp = (_e = strapi.components) === null || _e === void 0 ? void 0 : _e[compUid];
                    if (args.deep_relations && comp) {
                        const basicFields = Object.keys((_f = comp.attributes) !== null && _f !== void 0 ? _f : {})
                            .filter((k) => {
                            const a = comp.attributes[k];
                            return !["relation", "component", "dynamiczone", "media"].includes(a === null || a === void 0 ? void 0 : a.type);
                        })
                            .slice(0, 5);
                        fieldLines.push(`${fieldName} { ${basicFields.join(" ")} }`);
                    }
                    else {
                        fieldLines.push(`${fieldName} { __typename }`);
                    }
                }
                else if (attr.type === "dynamiczone") {
                    fieldLines.push(`${fieldName} { __typename }`);
                }
                else if (attr.type === "media") {
                    fieldLines.push(`${fieldName} { documentId url alternativeText mime width height }`);
                }
                else {
                    fieldLines.push(fieldName);
                }
            }
            const indent = (depth) => "  ".repeat(depth);
            const body = fieldLines.map((l) => `${indent(2)}${l}`).join("\n");
            let queryStr;
            if (args.operation === "findOne") {
                queryStr = `query Get${plural.charAt(0).toUpperCase() + plural.slice(1)}($documentId: ID!) {
  ${queryName}(documentId: $documentId) {
${body}
  }
}`;
            }
            else {
                queryStr = `query List${plural.charAt(0).toUpperCase() + plural.slice(1)}($filters: ${plural.charAt(0).toUpperCase() + plural.slice(1)}Filters, $pagination: PaginationArg, $sort: [String]) {
  ${queryName}(filters: $filters, pagination: $pagination, sort: $sort) {
${body}
  }
}`;
            }
            return {
                operation: args.operation,
                query_name: queryName,
                graphql_query: queryStr,
                variables_template: args.operation === "findOne"
                    ? { documentId: "<replace-with-real-documentId>" }
                    : { filters: {}, pagination: { page: 1, pageSize: 25 }, sort: ["createdAt:desc"] },
                notes: "Esta query usa el shape estándar de @strapi/plugin-graphql. Algunas convenciones (nombres de filters, sort) dependen de la versión del plugin — testealo con graphql_query antes de meterlo en el frontend.",
                schema_inspected: {
                    uid: args.uid,
                    attributes_used: args.fields,
                    deep_relations: (_g = args.deep_relations) !== null && _g !== void 0 ? _g : false,
                },
            };
        },
    },
];
