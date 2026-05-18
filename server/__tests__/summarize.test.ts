import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { summarizeResult } from "../services/audit/summarize";

describe("summarizeResult — null and undefined", () => {
  test("returns null for null", () => {
    assert.equal(summarizeResult("any", null), null);
  });

  test("returns null for undefined", () => {
    assert.equal(summarizeResult("any", undefined), null);
  });

  test("returns null for primitives", () => {
    assert.equal(summarizeResult("any", "hello"), null);
    assert.equal(summarizeResult("any", 42), null);
    assert.equal(summarizeResult("any", true), null);
  });
});

describe("summarizeResult — arrays", () => {
  test("array returns count + tool", () => {
    const out = summarizeResult("list_x", [1, 2, 3, 4]);
    assert.deepEqual(out, { count: 4, tool: "list_x" });
  });

  test("empty array still returns count", () => {
    const out = summarizeResult("list_x", []);
    assert.deepEqual(out, { count: 0, tool: "list_x" });
  });
});

describe("summarizeResult — entry-shaped results", () => {
  test("create_entry: extracts documentId", () => {
    const out = summarizeResult("create_entry", {
      documentId: "doc_abc123",
      title: "Hello",
      content: "lots of text...",
    });
    assert.deepEqual(out, { documentId: "doc_abc123", tool: "create_entry" });
  });

  test("update_entry: extracts documentId and id", () => {
    const out = summarizeResult("update_entry", {
      id: 5,
      documentId: "doc_xyz",
      title: "Updated",
    });
    assert.deepEqual(out, { documentId: "doc_xyz", id: 5, tool: "update_entry" });
  });

  test("find_entries with data array: extracts count", () => {
    const out = summarizeResult("find_entries", {
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    assert.deepEqual(out, { count: 3, tool: "find_entries" });
  });

  test("find_entries with meta.pagination.total", () => {
    const out = summarizeResult("find_entries", {
      data: [{ id: 1 }],
      meta: { pagination: { total: 150, page: 1, pageSize: 25 } },
    });
    // meta.pagination.total preferred only if no data array? — actual code prefers
    // .data first; verify behavior.
    assert.equal((out as any).count, 1);
    assert.equal((out as any).tool, "find_entries");
  });

  test("count field on the result is preferred", () => {
    const out = summarizeResult("list_x", { count: 42, items: [1, 2] });
    assert.equal((out as any).count, 42);
  });
});

describe("summarizeResult — uid and op fields", () => {
  test("extracts uid", () => {
    const out = summarizeResult("get_schema", { uid: "api::page.page" });
    assert.deepEqual(out, { uid: "api::page.page", tool: "get_schema" });
  });

  test("extracts op", () => {
    const out = summarizeResult("publish_entry", {
      documentId: "x",
      op: "published",
    });
    assert.deepEqual(out, { documentId: "x", op: "published", tool: "publish_entry" });
  });

  test("extracts error string", () => {
    const out = summarizeResult("create_entry", { error: "VALIDATION_FAILED" });
    assert.deepEqual(out, { error: "VALIDATION_FAILED", tool: "create_entry" });
  });
});

describe("summarizeResult — nothing useful", () => {
  test("object without any known field returns null (no summary worth keeping)", () => {
    const out = summarizeResult("any", { random: "field", deep: { stuff: 1 } });
    assert.equal(out, null);
  });

  test("object with only the tool tag has no signal", () => {
    // Internally if nothing matched, the tool-only summary should be dropped.
    const out = summarizeResult("any", { irrelevant: true });
    assert.equal(out, null);
  });
});
