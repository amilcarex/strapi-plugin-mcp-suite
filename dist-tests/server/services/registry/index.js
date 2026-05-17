"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validators_1 = require("./validators");
const test_runner_1 = require("./test-runner");
/**
 * Registry de tools custom — el proyecto que monta este plugin agrega sus
 * propias tools de dominio sin forkear el plugin.
 *
 * ─── Estructura estándar de una tool ─────────────────────────────────────────
 *
 *   strapi.plugin('strapi-mcp').service('registry').registerTool({
 *     name: 'my_custom_tool',                       // snake_case, único, no built-in
 *     description: 'Hace X cuando el usuario Y...', // ≥ 30 chars, claro para el LLM
 *     inputSchema: {
 *       type: 'object',
 *       properties: { foo: { type: 'string' } },
 *       required: ['foo'],
 *       additionalProperties: false,                // obligatorio (strict mode)
 *     },
 *     handler: async ({ strapi }, args) => {
 *       return { greeting: `hola ${args.foo}` };
 *     },
 *
 *     // ── Campos opcionales para self-validation ──────────────────────────
 *     outputSchema: {                                // shape esperado del resultado
 *       type: 'object',
 *       properties: { greeting: { type: 'string' } },
 *       required: ['greeting'],
 *     },
 *     testCases: [                                   // corre en bootstrap dev
 *       { name: 'happy', args: { foo: 'mundo' }, expect: { ok: true, shapeIncludes: ['greeting'] } },
 *       { name: 'sin foo', args: {},              expect: { errorMatches: /requerido/ } },
 *     ],
 *     tags: ['read'],                                // ej: 'read' | 'write' | 'destructive'
 *   });
 *
 * Si la validación falla, registerTool tira con un mensaje listando los errores
 * concretos. Si pasa, la tool queda registrada y disponible vía tools/list.
 *
 * Los testCases se corren en bootstrap del plugin cuando NODE_ENV !== 'production'.
 * Resultados quedan en log + accesibles vía la tool built-in `__list_registered_tools`.
 */
const BUILTIN_TOOL_NAMES = new Set([
    // schema-authoring
    "list_existing_schemas",
    "read_schema",
    "validate_schema_proposal",
    "create_component",
    "create_content_type",
    "add_field_to_schema",
    "delete_field_from_schema",
    // content-ops
    "list_content_types",
    "get_content_type_schema",
    "find_entries",
    "get_entry",
    "create_entry",
    "update_entry",
    "delete_entry",
    "publish_entry",
    "unpublish_entry",
    // layout-ops
    "get_visual_layout",
    "set_field_layout",
    "set_field_metadata",
    "set_view_settings",
    // registry-tools
    "__list_registered_tools",
    // health-tools
    "__health",
    // upload-tools (gated por UPLOAD_ENABLED)
    "list_media",
    "get_media",
    "upload_media_from_url",
    "update_media_metadata",
    "delete_media",
    "link_media_to_entry",
    // graphql-tools (gated por GRAPHQL_ENABLED)
    "graphql_introspect",
    "graphql_query",
    "graphql_generate_query",
]);
// State singleton in-memory por proceso.
const registeredTools = new Map();
const lastTestSummaries = new Map();
exports.default = ({ strapi }) => ({
    /**
     * Registra una tool custom. Valida estructura y devuelve OK o tira con detalle.
     * En dev, los testCases (si los hay) se correrán automáticamente al final del
     * bootstrap del plugin via `runSelfTests()`.
     */
    registerTool(tool) {
        var _a;
        const validation = (0, validators_1.validateToolDefinition)(tool, BUILTIN_TOOL_NAMES);
        if (!validation.valid) {
            const errMsg = validation.errors
                .map((e) => `  • ${e.field}: ${e.message}`)
                .join("\n");
            throw new Error(`[strapi-mcp registry] No se pudo registrar la tool "${(_a = tool === null || tool === void 0 ? void 0 : tool.name) !== null && _a !== void 0 ? _a : "<sin nombre>"}". Errores:\n${errMsg}`);
        }
        if (registeredTools.has(tool.name)) {
            strapi.log.warn(`[strapi-mcp registry] Tool "${tool.name}" ya estaba registrada. Sobrescribiendo definición.`);
            lastTestSummaries.delete(tool.name);
        }
        registeredTools.set(tool.name, tool);
        const ext = (0, validators_1.getToolExtensions)(tool);
        const flags = [];
        if (ext.hasTestCases)
            flags.push(`${ext.testCaseCount} testCases`);
        if (ext.hasOutputSchema)
            flags.push("outputSchema");
        if (ext.tags.length > 0)
            flags.push(`tags=[${ext.tags.join(",")}]`);
        const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
        strapi.log.info(`[strapi-mcp registry] Tool registrada: ${tool.name}${suffix}`);
    },
    unregisterTool(name) {
        lastTestSummaries.delete(name);
        return registeredTools.delete(name);
    },
    getTools() {
        return Array.from(registeredTools.values());
    },
    hasBuiltin(name) {
        return BUILTIN_TOOL_NAMES.has(name);
    },
    getBuiltinNames() {
        return Array.from(BUILTIN_TOOL_NAMES).sort();
    },
    getLastTestSummaries() {
        return Object.fromEntries(lastTestSummaries);
    },
    /**
     * Corre testCases de todas las tools registradas. Idempotente — se puede
     * llamar varias veces. Skip silencioso en producción.
     */
    async runSelfTests() {
        if ((0, test_runner_1.isProduction)()) {
            strapi.log.info("[strapi-mcp registry] runSelfTests skip (NODE_ENV=production)");
            return { total: registeredTools.size, tested: 0, failures: 0 };
        }
        let tested = 0;
        let failures = 0;
        for (const tool of registeredTools.values()) {
            const summary = await (0, test_runner_1.runTestCasesFor)(strapi, tool);
            if (!summary)
                continue;
            tested++;
            lastTestSummaries.set(tool.name, summary);
            if (summary.failed > 0)
                failures++;
            const message = (0, test_runner_1.formatSummary)(summary);
            if (summary.failed > 0)
                strapi.log.warn(message);
            else
                strapi.log.info(message);
        }
        if (tested === 0 && registeredTools.size > 0) {
            strapi.log.info(`[strapi-mcp registry] ${registeredTools.size} tool(s) custom registrada(s), ninguna declaró testCases.`);
        }
        return { total: registeredTools.size, tested, failures };
    },
    clear() {
        registeredTools.clear();
        lastTestSummaries.clear();
    },
});
