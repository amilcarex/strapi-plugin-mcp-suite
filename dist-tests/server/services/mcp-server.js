"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const schema_authoring_1 = require("./tools/schema-authoring");
const content_ops_1 = require("./tools/content-ops");
const layout_ops_1 = require("./tools/layout-ops");
const registry_tools_1 = require("./tools/registry-tools");
const health_tools_1 = require("./tools/health-tools");
const upload_tools_1 = require("./tools/upload-tools");
const graphql_tools_1 = require("./tools/graphql-tools");
function createMcpServer(strapi, ctx = {}) {
    var _a, _b;
    const server = new index_js_1.Server({
        name: "strapi-mcp",
        version: "0.2.0",
    }, {
        capabilities: { tools: {} },
    });
    const tools = [];
    // Schema authoring: opt-in.
    const schemaAuthoringEnabled = process.env.SCHEMA_AUTHORING_ENABLED === "true";
    if (schemaAuthoringEnabled) {
        tools.push(...schema_authoring_1.schemaAuthoringTools);
    }
    tools.push(...content_ops_1.contentOpsTools);
    tools.push(...layout_ops_1.layoutOpsTools);
    tools.push(...registry_tools_1.registryTools);
    tools.push(...health_tools_1.healthTools);
    // Upload tools: opt-in.
    if (process.env.UPLOAD_ENABLED === "true") {
        tools.push(...upload_tools_1.uploadTools);
    }
    // GraphQL tools: opt-in (también requiere @strapi/plugin-graphql instalado;
    // si no, los handlers tiran error claro al invocarse).
    if (process.env.GRAPHQL_ENABLED === "true") {
        tools.push(...graphql_tools_1.graphqlTools);
    }
    // Tools registradas por el proyecto consumidor.
    try {
        const registry = strapi.plugin("strapi-mcp").service("registry");
        const custom = ((_b = (_a = registry === null || registry === void 0 ? void 0 : registry.getTools) === null || _a === void 0 ? void 0 : _a.call(registry)) !== null && _b !== void 0 ? _b : []);
        if (custom.length > 0) {
            tools.push(...custom);
        }
    }
    catch (err) {
        strapi.log.warn(`[strapi-mcp] No pude leer tools custom del registry: ${String(err)}`);
    }
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
        tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        })),
    }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const tool = tools.find((t) => t.name === name);
        if (!tool) {
            throw new Error(`Tool "${name}" no encontrada. Tools disponibles: ${tools.map((t) => t.name).join(", ")}.`);
        }
        try {
            const result = await tool.handler({ strapi, auth: ctx.auth, user: ctx.user }, (args !== null && args !== void 0 ? args : {}));
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const details = err === null || err === void 0 ? void 0 : err.details;
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ error: message, details }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
