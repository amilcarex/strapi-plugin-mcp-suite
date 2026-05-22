import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { runBackfill } from "../services/audit/backfill";
import { buildAuditMockStrapi } from "./_audit-helpers";

const TOKEN_AUDIT = "plugin::strapi-mcp-suite.token-audit";
const API_TOKEN = "admin::api-token";

describe("runBackfill", () => {
  test("inserts one audit row per pre-existing token with is_legacy=true", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi({
      dbHandlers: {
        [API_TOKEN]: {
          findMany: () => [
            { id: 1, name: "legacy-1", type: "full-access", createdAt: "2025-01-01T00:00:00Z" },
            { id: 2, name: "legacy-2", type: "read-only", createdAt: "2025-02-01T00:00:00Z" },
          ],
        },
        [TOKEN_AUDIT]: { findMany: () => [] },
      },
    });

    const result = await runBackfill(strapi);
    assert.equal(result.inserted, 2);
    assert.equal(result.total, 2);

    const inserts = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "create");
    assert.equal(inserts.length, 2);
    for (const ins of inserts) {
      const d = (ins as any).data;
      assert.equal(d.creator_id, null);
      assert.equal(d.creator_email, "unknown");
      assert.equal(d.is_legacy, true);
      assert.ok(d.created_at_real instanceof Date);
    }
  });

  test("skips tokens that already have audit rows (idempotent)", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi({
      dbHandlers: {
        [API_TOKEN]: {
          findMany: () => [
            { id: 1, name: "a", type: "full-access" },
            { id: 2, name: "b", type: "full-access" },
            { id: 3, name: "c", type: "full-access" },
          ],
        },
        [TOKEN_AUDIT]: {
          findMany: () => [{ token_id: 1 }, { token_id: 3 }],
        },
      },
    });

    const result = await runBackfill(strapi);
    assert.equal(result.inserted, 1); // only token id 2 is new
    assert.equal(result.total, 3);

    const inserts = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "create");
    assert.equal(inserts.length, 1);
    assert.equal((inserts[0] as any).data.token_id, 2);
  });

  test("no-op when no tokens exist", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi({
      dbHandlers: { [API_TOKEN]: { findMany: () => [] } },
    });

    const result = await runBackfill(strapi);
    assert.equal(result.inserted, 0);
    assert.equal(result.total, 0);
    assert.equal(dbCalls.filter((c) => c.op === "create").length, 0);
  });

  test("survives a per-token insert failure (logs, continues)", async () => {
    const { strapi, dbCalls, logs } = buildAuditMockStrapi({
      dbHandlers: {
        [API_TOKEN]: {
          findMany: () => [
            { id: 1, name: "a", type: "full-access" },
            { id: 2, name: "b", type: "full-access" },
          ],
        },
        [TOKEN_AUDIT]: {
          findMany: () => [],
          create: (q: any) => {
            if (q.data.token_id === 1) throw new Error("db fail");
            return { id: 99 };
          },
        },
      },
    });

    const result = await runBackfill(strapi);
    assert.equal(result.inserted, 1);
    assert.equal(result.total, 2);
    assert.ok(logs.some((l) => l.level === "warn" && /backfill: insert falló/.test(String(l.args[0]))));
    // The second token (id=2) still got inserted.
    const inserts = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "create");
    assert.equal(inserts.length, 2); // both attempted; one threw, second succeeded
  });
});
