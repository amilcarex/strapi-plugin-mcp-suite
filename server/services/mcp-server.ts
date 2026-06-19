import type { Core } from "@strapi/strapi";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { ToolDefinition } from "./tools/types";
import { PLUGIN_NAME, PLUGIN_VERSION } from "../plugin-meta";
import { resolveRuntimeFlags } from "./feature-flags";
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
 * Gating (config-driven desde v0.7.0; ver `services/feature-flags.ts`).
 * Precedencia: default → config del plugin (`config/plugins.ts`) → env override.
 *
 *   - contentOps (default true) → CRUD de entries + publish/unpublish.
 *     Ponlo en `false` cuando el MCP nativo de Strapi 5.47+ maneje el CRUD,
 *     para no exponer tools duplicadas. Override: CONTENT_OPS_ENABLED.
 *   - schemaAuthoring (default false) → tools que escriben schema al filesystem
 *     de `src/api` / `src/components`. No debería ser silently-on: el dev decide.
 *     Override: SCHEMA_AUTHORING_ENABLED.
 *   - upload (default false) → tools de media library. Si no hay provider
 *     configurado (S3/Cloudinary/etc.), los uploads tiran. Override: UPLOAD_ENABLED.
 *   - graphql (default false) → tools de GraphQL. @strapi/plugin-graphql es opt-in
 *     en Strapi v5 y puede no estar instalado. Override: GRAPHQL_ENABLED.
 *
 *   - process.env.NODE_ENV=production → si las authoring tools están enabled,
 *     siguen apareciendo en list_tools pero los writers refusan en runtime
 *     con SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION (safety net adicional).
 *
 * Tools custom registradas via `strapi.plugin('strapi-mcp-suite').service('registry')
 * .registerTool(...)` se agregan al array final.
 */
// Guard de proceso: createMcpServer corre por request, así que logueamos el
// estado de coexistencia una sola vez para no inundar los logs.
let coexistenceLogged = false;

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
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
    },
    {
      capabilities: { tools: {} },
    }
  );

  const tools: ToolDefinition[] = [];

  // Flags resueltos: default → config → env override, + coexistencia con el
  // MCP nativo (auto-supresión de contentOps si el nativo está activo).
  const { flags, nativeActive, contentOpsSuppressed } = resolveRuntimeFlags(strapi);
  if (contentOpsSuppressed && !coexistenceLogged) {
    coexistenceLogged = true;
    strapi.log.info(
      '[strapi-mcp] MCP nativo activo (server.mcp.enabled) — contentOps auto-suprimido para no duplicar el CRUD. ' +
        'Forzá el CRUD del plugin con coexistence:"standalone" o CONTENT_OPS_ENABLED=true.'
    );
  } else if (nativeActive && flags.contentOps && !coexistenceLogged) {
    coexistenceLogged = true;
    strapi.log.info(
      "[strapi-mcp] MCP nativo activo pero contentOps sigue ON (coexistence:standalone o CONTENT_OPS_ENABLED=true) — habrá tools de CRUD duplicadas con el nativo."
    );
  }

  // Schema authoring: opt-in.
  if (flags.schemaAuthoring) {
    tools.push(...schemaAuthoringTools);
  }

  // Content ops (CRUD): on por default; apagable para convivir con el MCP nativo.
  if (flags.contentOps) {
    tools.push(...contentOpsTools);
  }

  // Siempre disponibles: son los diferenciadores que el nativo no expone.
  tools.push(...layoutOpsTools);
  tools.push(...registryTools);
  tools.push(...healthTools);
  tools.push(...auditTools);

  // Upload tools: opt-in.
  if (flags.upload) {
    tools.push(...uploadTools);
  }

  // GraphQL tools: opt-in (también requiere @strapi/plugin-graphql instalado;
  // si no, los handlers tiran error claro al invocarse).
  if (flags.graphql) {
    tools.push(...graphqlTools);
  }

  // Tools registradas por el proyecto consumidor.
  try {
    const registry = strapi.plugin("strapi-mcp-suite").service("registry") as any;
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
