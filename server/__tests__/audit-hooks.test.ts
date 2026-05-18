import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { registerTokenAuditHooks } from "../services/audit/hooks";
import {
  buildAuditMockStrapi,
  FAKE_SUPER_ADMIN,
  FAKE_REGULAR_USER,
  FAKE_CREATOR_USER,
} from "./_audit-helpers";

const TOKEN_AUDIT = "plugin::strapi-mcp.token-audit";
const API_TOKEN = "admin::api-token";

describe("registerTokenAuditHooks — afterCreate", () => {
  test("inserts a token-audit row with creator info from requestContext", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({
      currentUser: FAKE_SUPER_ADMIN,
    });
    registerTokenAuditHooks(strapi);
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].models, [API_TOKEN]);

    await captured[0].afterCreate!({
      result: { id: 42, name: "my-token", type: "full-access" },
    });

    const inserts = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "create");
    assert.equal(inserts.length, 1);
    const data = (inserts[0] as any).data;
    assert.equal(data.token_id, 42);
    assert.equal(data.token_name, "my-token");
    assert.equal(data.token_type, "full-access");
    assert.equal(data.creator_id, 1);
    assert.equal(data.creator_email, "boss@example.com");
    assert.equal(data.is_legacy, false);
    assert.ok(data.created_at_real instanceof Date);
  });

  test("inserts with null creator when no request context", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({ currentUser: null });
    registerTokenAuditHooks(strapi);

    await captured[0].afterCreate!({
      result: { id: 99, name: "system-seed", type: "read-only" },
    });

    const data = (dbCalls.find((c) => c.uid === TOKEN_AUDIT && c.op === "create") as any).data;
    assert.equal(data.creator_id, null);
    assert.equal(data.creator_email, null);
    assert.equal(data.is_legacy, false);
  });

  test("no-op when event.result lacks id", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({ currentUser: FAKE_SUPER_ADMIN });
    registerTokenAuditHooks(strapi);

    await captured[0].afterCreate!({ result: null });
    await captured[0].afterCreate!({ result: { name: "no-id" } });
    await captured[0].afterCreate!({});

    const inserts = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "create");
    assert.equal(inserts.length, 0);
  });

  test("swallows DB errors (does not throw, logs)", async () => {
    const { strapi, captured, logs } = buildAuditMockStrapi({
      currentUser: FAKE_SUPER_ADMIN,
      dbHandlers: {
        [TOKEN_AUDIT]: {
          create: () => {
            throw new Error("DB explosion");
          },
        },
      },
    });
    registerTokenAuditHooks(strapi);

    // Should NOT throw.
    await captured[0].afterCreate!({ result: { id: 1, name: "x", type: "custom" } });

    const errLogs = logs.filter((l) => l.level === "error" && /afterCreate/.test(String(l.args[0])));
    assert.ok(errLogs.length >= 1, "expected an error log");
  });
});

describe("registerTokenAuditHooks — beforeDelete (permission rule)", () => {
  test("allows delete when caller is the original creator", async () => {
    const { strapi, captured } = buildAuditMockStrapi({
      currentUser: FAKE_CREATOR_USER,
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findOne: () => ({ creator_id: 5, creator_email: "creator@example.com" }),
        },
      },
    });
    registerTokenAuditHooks(strapi);

    // Should NOT throw.
    await captured[0].beforeDelete!({ params: { where: { id: 10 } } });
  });

  test("allows delete when caller is super-admin (even if not creator)", async () => {
    const { strapi, captured } = buildAuditMockStrapi({
      currentUser: FAKE_SUPER_ADMIN,
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findOne: () => ({ creator_id: 99, creator_email: "someone-else@example.com" }),
        },
      },
    });
    registerTokenAuditHooks(strapi);

    await captured[0].beforeDelete!({ params: { where: { id: 10 } } });
  });

  test("blocks delete when caller is not creator and not super-admin", async () => {
    const { strapi, captured } = buildAuditMockStrapi({
      currentUser: FAKE_REGULAR_USER,
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findOne: () => ({ creator_id: 5, creator_email: "creator@example.com" }),
        },
      },
    });
    registerTokenAuditHooks(strapi);

    await assert.rejects(
      () => captured[0].beforeDelete!({ params: { where: { id: 10 } } }) as Promise<void>,
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.name, "ForbiddenError");
        assert.equal(err.details?.reason, "MCP_AUDIT_DELETE_FORBIDDEN");
        assert.equal(err.details?.token_id, 10);
        assert.equal(err.details?.creator_id, 5);
        assert.equal(err.details?.caller_id, 2);
        return true;
      }
    );
  });

  test("blocks delete on legacy token (no audit row) when caller not super-admin", async () => {
    const { strapi, captured } = buildAuditMockStrapi({
      currentUser: FAKE_REGULAR_USER,
      dbHandlers: {
        [TOKEN_AUDIT]: {
          findOne: () => null, // no audit row → legacy
        },
      },
    });
    registerTokenAuditHooks(strapi);

    await assert.rejects(
      () => captured[0].beforeDelete!({ params: { where: { id: 7 } } }) as Promise<void>,
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.details?.creator_id, null);
        return true;
      }
    );
  });

  test("allows super-admin to delete legacy tokens", async () => {
    const { strapi, captured } = buildAuditMockStrapi({
      currentUser: FAKE_SUPER_ADMIN,
      dbHandlers: { [TOKEN_AUDIT]: { findOne: () => null } },
    });
    registerTokenAuditHooks(strapi);

    await captured[0].beforeDelete!({ params: { where: { id: 7 } } });
  });

  test("resolves bulk delete via findMany on api-token", async () => {
    let findManyCalled = false;
    const { strapi, captured } = buildAuditMockStrapi({
      currentUser: FAKE_SUPER_ADMIN,
      dbHandlers: {
        [API_TOKEN]: {
          findMany: () => {
            findManyCalled = true;
            return [{ id: 10 }, { id: 11 }];
          },
        },
        [TOKEN_AUDIT]: { findOne: () => ({ creator_id: 99 }) },
      },
    });
    registerTokenAuditHooks(strapi);

    await captured[0].beforeDelete!({
      params: { where: { id: { $in: [10, 11] } } },
    });

    assert.equal(findManyCalled, true);
  });

  test("no-op when where resolves to empty id list", async () => {
    const { strapi, captured } = buildAuditMockStrapi({ currentUser: null });
    registerTokenAuditHooks(strapi);

    // No `id` field, no current user, findMany returns [] by default → no error.
    await captured[0].beforeDelete!({ params: { where: { name: "x" } } });
  });
});

describe("registerTokenAuditHooks — afterDelete", () => {
  test("stamps deleter info on the audit row", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({ currentUser: FAKE_SUPER_ADMIN });
    registerTokenAuditHooks(strapi);

    await captured[0].afterDelete!({ result: { id: 10 } });

    const updates = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "updateMany");
    assert.equal(updates.length, 1);
    const q = (updates[0] as any).query;
    assert.deepEqual(q.where, { token_id: 10 });
    assert.equal(q.data.deleter_id, 1);
    assert.equal(q.data.deleter_email, "boss@example.com");
    assert.ok(q.data.deleted_at instanceof Date);
  });

  test("handles bulk delete (array of results)", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({ currentUser: FAKE_SUPER_ADMIN });
    registerTokenAuditHooks(strapi);

    await captured[0].afterDelete!({ result: [{ id: 1 }, { id: 2 }, { id: 3 }] });

    const updates = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "updateMany");
    assert.equal(updates.length, 3);
    assert.deepEqual(
      updates.map((u: any) => u.query.where.token_id),
      [1, 2, 3]
    );
  });

  test("works with null deleter (no request context)", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({ currentUser: null });
    registerTokenAuditHooks(strapi);

    await captured[0].afterDelete!({ result: { id: 5 } });

    const updates = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "updateMany");
    assert.equal(updates.length, 1);
    assert.equal((updates[0] as any).query.data.deleter_id, null);
    assert.equal((updates[0] as any).query.data.deleter_email, null);
  });

  test("no-op when no result", async () => {
    const { strapi, dbCalls, captured } = buildAuditMockStrapi({ currentUser: FAKE_SUPER_ADMIN });
    registerTokenAuditHooks(strapi);

    await captured[0].afterDelete!({});
    await captured[0].afterDelete!({ result: null });

    const updates = dbCalls.filter((c) => c.uid === TOKEN_AUDIT && c.op === "updateMany");
    assert.equal(updates.length, 0);
  });
});
