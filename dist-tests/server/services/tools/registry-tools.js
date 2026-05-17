"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registryTools = void 0;
/**
 * Tools built-in que exponen el estado del registry de tools custom.
 *
 * Útil para que clientes MCP (Claude, etc.) puedan preguntar "qué tools custom
 * tiene este proyecto" sin entrar al admin de Strapi ni a logs.
 *
 * El name empieza con `__` para indicar que es introspección interna del plugin,
 * y no se confunda con tools de dominio del proyecto.
 */
exports.registryTools = [
    {
        name: "__list_registered_tools",
        description: "Devuelve el inventario de tools del plugin: built-in (con su categoría), custom registradas por este proyecto via registerTool, y los resultados del último runSelfTests para cada tool custom que haya declarado testCases. Útil para diagnóstico — qué tools existen y cuáles pasaron sus self-tests.",
        inputSchema: {
            type: "object",
            properties: {
                include_custom_only: {
                    type: "boolean",
                    description: "Si true, omite las built-in y devuelve solo las custom registradas.",
                    default: false,
                },
            },
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d, _e, _f;
            const registry = strapi.plugin("strapi-mcp").service("registry");
            const customTools = ((_b = (_a = registry.getTools) === null || _a === void 0 ? void 0 : _a.call(registry)) !== null && _b !== void 0 ? _b : []);
            const summaries = (_d = (_c = registry.getLastTestSummaries) === null || _c === void 0 ? void 0 : _c.call(registry)) !== null && _d !== void 0 ? _d : {};
            const builtinNames = (_f = (_e = registry.getBuiltinNames) === null || _e === void 0 ? void 0 : _e.call(registry)) !== null && _f !== void 0 ? _f : [];
            const custom = customTools.map((t) => {
                var _a;
                return ({
                    name: t.name,
                    description: t.description,
                    tags: Array.isArray(t.tags) ? t.tags : [],
                    has_output_schema: !!t.outputSchema,
                    test_cases_declared: Array.isArray(t.testCases) ? t.testCases.length : 0,
                    last_self_test: (_a = summaries[t.name]) !== null && _a !== void 0 ? _a : null,
                    origin: "custom",
                });
            });
            if (args.include_custom_only) {
                return {
                    custom,
                    custom_count: custom.length,
                    schema_authoring_enabled: process.env.SCHEMA_AUTHORING_ENABLED === "true",
                    upload_enabled: process.env.UPLOAD_ENABLED === "true",
                    graphql_enabled: process.env.GRAPHQL_ENABLED === "true",
                };
            }
            // Categorizar built-in para que el cliente entienda qué hay
            const builtin = builtinNames.map((name) => {
                let category;
                if (name === "__health")
                    category = "health";
                else if (name.startsWith("__"))
                    category = "registry";
                else if (["get_visual_layout", "set_field_layout", "set_field_metadata", "set_view_settings"].includes(name))
                    category = "layout-ops";
                else if (["list_existing_schemas", "read_schema", "validate_schema_proposal", "create_component",
                    "create_content_type", "add_field_to_schema", "delete_field_from_schema"].includes(name))
                    category = "schema-authoring";
                else if (["list_media", "get_media", "upload_media_from_url", "update_media_metadata",
                    "delete_media", "link_media_to_entry"].includes(name))
                    category = "upload";
                else if (["graphql_introspect", "graphql_query", "graphql_generate_query"].includes(name))
                    category = "graphql";
                else
                    category = "content-ops";
                return { name, category, origin: "builtin" };
            });
            return {
                builtin,
                builtin_count: builtin.length,
                custom,
                custom_count: custom.length,
                schema_authoring_enabled: process.env.SCHEMA_AUTHORING_ENABLED === "true",
                upload_enabled: process.env.UPLOAD_ENABLED === "true",
                graphql_enabled: process.env.GRAPHQL_ENABLED === "true",
                gating_note: "Las tools de schema-authoring/upload/graphql solo aparecen en tools/list cuando su flag está en true. Acá aparecen siempre en builtin[] como referencia, junto con el estado del flag.",
            };
        },
    },
];
