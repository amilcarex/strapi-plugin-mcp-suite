import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { auditTools } from "../services/tools/audit-tools";
import { buildAuditMockStrapi, FAKE_SUPER_ADMIN, FAKE_REGULAR_USER } from "./_audit-helpers";

const TOKEN_AUDIT = "plugin::strapi-mcp.token-audit";
const OP_LOG = "plugin::strapi-mcp.op-log";

const tokenCreators = auditTools.find((t) => t.name === "__audit_token_creators")!;
const logQuery = auditTools.find((t) => t.name === "__audit_log_query")!;

describe("audit tools — super-admin gating", () => {
  test("__audit_token_creators denies non-super-admin caller", async () => {
    const { strapi } = buildAuditMockStrapi();
    const result: any = await tokenCreators.handler(
      { strapi, user: FAKE_REGULAR_USER } as any,
      {}
    );
    assert.equal(result.error, "AUDIT_REQUIRES_SUPER_ADMIN");
    assert.equal(result.details.caller_id, 2);
  });

  test("__audit_token_creators denies when no user resolved", async () => {
    const { strapi } = buildAuditMockStrapi();
    const result: any = await tokenCreators.handler(
      { strapi, user: null } as any,
      {}
    );
    assert.equal(result.error, "AUDIT_REQUIRES_SUPER_ADMIN");
    assert.equal(result.details.caller_id, null);
  });

  test("__audit_log_query denies non-super-admin", async () => {
    const { strapi } = buildAuditMockStrapi();
    const result: any = await logQuery.handler(
      { strapi, user: FAKE_REGULAR_USER } as any,
      {}
    );
    assert.equal(result.error, "AUDIT_REQUIRES_SUPER_ADMIN");
  });
});

describe("__audit_token_creators — super-admin happy path", () => {
  test("returns rows shaped for the LLM", async () => {
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findMany: () => [
            {
              token_id: 1,
              token_name: "amilcar - claude code",
              token_type: "full-access",
              creator_id: 5,
              creator_email: "amilcar@example.com",
              created_at_real: new Date("2026-05-10"),
              deleter_id: null,
              deleter_email: null,
              deleted_at: null,
              is_legacy: false,
            },
            {
              token_id: 2,
              token_name: "legacy",
              token_type: "read-only",
              creator_id: null,
              creator_email: "unknown",
              created_at_real: new Date("2025-01-01"),
              is_legacy: true,
            },
          ],
        },
      },
    });

    const result: any = await tokenCreators.handler(
      { strapi, user: FAKE_SUPER_ADMIN } as any,
      {}
    );
    assert.equal(result.count, 2);
    assert.equal(result.tokens[0].token_id, 1);
    assert.equal(result.tokens[0].creator_email, "amilcar@example.com");
    assert.equal(result.tokens[1].is_legacy, true);
    assert.equal(result.tokens[1].creator_email, "unknown");
  });

  test("respects include_deleted=false filter", async () => {
    let capturedWhere: any = null;
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findMany: (q: any) => {
            capturedWhere = q.where;
            return [];
          },
        },
      },
    });

    await tokenCreators.handler(
      { strapi, user: FAKE_SUPER_ADMIN } as any,
      { include_deleted: false }
    );
    assert.deepEqual(capturedWhere, { deleted_at: { $null: true } });
  });

  test("limit is capped to 500", async () => {
    let capturedLimit: number | undefined;
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findMany: (q: any) => {
            capturedLimit = q.limit;
            return [];
          },
        },
      },
    });
    await tokenCreators.handler({ strapi, user: FAKE_SUPER_ADMIN } as any, { limit: 9999 });
    assert.equal(capturedLimit, 500);
  });
});

describe("__audit_log_query — super-admin happy path", () => {
  test("default: payloads omitted from rows", async () => {
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          findMany: () => [
            {
              id: 1,
              ts: new Date(),
              token_id: 5,
              admin_user_id: 3,
              admin_email: "u@example.com",
              tool_name: "find_entries",
              status: "ok",
              duration_ms: 42,
              ip: "127.0.0.1",
              user_agent: "curl",
              args_redacted: { uid: "api::page.page" },
              result_summary: { count: 10, tool: "find_entries" },
              error_message: null,
            },
          ],
        },
      },
    });
    const result: any = await logQuery.handler({ strapi, user: FAKE_SUPER_ADMIN } as any, {});
    assert.equal(result.count, 1);
    assert.equal(result.include_payloads, false);
    assert.equal(result.rows[0].tool_name, "find_entries");
    assert.equal(result.rows[0].args_redacted, undefined);
    assert.equal(result.rows[0].result_summary, undefined);
  });

  test("include_payloads=true returns args_redacted + result_summary", async () => {
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          findMany: () => [
            {
              id: 1,
              tool_name: "x",
              status: "ok",
              args_redacted: { token: "[REDACTED]" },
              result_summary: { documentId: "d", tool: "x" },
            },
          ],
        },
      },
    });
    const result: any = await logQuery.handler(
      { strapi, user: FAKE_SUPER_ADMIN } as any,
      { include_payloads: true }
    );
    assert.deepEqual(result.rows[0].args_redacted, { token: "[REDACTED]" });
    assert.deepEqual(result.rows[0].result_summary, { documentId: "d", tool: "x" });
  });

  test("error rows include error_message even without payloads", async () => {
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          findMany: () => [
            { id: 1, status: "error", tool_name: "x", error_message: "BOOM" },
          ],
        },
      },
    });
    const result: any = await logQuery.handler({ strapi, user: FAKE_SUPER_ADMIN } as any, {});
    assert.equal(result.rows[0].error_message, "BOOM");
  });

  test("filters: builds correct where clause", async () => {
    let capturedWhere: any = null;
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          findMany: (q: any) => {
            capturedWhere = q.where;
            return [];
          },
        },
      },
    });
    await logQuery.handler({ strapi, user: FAKE_SUPER_ADMIN } as any, {
      token_id: 5,
      admin_user_id: 2,
      tool_name: "create_entry",
      status: "error",
      since: "2026-01-01T00:00:00Z",
      until: "2026-12-31T00:00:00Z",
    });
    assert.equal(capturedWhere.token_id, 5);
    assert.equal(capturedWhere.admin_user_id, 2);
    assert.equal(capturedWhere.tool_name, "create_entry");
    assert.equal(capturedWhere.status, "error");
    assert.ok(capturedWhere.ts.$gte instanceof Date);
    assert.ok(capturedWhere.ts.$lte instanceof Date);
  });

  test("invalid status enum is ignored (no where.status)", async () => {
    let capturedWhere: any = null;
    const { strapi } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          findMany: (q: any) => {
            capturedWhere = q.where;
            return [];
          },
        },
      },
    });
    await logQuery.handler({ strapi, user: FAKE_SUPER_ADMIN } as any, { status: "BOGUS" });
    assert.equal(capturedWhere.status, undefined);
  });
});
