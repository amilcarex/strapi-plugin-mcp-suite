import type { Core } from "@strapi/strapi";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer } from "../services/mcp-server";

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
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async handle(ctx: any) {
    ctx.respond = false;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Pasamos auth/user resueltos por la policy require-api-token al server,
    // para que las tools (especialmente graphql_query) puedan reusar el contexto
    // de auth en lugar de ejecutar con auth vacío (que bypasea permission checks
    // del plugin GraphQL).
    //
    // `request` propaga IP y user-agent al audit log (v0.4.0). `ctx.request.ip`
    // resolves via Koa's proxy setting; behind a load balancer the operator
    // should set `koa.proxy: true` for accurate values, but we don't enforce it.
    const userAgent =
      ctx.request?.headers?.["user-agent"] ?? ctx.request?.header?.["user-agent"] ?? "";
    const server = createMcpServer(strapi, {
      auth: ctx.state?.auth,
      user: ctx.state?.user,
      request: {
        ip: ctx.request?.ip,
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      },
    });

    ctx.res.on("close", () => {
      transport.close().catch((err: unknown) => {
        strapi.log.error(`[strapi-mcp] error cerrando transport: ${String(err)}`);
      });
    });

    await server.connect(transport);
    await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
  },
});
