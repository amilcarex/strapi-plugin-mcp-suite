import * as fs from "fs/promises";
import * as path from "path";
import type { Core } from "@strapi/strapi";

import { registerTokenAuditHooks } from "./services/audit/hooks";
import { runBackfill } from "./services/audit/backfill";
import { startCleanupJob } from "./services/audit/cleanup";

/**
 * Handle on the periodic op-log cleanup job. Set in bootstrap, cleared in
 * destroy. Module-scope so destroy.ts can import it via a getter.
 */
let auditCleanupHandle: NodeJS.Timeout | null = null;
export function getAuditCleanupHandle(): NodeJS.Timeout | null {
  return auditCleanupHandle;
}
export function clearAuditCleanupHandle(): void {
  if (auditCleanupHandle) {
    clearInterval(auditCleanupHandle);
    auditCleanupHandle = null;
  }
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const authoring = process.env.SCHEMA_AUTHORING_ENABLED === "true";
  const upload = process.env.UPLOAD_ENABLED === "true";
  const graphql = process.env.GRAPHQL_ENABLED === "true";
  const env = process.env.NODE_ENV ?? "development";

  const flagStatus = (label: string, on: boolean) =>
    `${label}=${on ? "ENABLED" : "disabled"}`;

  // Detección de versión Strapi para warnings de compatibilidad.
  const strapiVersion: string = (strapi as any).config?.info?.strapi ?? "unknown";

  strapi.log.info(
    `[strapi-mcp] plugin loaded — endpoint /api/strapi-mcp-suite/stream | strapi=${strapiVersion} | env=${env} | ${flagStatus("schema_authoring", authoring)} | ${flagStatus("upload", upload)} | ${flagStatus("graphql", graphql)}`
  );

  // Warning para versiones <5.45: el campo `adminUserOwner` en api-tokens no
  // existe, por lo que el plugin no puede aplicar anti-impersonation y degrada
  // a "no atribuir createdBy/updatedBy". Auth sigue funcionando pero los
  // entries creados via MCP quedan sin owner. Recomendar upgrade.
  const versionParts = strapiVersion.split(".").map((n) => parseInt(n, 10));
  const isOldVersion =
    versionParts.length >= 2 &&
    !isNaN(versionParts[0]) &&
    !isNaN(versionParts[1]) &&
    (versionParts[0] < 5 || (versionParts[0] === 5 && versionParts[1] < 45));
  if (isOldVersion) {
    strapi.log.warn(
      `[strapi-mcp] Strapi ${strapiVersion} es anterior a 5.45.0. Soporte limitado pero funcional.\n` +
      `  Para atribución completa (createdBy/updatedBy autopoblado en entries creados via MCP),\n` +
      `  recomendamos upgrade a >=5.45.0 + activar 'features.future.adminTokens: true' en config/admin.ts.`
    );
  }

  // Si schema-authoring está habilitado, chequear que .strapi-mcp-backups/
  // esté en el .gitignore para evitar que se committeen accidentalmente.
  if (authoring) {
    const gitignorePath = path.join(process.cwd(), ".gitignore");
    fs.readFile(gitignorePath, "utf8")
      .then((content) => {
        if (!/\.strapi-mcp-backups\/?/.test(content)) {
          strapi.log.warn(
            `[strapi-mcp] schema_authoring=ENABLED pero ".strapi-mcp-backups/" no está en .gitignore. Los backups de schemas modificados pueden terminar committeados. Agregá la línea: .strapi-mcp-backups/`
          );
        }
      })
      .catch(() => {
        // .gitignore no existe — proyecto no usa git, no warneamos
      });
  }

  // ── Audit trail (v0.4.0) ────────────────────────────────────────────────────
  //
  // 1. Register lifecycle hooks on admin::api-token so any future create/delete
  //    is captured and the delete-permission rule is enforced.
  // 2. Backfill audit rows for tokens that pre-date the install — without these
  //    rows the beforeDelete hook treats them as unattributed legacy tokens,
  //    which is the intended behavior but we want them in the audit table so
  //    super-admins can see them via the __audit_token_creators tool.
  // 3. Start the periodic op-log retention job (age + row cap).
  //
  // Hook registration is synchronous. Backfill + cleanup-tick are scheduled via
  // setImmediate so they run after the project bootstrap completes (avoids
  // racing with seed data loaders).
  try {
    registerTokenAuditHooks(strapi);
  } catch (err) {
    strapi.log.error(`[strapi-mcp audit] no pude registrar lifecycle hooks: ${String(err)}`);
  }

  setImmediate(() => {
    runBackfill(strapi).catch((err) => {
      strapi.log.error(`[strapi-mcp audit] backfill falló: ${String(err)}`);
    });
  });

  try {
    auditCleanupHandle = startCleanupJob(strapi);
  } catch (err) {
    strapi.log.error(`[strapi-mcp audit] no pude arrancar cleanup job: ${String(err)}`);
  }

  // Self-tests del registry de tools custom.
  //
  // Timing: el bootstrap del plugin corre ANTES del bootstrap del proyecto
  // consumidor (src/index.ts), donde el dev típicamente llama a registerTool.
  // Por eso schedulamos los self-tests via setImmediate — al momento de fire,
  // el event loop ya procesó el bootstrap del proyecto y las tools custom
  // están registradas.
  //
  // En producción, runSelfTests es no-op (skip silencioso). Cero overhead.
  setImmediate(async () => {
    try {
      const registry = strapi.plugin("strapi-mcp-suite").service("registry") as any;
      if (registry?.runSelfTests) {
        const summary = await registry.runSelfTests();
        if (summary.tested > 0) {
          strapi.log.info(
            `[strapi-mcp registry] Self-tests: ${summary.tested}/${summary.total} tool(s) con testCases — ${summary.failures} con fallas`
          );
        }
      }
    } catch (err) {
      strapi.log.error(`[strapi-mcp registry] runSelfTests falló: ${String(err)}`);
    }
  });
};
