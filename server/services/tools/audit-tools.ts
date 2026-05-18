import type { ToolDefinition, ToolContext } from "./types";

/**
 * Audit-trail introspection tools (v0.4.0). Read-only views over the two
 * internal audit tables. Gated to super-admins: the policy
 * `require-api-token` validates the API token, then EACH handler checks the
 * `ctx.user.roles` list for `strapi-super-admin`.
 *
 * If the token has no resolved admin user (the typical content-api token in
 * Strapi 5.x where `adminUserOwner` is null), the check fails and the tool
 * returns `AUDIT_REQUIRES_SUPER_ADMIN`. To use these tools at all, the
 * operator needs a token whose owner is a super-admin AND the future flag
 * `features.future.adminTokens: true` (so adminUserOwner populates).
 *
 * Why so strict: the audit log can contain references to data the LLM
 * shouldn't see in aggregate (every find_entries call, every documentId
 * touched). Even with secrets redacted, exposing this freely to any
 * authenticated MCP token would defeat the purpose.
 */

const TOKEN_AUDIT_UID = "plugin::strapi-mcp.token-audit" as any;
const OP_LOG_UID = "plugin::strapi-mcp.op-log" as any;
const SUPER_ADMIN_CODE = "strapi-super-admin";

function denyIfNotSuperAdmin(ctx: ToolContext): { error: string; details: any } | null {
  const user: any = ctx.user;
  const roles: any[] = Array.isArray(user?.roles) ? user.roles : [];
  const isSuperAdmin = roles.some((r) => r?.code === SUPER_ADMIN_CODE);
  if (isSuperAdmin) return null;
  return {
    error: "AUDIT_REQUIRES_SUPER_ADMIN",
    details: {
      reason:
        "Las tools de auditoría solo pueden invocarse con un token cuyo dueño sea super-admin. " +
        "Requisitos: (1) Strapi >=5.45.0 con `features.future.adminTokens: true` en config/admin.ts, " +
        "y (2) el token se creó desde la sesión admin de un super-admin (no es un content-api token genérico).",
      caller_id: user?.id ?? null,
      caller_email: user?.email ?? null,
    },
  };
}

const tokenCreators: ToolDefinition = {
  name: "__audit_token_creators",
  description:
    "Lista quién creó cada API token (y quién lo eliminó si aplica). Requiere super-admin. " +
    "Útil para revisar el universo de tokens activos y detectar legacy tokens (creator='unknown'). " +
    "Devuelve hasta 500 filas, ordenadas por created_at_real desc.",
  inputSchema: {
    type: "object",
    properties: {
      include_deleted: {
        type: "boolean",
        description: "Si true, incluye tokens ya eliminados (con deleter_email y deleted_at). Default true.",
      },
      limit: {
        type: "number",
        description: "Máximo de filas a devolver. Cap 500.",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args: any) {
    const denial = denyIfNotSuperAdmin(ctx);
    if (denial) return denial;

    const includeDeleted = args?.include_deleted !== false;
    const limit = Math.min(500, Math.max(1, parseInt(String(args?.limit ?? 200), 10) || 200));

    const where: any = includeDeleted ? {} : { deleted_at: { $null: true } };
    const rows = await ctx.strapi.db.query(TOKEN_AUDIT_UID).findMany({
      where,
      orderBy: { created_at_real: "desc" },
      limit,
    });

    return {
      count: rows.length,
      tokens: rows.map((r: any) => ({
        token_id: r.token_id,
        token_name: r.token_name,
        token_type: r.token_type,
        creator_id: r.creator_id,
        creator_email: r.creator_email,
        created_at: r.created_at_real,
        deleter_id: r.deleter_id ?? null,
        deleter_email: r.deleter_email ?? null,
        deleted_at: r.deleted_at ?? null,
        is_legacy: !!r.is_legacy,
      })),
    };
  },
};

const logQuery: ToolDefinition = {
  name: "__audit_log_query",
  description:
    "Consulta el log de operaciones MCP. Requiere super-admin. " +
    "Filtros opcionales: token_id, admin_user_id, tool_name, status (ok|error), since (ISO date), until (ISO date). " +
    "Por defecto NO devuelve args_redacted ni result_summary (pasá include_payloads=true para verlos). " +
    "Cap 500 filas, ordenadas desc por ts.",
  inputSchema: {
    type: "object",
    properties: {
      token_id: { type: "number" },
      admin_user_id: { type: "number" },
      tool_name: { type: "string" },
      status: { type: "string", enum: ["ok", "error"] },
      since: { type: "string", description: "ISO 8601 datetime. Filtra ts >= since." },
      until: { type: "string", description: "ISO 8601 datetime. Filtra ts <= until." },
      limit: { type: "number", description: "Máximo de filas. Cap 500. Default 100." },
      include_payloads: {
        type: "boolean",
        description: "Si true, incluye args_redacted y result_summary en cada fila. Default false.",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args: any) {
    const denial = denyIfNotSuperAdmin(ctx);
    if (denial) return denial;

    const where: any = {};
    if (typeof args?.token_id === "number") where.token_id = args.token_id;
    if (typeof args?.admin_user_id === "number") where.admin_user_id = args.admin_user_id;
    if (typeof args?.tool_name === "string" && args.tool_name) where.tool_name = args.tool_name;
    if (args?.status === "ok" || args?.status === "error") where.status = args.status;
    if (typeof args?.since === "string" && args.since) {
      const d = new Date(args.since);
      if (!isNaN(d.getTime())) (where.ts = where.ts ?? {}).$gte = d;
    }
    if (typeof args?.until === "string" && args.until) {
      const d = new Date(args.until);
      if (!isNaN(d.getTime())) (where.ts = where.ts ?? {}).$lte = d;
    }

    const limit = Math.min(500, Math.max(1, parseInt(String(args?.limit ?? 100), 10) || 100));
    const includePayloads = args?.include_payloads === true;

    const rows = await ctx.strapi.db.query(OP_LOG_UID).findMany({
      where,
      orderBy: { ts: "desc" },
      limit,
    });

    return {
      count: rows.length,
      filters: where,
      include_payloads: includePayloads,
      rows: rows.map((r: any) => {
        const out: any = {
          id: r.id,
          ts: r.ts,
          token_id: r.token_id,
          admin_user_id: r.admin_user_id,
          admin_email: r.admin_email,
          tool_name: r.tool_name,
          status: r.status,
          duration_ms: r.duration_ms,
          ip: r.ip,
          user_agent: r.user_agent,
        };
        if (r.error_message) out.error_message = r.error_message;
        if (includePayloads) {
          out.args_redacted = r.args_redacted;
          out.result_summary = r.result_summary;
        }
        return out;
      }),
    };
  },
};

export const auditTools: ToolDefinition[] = [tokenCreators, logQuery];
