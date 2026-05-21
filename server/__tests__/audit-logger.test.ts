import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { logOperation } from "../services/audit/logger";
import { buildAuditMockStrapi } from "./_audit-helpers";

const OP_LOG = "plugin::strapi-mcp.op-log";

describe("logOperation — happy path", () => {
  test("ok status: persists tool name, redacted args, result summary, duration, user, request", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi();

    await logOperation(strapi, {
      toolName: "create_entry",
      args: { uid: "api::page.page", token: "secret-abc", data: { title: "Hi" } },
      result: { documentId: "doc_xyz" },
      status: "ok",
      durationMs: 42.7,
      apiToken: { id: 11 },
      user: { id: 3, email: "u@example.com" },
      request: { ip: "1.2.3.4", userAgent: "curl/8" },
    });

    const inserts = dbCalls.filter((c) => c.uid === OP_LOG && c.op === "create");
    assert.equal(inserts.length, 1);
    const data = (inserts[0] as any).data;
    assert.equal(data.tool_name, "create_entry");
    assert.equal(data.status, "ok");
    assert.equal(data.token_id, 11);
    assert.equal(data.admin_user_id, 3);
    assert.equal(data.admin_email, "u@example.com");
    assert.equal(data.ip, "1.2.3.4");
    assert.equal(data.user_agent, "curl/8");
    assert.equal(data.duration_ms, 43); // rounded
    assert.equal(data.error_message, null);
    // Args redacted.
    assert.equal(data.args_redacted.token, "[REDACTED]");
    assert.equal(data.args_redacted.uid, "api::page.page");
    assert.equal(data.args_redacted.data.title, "Hi");
    // Result summarized.
    assert.equal(data.result_summary.documentId, "doc_xyz");
    assert.equal(data.result_summary.tool, "create_entry");
  });

  test("error status: persists error message, no result_summary", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi();

    await logOperation(strapi, {
      toolName: "delete_entry",
      args: { uid: "api::x", documentId: "d1" },
      error: new Error("VALIDATION_FAILED"),
      status: "error",
      durationMs: 5,
      apiToken: { id: 1 },
      user: null,
      request: null,
    });

    const data = (dbCalls.find((c) => c.uid === OP_LOG && c.op === "create") as any).data;
    assert.equal(data.status, "error");
    assert.equal(data.error_message, "VALIDATION_FAILED");
    assert.equal(data.result_summary, null);
    assert.equal(data.admin_user_id, null);
    assert.equal(data.ip, null);
    assert.equal(data.user_agent, null);
  });

  test("error from non-Error: still serializes to string", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi();
    await logOperation(strapi, {
      toolName: "x",
      args: {},
      error: "raw string error",
      status: "error",
      durationMs: 0,
    });
    const data = (dbCalls.find((c) => c.uid === OP_LOG && c.op === "create") as any).data;
    assert.equal(data.error_message, "raw string error");
  });
});

describe("logOperation — failure isolation", () => {
  test("swallows DB insert failures (does not throw)", async () => {
    const { strapi, logs } = buildAuditMockStrapi({
      dbHandlers: {
        [OP_LOG]: {
          create: () => {
            throw new Error("disk full");
          },
        },
      },
    });

    // Should NOT throw.
    await logOperation(strapi, {
      toolName: "x",
      args: {},
      status: "ok",
      durationMs: 1,
    });

    assert.ok(logs.some((l) => l.level === "warn" && /logOperation falló/.test(String(l.args[0]))));
  });
});

describe("logOperation — duration clamp", () => {
  test("negative durations clamped to 0", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi();
    await logOperation(strapi, {
      toolName: "x",
      args: {},
      status: "ok",
      durationMs: -5,
    });
    const data = (dbCalls.find((c) => c.uid === OP_LOG && c.op === "create") as any).data;
    assert.equal(data.duration_ms, 0);
  });
});

describe("logOperation — destructive flag (v0.6.0)", () => {
  const destructiveOk = ["delete_entry", "delete_field_from_schema", "delete_media"];
  for (const tool of destructiveOk) {
    test(`${tool} → destructive=true`, async () => {
      const { strapi, dbCalls } = buildAuditMockStrapi();
      await logOperation(strapi, { toolName: tool, args: {}, status: "ok", durationMs: 1 });
      const data = (dbCalls.find((c) => c.uid === OP_LOG && c.op === "create") as any).data;
      assert.equal(data.destructive, true);
    });
  }

  test("tool no destructiva → destructive=false", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi();
    await logOperation(strapi, { toolName: "find_entries", args: {}, status: "ok", durationMs: 1 });
    const data = (dbCalls.find((c) => c.uid === OP_LOG && c.op === "create") as any).data;
    assert.equal(data.destructive, false);
  });

  test("modify_schema NO se marca destructive (puede borrar campos pero requiere remove[] explícito)", async () => {
    const { strapi, dbCalls } = buildAuditMockStrapi();
    await logOperation(strapi, { toolName: "modify_schema", args: {}, status: "ok", durationMs: 1 });
    const data = (dbCalls.find((c) => c.uid === OP_LOG && c.op === "create") as any).data;
    assert.equal(data.destructive, false);
  });
});
