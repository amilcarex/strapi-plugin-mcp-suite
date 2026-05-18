import type { Core } from "@strapi/strapi";

/**
 * Registers lifecycle hooks on `admin::api-token` that maintain the forensic
 * audit table `plugin::strapi-mcp.token-audit`.
 *
 * Called from `bootstrap.ts` — must NOT run in `register` because content-types
 * (including ours) are not yet loaded there.
 *
 * Three hooks:
 *
 *   afterCreate  — insert a token-audit row capturing who created the token
 *                  (best-effort via `strapi.requestContext`).
 *
 *   beforeDelete — block deletion unless the caller is the original creator
 *                  OR a super-admin. Throws so the admin controller returns
 *                  an error to the UI / API.
 *
 *   afterDelete  — stamp the existing audit row with deleter info + timestamp.
 *                  The row is NOT removed (we want the forensic trail to
 *                  survive deletion).
 *
 * The hook never throws on its own bookkeeping failures (audit writes use
 * `.catch(swallow)`). It only throws to enforce the delete-permission rule.
 */

const TOKEN_AUDIT_UID = "plugin::strapi-mcp.token-audit" as any;
const API_TOKEN_UID = "admin::api-token" as any;
const SUPER_ADMIN_CODE = "strapi-super-admin";

function currentAdminUser(strapi: Core.Strapi): any | null {
  try {
    const ctx = (strapi as any).requestContext?.get?.();
    return ctx?.state?.user ?? null;
  } catch {
    return null;
  }
}

function isSuperAdmin(user: any): boolean {
  if (!user) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((r: any) => r?.code === SUPER_ADMIN_CODE);
}

async function resolveTokenIdsFromWhere(strapi: Core.Strapi, where: any): Promise<number[]> {
  if (!where || typeof where !== "object") return [];
  if (typeof where.id === "number") return [where.id];
  if (typeof where.id === "string") {
    const n = Number(where.id);
    return Number.isFinite(n) ? [n] : [];
  }
  // Bulk or filter query — resolve to concrete ids.
  try {
    const rows = await strapi.db.query(API_TOKEN_UID).findMany({
      where,
      select: ["id"],
    });
    return rows.map((r: any) => r.id).filter((id: any) => typeof id === "number");
  } catch (err) {
    strapi.log.warn(
      `[strapi-mcp audit] resolveTokenIdsFromWhere falló: ${String(err)}. ` +
        `beforeDelete no podrá verificar permisos sobre estos tokens.`
    );
    return [];
  }
}

export function registerTokenAuditHooks(strapi: Core.Strapi): void {
  (strapi.db.lifecycles as any).subscribe({
    models: [API_TOKEN_UID],

    async afterCreate(event: any) {
      const token = event?.result;
      if (!token?.id) return;

      const user = currentAdminUser(strapi);
      const creatorId = user?.id ?? null;
      const creatorEmail = user?.email ?? null;

      try {
        await strapi.db.query(TOKEN_AUDIT_UID).create({
          data: {
            token_id: token.id,
            token_name: token.name ?? "(unnamed)",
            token_type: token.type ?? "unknown",
            creator_id: creatorId,
            creator_email: creatorEmail,
            created_at_real: new Date(),
            is_legacy: false,
          },
        });
        strapi.log.info(
          `[strapi-mcp audit] token created: id=${token.id} name="${token.name}" ` +
            `creator=${creatorEmail ?? "(no-request-context)"}`
        );
      } catch (err) {
        // Don't break token creation — audit failures are non-fatal.
        strapi.log.error(`[strapi-mcp audit] afterCreate insert falló: ${String(err)}`);
      }
    },

    async beforeDelete(event: any) {
      const where = event?.params?.where;
      const ids = await resolveTokenIdsFromWhere(strapi, where);

      if (ids.length === 0) {
        // Nothing concrete to check — let it proceed. Strapi will handle
        // not-found semantics. The afterDelete hook won't have anything to
        // update either.
        return;
      }

      const user = currentAdminUser(strapi);
      const callerId = user?.id ?? null;
      const callerEmail = user?.email ?? null;
      const superAdmin = isSuperAdmin(user);

      for (const tokenId of ids) {
        // Look up creator from audit row. Missing row = treat as legacy
        // (no known creator) → requires super-admin.
        let auditRow: any = null;
        try {
          auditRow = await strapi.db.query(TOKEN_AUDIT_UID).findOne({
            where: { token_id: tokenId },
          });
        } catch (err) {
          strapi.log.warn(
            `[strapi-mcp audit] beforeDelete: no pude leer token-audit para token_id=${tokenId}: ${String(err)}`
          );
        }

        const creatorId = auditRow?.creator_id ?? null;
        const isCreator = callerId !== null && callerId === creatorId;

        if (!isCreator && !superAdmin) {
          const reason = creatorId
            ? `solo el creador (admin user id=${creatorId}) o un super-admin puede eliminar este token`
            : `este token no tiene creador registrado (legacy o creado fuera de contexto); solo un super-admin puede eliminarlo`;
          const err = new Error(
            `[strapi-mcp audit] Delete bloqueado: token_id=${tokenId} — ${reason}. ` +
              `Caller: ${callerEmail ?? "(unknown)"}, super-admin=${superAdmin}.`
          ) as any;
          err.status = 403;
          err.statusCode = 403;
          err.expose = true;
          err.name = "ForbiddenError";
          err.details = {
            reason: "MCP_AUDIT_DELETE_FORBIDDEN",
            token_id: tokenId,
            creator_id: creatorId,
            caller_id: callerId,
          };
          throw err;
        }
      }
    },

    async afterDelete(event: any) {
      const result = event?.result;
      const deleted: any[] = Array.isArray(result) ? result : result ? [result] : [];

      const user = currentAdminUser(strapi);
      const deleterId = user?.id ?? null;
      const deleterEmail = user?.email ?? null;
      const now = new Date();

      for (const tok of deleted) {
        if (!tok?.id) continue;
        try {
          await strapi.db.query(TOKEN_AUDIT_UID).updateMany({
            where: { token_id: tok.id },
            data: {
              deleter_id: deleterId,
              deleter_email: deleterEmail,
              deleted_at: now,
            },
          });
        } catch (err) {
          strapi.log.error(
            `[strapi-mcp audit] afterDelete update falló para token_id=${tok.id}: ${String(err)}`
          );
        }
      }
    },
  });

  strapi.log.info(
    `[strapi-mcp audit] lifecycle hooks registrados sobre ${API_TOKEN_UID} ` +
      `(create / delete con verificación de permisos)`
  );
}
