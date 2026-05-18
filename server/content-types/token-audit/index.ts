/**
 * `plugin::strapi-mcp.token-audit` — 1 fila por API token observado.
 *
 * Forensic trail: who created each token, when, and (if applicable) who deleted
 * it. Created via lifecycle hooks on `admin::api-token` (afterCreate /
 * afterDelete) and seeded for pre-existing tokens via the bootstrap backfill.
 *
 * Hidden from Content Manager and Content-Type Builder (`pluginOptions.visible:
 * false`) — internal table, not user-facing data.
 */
export default {
  schema: {
    collectionName: "mcp_token_audits",
    info: {
      singularName: "token-audit",
      pluralName: "token-audits",
      displayName: "MCP Token Audit",
      description:
        "Forensic record of API token creation/deletion events. Internal — not exposed via REST/GraphQL.",
    },
    pluginOptions: {
      "content-manager": { visible: false },
      "content-type-builder": { visible: false },
    },
    options: {
      draftAndPublish: false,
    },
    attributes: {
      token_id: { type: "integer", required: true, unique: true },
      token_name: { type: "string", required: true },
      token_type: { type: "string", required: true },
      creator_id: { type: "integer" },
      creator_email: { type: "string" },
      created_at_real: { type: "datetime", required: true },
      deleter_id: { type: "integer" },
      deleter_email: { type: "string" },
      deleted_at: { type: "datetime" },
      is_legacy: { type: "boolean", default: false },
    },
  },
};
