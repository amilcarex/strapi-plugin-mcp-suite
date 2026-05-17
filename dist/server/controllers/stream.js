"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const mcp_server_1 = require("../services/mcp-server");
/**
 * Maneja una request MCP delegándola al StreamableHTTPServerTransport del SDK.
 *
 * Patrón Koa ↔ MCP transport:
 * 1. `ctx.respond = false` cede el control de la respuesta al transport.
 * 2. El transport recibe `ctx.req` (IncomingMessage), `ctx.res` (ServerResponse)
 *    y el body parseado por Koa.
 * 3. Modo stateless (`sessionIdGenerator: undefined`): cada request es independiente.
 *
 * Cada request crea un Server nuevo. Como las tools son funciones puras (delegan a
 * `strapi.documents()` y a fs/utilidades), el overhead es despreciable.
 */
exports.default = ({ strapi }) => ({
    async handle(ctx) {
        var _a, _b;
        ctx.respond = false;
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        // Pasamos auth/user resueltos por la policy require-api-token al server,
        // para que las tools (especialmente graphql_query) puedan reusar el contexto
        // de auth en lugar de ejecutar con auth vacío (que bypasea permission checks
        // del plugin GraphQL).
        const server = (0, mcp_server_1.createMcpServer)(strapi, {
            auth: (_a = ctx.state) === null || _a === void 0 ? void 0 : _a.auth,
            user: (_b = ctx.state) === null || _b === void 0 ? void 0 : _b.user,
        });
        ctx.res.on("close", () => {
            transport.close().catch((err) => {
                strapi.log.error(`[strapi-mcp] error cerrando transport: ${String(err)}`);
            });
        });
        await server.connect(transport);
        await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
    },
});
