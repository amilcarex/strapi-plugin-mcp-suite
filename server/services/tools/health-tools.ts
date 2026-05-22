import type { ToolDefinition } from "./types";

/**
 * Tools de health / liveness del plugin MCP.
 *
 * `__health` es la tool más liviana del plugin — solo devuelve un timestamp y
 * estado del proceso. Pensada para que el LLM la use como ping después de una
 * operación de schema-authoring (create_content_type, create_component, etc.)
 * que dispara un restart de Strapi en dev mode.
 *
 * Patrón de uso esperado:
 *   1. LLM llama `create_content_type` y recibe `restart_info` en la respuesta.
 *   2. LLM espera ~12s (o el `estimated_downtime_seconds` que vino).
 *   3. LLM llama `__health`. Si responde → Strapi está ready para la próxima op.
 *      Si falla con ECONNREFUSED/timeout → Strapi sigue arrancando, retry en 2-3s.
 */

const PLUGIN_VERSION = "0.5.0";
const PROCESS_STARTED_AT = new Date().toISOString();

export const healthTools: ToolDefinition[] = [
  {
    name: "__health",
    description:
      "Ping liviano del plugin. Devuelve estado, versión, timestamp y uptime del proceso Strapi. ÚSALA después de una operación de schema-authoring que disparó restart (create_content_type, create_component, add_field_to_schema, delete_field_from_schema) para confirmar que Strapi terminó de recargar. Si esta tool responde, podés seguir con otras tools. Si la llamada falla con ECONNREFUSED o timeout, Strapi todavía está reiniciando — reintenta en 2-3s.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async ({ strapi }) => {
      const now = new Date();
      const startedAt = new Date(PROCESS_STARTED_AT);
      const uptimeMs = now.getTime() - startedAt.getTime();
      const uptimeSeconds = Math.floor(uptimeMs / 1000);

      return {
        ok: true,
        plugin: "strapi-mcp-suite",
        plugin_version: PLUGIN_VERSION,
        strapi_version: (strapi as any).config?.info?.strapi ?? "unknown",
        server_time: now.toISOString(),
        process_started_at: PROCESS_STARTED_AT,
        uptime_seconds: uptimeSeconds,
        uptime_human: humanizeUptime(uptimeSeconds),
        schema_authoring_enabled: process.env.SCHEMA_AUTHORING_ENABLED === "true",
        node_env: process.env.NODE_ENV ?? "development",
        hint:
          uptimeSeconds < 30
            ? "Strapi acaba de arrancar. Si veniás de una op de schema-authoring, ya podés continuar."
            : "Strapi corriendo normalmente.",
      };
    },
  },
];

function humanizeUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
