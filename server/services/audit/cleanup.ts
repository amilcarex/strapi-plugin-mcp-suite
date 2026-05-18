import type { Core } from "@strapi/strapi";

/**
 * Bounded retention for `plugin::strapi-mcp.op-log`.
 *
 * Two limits, evaluated in order on each tick:
 *   1. AGE — delete rows older than `MCP_AUDIT_RETENTION_DAYS` (default 90).
 *   2. CAP — if more than `MCP_AUDIT_MAX_ROWS` remain (default 100k),
 *      delete the oldest until the table is back under the cap.
 *
 * Both pass in BATCHES of 1000 to avoid long-running DB transactions on
 * SQLite / Postgres. The single tick runs all batches needed.
 *
 * `MCP_AUDIT_RETENTION_DAYS=0` disables the AGE pass (kept for tests).
 * `MCP_AUDIT_MAX_ROWS=0` disables the CAP pass.
 *
 * Job scheduling:
 *   - `startCleanupJob(strapi)` returns the `setInterval` handle.
 *   - `destroy.ts` clears it.
 *   - Interval is `MCP_AUDIT_CLEANUP_INTERVAL_HOURS * 3600 * 1000` ms.
 *   - First tick runs immediately via `setImmediate` so the operator gets
 *     early signal that the job is configured correctly.
 */

const OP_LOG_UID = "plugin::strapi-mcp.op-log" as any;
const BATCH_SIZE = 1000;

export interface CleanupOptions {
  retentionDays: number;
  maxRows: number;
}

export interface CleanupResult {
  removedByAge: number;
  removedByCap: number;
  remaining: number;
}

function readOptions(): CleanupOptions & { intervalHours: number } {
  const retentionDays = Math.max(0, parseInt(process.env.MCP_AUDIT_RETENTION_DAYS ?? "90", 10) || 0);
  const maxRows = Math.max(0, parseInt(process.env.MCP_AUDIT_MAX_ROWS ?? "100000", 10) || 0);
  const intervalHours = Math.max(1, parseInt(process.env.MCP_AUDIT_CLEANUP_INTERVAL_HOURS ?? "24", 10) || 24);
  return { retentionDays, maxRows, intervalHours };
}

async function deleteBatchOlderThan(strapi: Core.Strapi, cutoff: Date): Promise<number> {
  // Get a batch of IDs older than cutoff, then delete by id list.
  // We do it this way (instead of one big WHERE) so we can bound per-tx work.
  const rows = await strapi.db.query(OP_LOG_UID).findMany({
    where: { ts: { $lt: cutoff } },
    select: ["id"],
    orderBy: { ts: "asc" },
    limit: BATCH_SIZE,
  });
  if (rows.length === 0) return 0;
  const ids = rows.map((r: any) => r.id);
  await strapi.db.query(OP_LOG_UID).deleteMany({ where: { id: { $in: ids } } });
  return rows.length;
}

async function deleteOldestBatch(strapi: Core.Strapi): Promise<number> {
  const rows = await strapi.db.query(OP_LOG_UID).findMany({
    select: ["id"],
    orderBy: { ts: "asc" },
    limit: BATCH_SIZE,
  });
  if (rows.length === 0) return 0;
  const ids = rows.map((r: any) => r.id);
  await strapi.db.query(OP_LOG_UID).deleteMany({ where: { id: { $in: ids } } });
  return rows.length;
}

export async function runCleanup(
  strapi: Core.Strapi,
  opts: Partial<CleanupOptions> = {}
): Promise<CleanupResult> {
  const cfg = { ...readOptions(), ...opts };
  let removedByAge = 0;
  let removedByCap = 0;

  if (cfg.retentionDays > 0) {
    const cutoff = new Date(Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000);
    while (true) {
      try {
        const n = await deleteBatchOlderThan(strapi, cutoff);
        if (n === 0) break;
        removedByAge += n;
      } catch (err) {
        strapi.log.error(`[strapi-mcp audit] cleanup AGE batch falló: ${String(err)}`);
        break;
      }
    }
  }

  let remaining = 0;
  try {
    remaining = await strapi.db.query(OP_LOG_UID).count({});
  } catch (err) {
    strapi.log.warn(`[strapi-mcp audit] cleanup count falló: ${String(err)}`);
  }

  if (cfg.maxRows > 0 && remaining > cfg.maxRows) {
    const toRemove = remaining - cfg.maxRows;
    let removedSoFar = 0;
    while (removedSoFar < toRemove) {
      try {
        const n = await deleteOldestBatch(strapi);
        if (n === 0) break;
        removedByCap += n;
        removedSoFar += n;
      } catch (err) {
        strapi.log.error(`[strapi-mcp audit] cleanup CAP batch falló: ${String(err)}`);
        break;
      }
    }
    try {
      remaining = await strapi.db.query(OP_LOG_UID).count({});
    } catch {
      /* swallow */
    }
  }

  if (removedByAge > 0 || removedByCap > 0) {
    strapi.log.info(
      `[strapi-mcp audit] cleanup: removed ${removedByAge + removedByCap} rows ` +
        `(${removedByAge} older than ${cfg.retentionDays}d, ${removedByCap} over ${cfg.maxRows}-row cap). ` +
        `${remaining} rows remain.`
    );
  }

  return { removedByAge, removedByCap, remaining };
}

/**
 * Schedule periodic cleanup. Returns the interval handle so `destroy.ts` can
 * clear it on shutdown.
 */
export function startCleanupJob(strapi: Core.Strapi): NodeJS.Timeout {
  const { intervalHours, retentionDays, maxRows } = readOptions();
  const periodMs = intervalHours * 60 * 60 * 1000;

  strapi.log.info(
    `[strapi-mcp audit] cleanup job armed: every ${intervalHours}h, ` +
      `retention=${retentionDays}d, cap=${maxRows} rows`
  );

  // Kick off once on boot (after a short delay so DB is fully ready).
  setImmediate(() => {
    runCleanup(strapi).catch((err) => {
      strapi.log.error(`[strapi-mcp audit] initial cleanup falló: ${String(err)}`);
    });
  });

  return setInterval(() => {
    runCleanup(strapi).catch((err) => {
      strapi.log.error(`[strapi-mcp audit] cleanup tick falló: ${String(err)}`);
    });
  }, periodMs);
}
