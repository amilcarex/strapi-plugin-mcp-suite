import type { Core } from "@strapi/strapi";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { ToolDefinition } from "./tools/types";
import { schemaAuthoringTools } from "./tools/schema-authoring";
import { contentOpsTools } from "./tools/content-ops";
import { layoutOpsTools } from "./tools/layout-ops";
import { registryTools } from "./tools/registry-tools";
import { healthTools } from "./tools/health-tools";
import { uploadTools } from "./tools/upload-tools";
import { graphqlTools } from "./tools/graphql-tools";
import { auditTools } from "./tools/audit-tools";
import { logOperation } from "./audit/logger";

/**
 * Construye una instancia MCP Server con las tools registradas.
 *
 * Gating (todos opt-in, default oculto):
 *   - SCHEMA_AUTHORING_ENABLED=true → expone las 7 tools de schema authoring.
 *     Razón: escribir al filesystem de `src/api` / `src/components` desde un
 *     MCP no debería ser silently-on. El dev decide.
 *   - UPLOAD_ENABLED=true → expone las 6 tools de upload (media library).
 *     Razón: si no hay provider configurado (S3/Cloudinary/etc.), uploads tiran.
 *   - GRAPHQL_ENABLED=true → expone las 3 tools de GraphQL.
 *     Razón: @strapi/plugin-graphql es opt-in en Strapi v5, puede no estar instalado.
 *
 *   - process.env.NODE_ENV=production → si las authoring tools están enabled,
 *     siguen apareciendo en list_tools pero los writers refusan en runtime
 *     con SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION (safety net adicional).
 *
 * Tools custom registradas via `strapi.plugin('strapi-mcp').service('registry')
 * .registerTool(...)` se agregan al array final.
 */
export interface McpServerContext {
  auth?: any;
  user?: any;
  /**
   * Request metadata propagated from the HTTP controller for audit logging.
   * `ip` and `userAgent` are written to `op-log` rows.
   */
  request?: {
    ip?: string;
    userAgent?: string;
  };
}

export function createMcpServer(strapi: Core.Strapi, ctx: McpServerContext = {}) {
  const server = new Server(
    {
      name: "strapi-mcp",
      version: "0.4.0",
    },
    {
      capabilities: { tools: {} },
    }
  );

  const tools: ToolDefinition[] = [];

  // Schema authoring: opt-in.
  const schemaAuthoringEnabled = process.env.SCHEMA_AUTHORING_ENABLED === "true";
  if (schemaAuthoringEnabled) {
    tools.push(...schemaAuthoringTools);
  }

  tools.push(...contentOpsTools);
  tools.push(...layoutOpsTools);
  tools.push(...registryTools);
  tools.push(...healthTools);
  tools.push(...auditTools);

  // Upload tools: opt-in.
  if (process.env.UPLOAD_ENABLED === "true") {
    tools.push(...uploadTools);
  }

  // GraphQL tools: opt-in (también requiere @strapi/plugin-graphql instalado;
  // si no, los handlers tiran error claro al invocarse).
  if (process.env.GRAPHQL_ENABLED === "true") {
    tools.push(...graphqlTools);
  }

  // Tools registradas por el proyecto consumidor.
  try {
    const registry = strapi.plugin("strapi-mcp").service("registry") as any;
    const custom = (registry?.getTools?.() ?? []) as ToolDefinition[];
    if (custom.length > 0) {
      tools.push(...custom);
    }
  } catch (err) {
    strapi.log.warn(`[strapi-mcp] No pude leer tools custom del registry: ${String(err)}`);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      throw new Error(
        `Tool "${name}" no encontrada. Tools disponibles: ${tools.map((t) => t.name).join(", ")}.`
      );
    }

    // Audit log instrumentation (v0.4.0). Runs around the handler; never
    // throws on its own bookkeeping failures. The handler's outcome — success
    // or thrown error — is captured and persisted to op-log via logOperation.
    const startedAt = Date.now();
    const apiToken = ctx.auth?.credentials ?? null;
    let logged = false;

    try {
      const result = await tool.handler(
        { strapi, auth: ctx.auth, user: ctx.user },
        (args ?? {}) as any
      );
      logged = true;
      logOperation(strapi, {
        toolName: name,
        args: args ?? {},
        result,
        status: "ok",
        durationMs: Date.now() - startedAt,
        apiToken,
        user: ctx.user,
        request: ctx.request,
      }).catch(() => undefined);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (!logged) {
        logOperation(strapi, {
          toolName: name,
          args: args ?? {},
          error: err,
          status: "error",
          durationMs: Date.now() - startedAt,
          apiToken,
          user: ctx.user,
          request: ctx.request,
        }).catch(() => undefined);
      }
      const message = err instanceof Error ? err.message : String(err);
      const details = (err as any)?.details;
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
