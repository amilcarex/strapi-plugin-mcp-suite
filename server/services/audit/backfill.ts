import type { Core } from "@strapi/strapi";

/**
 * Seeds `plugin::strapi-mcp-suite.token-audit` rows for tokens that existed BEFORE
 * the audit system was installed. Without this, those tokens would have no
 * audit row and the `beforeDelete` hook would (correctly) treat them as
 * unattributed legacy tokens — but the user wouldn't know they exist in the
 * audit context at all.
 *
 * Marks each backfilled row with `is_legacy=true`, `creator_id=null`,
 * `creator_email='unknown'`. The delete-permission rule then requires a
 * super-admin to remove them.
 *
 * Idempotent — re-running does not duplicate rows (uses `token_id` uniqueness
 * to skip existing audits).
 */

const TOKEN_AUDIT_UID = "plugin::strapi-mcp-suite.token-audit" as any;
const API_TOKEN_UID = "admin::api-token" as any;

export async function runBackfill(strapi: Core.Strapi): Promise<{ inserted: number; total: number }> {
  let tokens: any[] = [];
  try {
    tokens = await strapi.db.query(API_TOKEN_UID).findMany({
      select: ["id", "name", "type", "createdAt"],
    });
  } catch (err) {
    strapi.log.error(
      `[strapi-mcp audit] backfill: no pude leer tokens existentes: ${String(err)}`
    );
    return { inserted: 0, total: 0 };
  }

  if (tokens.length === 0) {
    return { inserted: 0, total: 0 };
  }

  let existingIds = new Set<number>();
  try {
    const existing = await strapi.db.query(TOKEN_AUDIT_UID).findMany({
      select: ["token_id"],
    });
    existingIds = new Set(existing.map((r: any) => r.token_id).filter((n: any) => typeof n === "number"));
  } catch (err) {
    strapi.log.warn(
      `[strapi-mcp audit] backfill: no pude leer token-audit existente, asumiré vacío: ${String(err)}`
    );
  }

  let inserted = 0;
  for (const tok of tokens) {
    if (existingIds.has(tok.id)) continue;
    try {
      await strapi.db.query(TOKEN_AUDIT_UID).create({
        data: {
          token_id: tok.id,
          token_name: tok.name ?? "(unnamed)",
          token_type: tok.type ?? "unknown",
          creator_id: null,
          creator_email: "unknown",
          created_at_real: tok.createdAt ? new Date(tok.createdAt) : new Date(),
          is_legacy: true,
        },
      });
      inserted++;
    } catch (err) {
      strapi.log.warn(
        `[strapi-mcp audit] backfill: insert falló para token_id=${tok.id}: ${String(err)}`
      );
    }
  }

  if (inserted > 0) {
    strapi.log.info(
      `[strapi-mcp audit] backfilled ${inserted} legacy token(s) ` +
        `(creator=unknown, require super-admin para eliminarlos)`
    );
  }

  return { inserted, total: tokens.length };
}
