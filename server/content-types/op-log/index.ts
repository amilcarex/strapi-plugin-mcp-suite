/**
 * `plugin::strapi-mcp.op-log` — 1 fila por `tools/call` MCP ejecutado.
 *
 * Written from `mcp-server.ts` after each tool handler resolves (success or
 * error). `args_redacted` strips secret-shaped keys before persisting;
 * `result_summary` is a small extraction (documentId, count, uid, op) — never
 * the full payload — to keep the table bounded.
 *
 * Retention is handled by `services/audit/cleanup.ts` (age + row cap, both
 * configurable via env vars).
 *
 * Hidden from Content Manager and Content-Type Builder.
 */
export default {
  schema: {
    collectionName: "mcp_op_logs",
    info: {
      singularName: "op-log",
      pluralName: "op-logs",
      displayName: "MCP Operation Log",
      description:
        "Forensic log of MCP tool invocations. Internal — not exposed via REST/GraphQL.",
    },
    pluginOptions: {
      "content-manager": { visible: false },
      "content-type-builder": { visible: false },
    },
    options: {
      draftAndPublish: false,
    },
    attributes: {
      ts: { type: "datetime", required: true },
      token_id: { type: "integer" },
      admin_user_id: { type: "integer" },
      admin_email: { type: "string" },
      tool_name: { type: "string", required: true },
      args_redacted: { type: "json" },
      status: { type: "string", required: true },
      error_message: { type: "text" },
      result_summary: { type: "json" },
      duration_ms: { type: "integer" },
      ip: { type: "string" },
      user_agent: { type: "string" },
      // v0.6.0: true when tool_name is a destructive operation (delete_*).
      // Lets a super-admin filter the forensic log for the high-risk ops fast:
      //   SELECT * FROM mcp_op_logs WHERE destructive = 1 ORDER BY ts DESC
      destructive: { type: "boolean", default: false },
    },
  },
};
