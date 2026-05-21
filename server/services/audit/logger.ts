import type { Core } from "@strapi/strapi";
import { redactSecrets } from "./redact";
import { summarizeResult } from "./summarize";

/**
 * Single entry-point used by `mcp-server.ts` to persist one operation record
 * after a tool handler resolves (success or failure).
 *
 * Failures here NEVER propagate — they are logged but swallowed. The audit
 * log is observability, not part of the success path of the tool.
 */

const OP_LOG_UID = "plugin::strapi-mcp.op-log" as any;

/**
 * Tool names considered destructive. Op-log rows for these get `destructive:true`
 * so a super-admin can filter the forensic log for high-risk operations fast.
 * Kept as an explicit allowlist (not a `delete_*` regex) so a future read tool
 * that happens to start with "delete" isn't mis-flagged.
 */
const DESTRUCTIVE_TOOLS = new Set([
  "delete_entry",
  "delete_field_from_schema",
  "delete_media",
]);

/** True when the tool name is a known destructive operation. */
export function isDestructiveTool(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

export interface LogOperationFields {
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: unknown;
  status: "ok" | "error";
  durationMs: number;
  apiToken?: { id?: number | null } | null;
  user?: { id?: number | null; email?: string | null } | null;
  request?: { ip?: string; userAgent?: string } | null;
}

export async function logOperation(strapi: Core.Strapi, fields: LogOperationFields): Promise<void> {
  try {
    const args_redacted = redactSecrets(fields.args ?? null);
    const result_summary =
      fields.status === "ok" ? summarizeResult(fields.toolName, fields.result) : null;
    const error_message =
      fields.status === "error"
        ? fields.error instanceof Error
          ? fields.error.message
          : String(fields.error)
        : null;

    await strapi.db.query(OP_LOG_UID).create({
      data: {
        ts: new Date(),
        token_id: fields.apiToken?.id ?? null,
        admin_user_id: fields.user?.id ?? null,
        admin_email: fields.user?.email ?? null,
        tool_name: fields.toolName,
        args_redacted,
        status: fields.status,
        error_message,
        result_summary,
        duration_ms: Math.max(0, Math.round(fields.durationMs)),
        ip: fields.request?.ip ?? null,
        user_agent: fields.request?.userAgent ?? null,
        destructive: isDestructiveTool(fields.toolName),
      },
    });
  } catch (err) {
    strapi.log.warn(`[strapi-mcp audit] logOperation falló: ${String(err)}`);
  }
}
