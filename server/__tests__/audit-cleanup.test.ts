import { test, describe, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import { runCleanup } from "../services/audit/cleanup";
import { buildAuditMockStrapi } from "./_audit-helpers";

const OP_LOG = "plugin::strapi-mcp-suite.op-log";

const ENV_KEYS = [
  "MCP_AUDIT_RETENTION_DAYS",
  "MCP_AUDIT_MAX_ROWS",
  "MCP_AUDIT_CLEANUP_INTERVAL_HOURS",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

describe("runCleanup — AGE pass", () => {
  test("deletes rows older than retention window in batches", async () => {
    process.env.MCP_AUDIT_RETENTION_DAYS = "30";
    process.env.MCP_AUDIT_MAX_ROWS = "0"; // disable CAP pass

    let oldRowsLeft = 2500; // simulate 2500 rows older than cutoff
    const { strapi, dbCalls } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          findMany: (q: any) => {
            if (q.where?.ts?.$lt) {
              const take = Math.min(q.limit ?? 1000, oldRowsLeft);
              return Array.from({ length: take }, (_, i) => ({ id: i + 1 }));
            }
            return [];
          },
          deleteMany: (q: any) => {
            const n = Array.isArray(q.where.id.$in) ? q.where.id.$in.length : 0;
            oldRowsLeft -= n;
            return { count: n };
          },
          count: () => 0,
        },
      },
    });

    const result = await runCleanup(strapi);
    assert.equal(result.removedByAge, 2500);
    assert.equal(result.removedByCap, 0);

    // Should have run 3 batches of 1000, 1000, 500.
    const deletes = dbCalls.filter((c) => c.uid === OP_LOG && c.op === "deleteMany");
    assert.equal(deletes.length, 3);
  });

  test("MCP_AUDIT_RETENTION_DAYS=0 disables AGE pass", async () => {
    process.env.MCP_AUDIT_RETENTION_DAYS = "0";
    process.env.MCP_AUDIT_MAX_ROWS = "0";

    const { strapi, dbCalls } = buildAuditMockStrapi();
    const result = await runCleanup(strapi);
    assert.equal(result.removedByAge, 0);
    const findManyWithAge = dbCalls.filter(
      (c) => c.uid === OP_LOG && c.op === "findMany" && (c as any).query.where?.ts?.$lt
    );
    assert.equal(findManyWithAge.length, 0);
  });
});

describe("runCleanup — CAP pass", () => {
  test("trims to maxRows when count exceeds cap", async () => {
    process.env.MCP_AUDIT_RETENTION_DAYS = "0"; // skip AGE
    process.env.MCP_AUDIT_MAX_ROWS = "100";

    let currentCount = 250; // 150 over the cap
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          count: () => currentCount,
          findMany: (q: any) => {
            const take = Math.min(q.limit ?? 1000, Math.max(0, currentCount - 100));
            return Array.from({ length: take }, (_, i) => ({ id: i + 1 }));
          },
          deleteMany: (q: any) => {
            const n = Array.isArray(q.where.id.$in) ? q.where.id.$in.length : 0;
            currentCount -= n;
            return { count: n };
          },
        },
      },
    });

    const result = await runCleanup(strapi);
    assert.equal(result.removedByAge, 0);
    assert.equal(result.removedByCap, 150);
  });

  test("no-op when count is at or below cap", async () => {
    process.env.MCP_AUDIT_RETENTION_DAYS = "0";
    process.env.MCP_AUDIT_MAX_ROWS = "100";

    const { strapi, dbCalls } = buildAuditMockStrapi({
      dbHandlers: { [OP_LOG]: { count: () => 100 } },
    });

    const result = await runCleanup(strapi);
    assert.equal(result.removedByCap, 0);
    const deletes = dbCalls.filter((c) => c.uid === OP_LOG && c.op === "deleteMany");
    assert.equal(deletes.length, 0);
  });

  test("MCP_AUDIT_MAX_ROWS=0 disables CAP pass", async () => {
    process.env.MCP_AUDIT_RETENTION_DAYS = "0";
    process.env.MCP_AUDIT_MAX_ROWS = "0";

    const { strapi, dbCalls } = buildAuditMockStrapi({
      dbHandlers: { [OP_LOG]: { count: () => 999999 } },
    });

    const result = await runCleanup(strapi);
    assert.equal(result.removedByCap, 0);
    const deletes = dbCalls.filter((c) => c.uid === OP_LOG && c.op === "deleteMany");
    assert.equal(deletes.length, 0);
  });
});
