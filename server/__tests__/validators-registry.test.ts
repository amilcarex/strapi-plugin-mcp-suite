import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { validateToolDefinition } from "../services/registry/validators";

const BUILTIN_NAMES = new Set(["create_entry", "find_entries", "__health"]);

function validTool(overrides: any = {}): any {
  return {
    name: "my_custom_tool",
    description: "Hace X cuando el usuario pide Y, con suficiente detalle para que el LLM decida.",
    inputSchema: {
      type: "object",
      properties: { foo: { type: "string" } },
      required: ["foo"],
      additionalProperties: false,
    },
    handler: async () => ({}),
    ...overrides,
  };
}

describe("validateToolDefinition — happy path", () => {
  test("tool válida pasa", () => {
    const r = validateToolDefinition(validTool(), BUILTIN_NAMES);
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });
});

describe("validateToolDefinition — name validation", () => {
  test("rechaza name vacío", () => {
    const r = validateToolDefinition(validTool({ name: "" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.field === "name"));
  });

  test("rechaza name con mayúscula", () => {
    const r = validateToolDefinition(validTool({ name: "MyTool" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.field === "name" && /snake_case/.test(e.message)));
  });

  test("rechaza name con guiones (kebab)", () => {
    const r = validateToolDefinition(validTool({ name: "my-tool" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
  });

  test("rechaza name muy corto", () => {
    const r = validateToolDefinition(validTool({ name: "ab" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /Mínimo/.test(e.message)));
  });

  test("rechaza name que colisiona con built-in", () => {
    const r = validateToolDefinition(validTool({ name: "create_entry" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /built-in/.test(e.message)));
  });

  test("acepta name snake_case válido con números", () => {
    const r = validateToolDefinition(validTool({ name: "my_tool_v2" }), BUILTIN_NAMES);
    assert.equal(r.valid, true);
  });
});

describe("validateToolDefinition — description", () => {
  test("rechaza description vacía", () => {
    const r = validateToolDefinition(validTool({ description: "" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
  });

  test("rechaza description muy corta", () => {
    const r = validateToolDefinition(validTool({ description: "corta" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => e.field === "description"));
  });
});

describe("validateToolDefinition — inputSchema", () => {
  test("rechaza inputSchema sin type", () => {
    const r = validateToolDefinition(
      validTool({ inputSchema: { properties: {}, additionalProperties: false } }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
  });

  test("rechaza inputSchema sin additionalProperties:false", () => {
    const r = validateToolDefinition(
      validTool({ inputSchema: { type: "object", properties: {} } }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /additionalProperties/.test(e.field)));
  });

  test("rechaza required con campo no presente en properties", () => {
    const r = validateToolDefinition(
      validTool({
        inputSchema: {
          type: "object",
          properties: { foo: { type: "string" } },
          required: ["bar"], // bar no está en properties
          additionalProperties: false,
        },
      }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /required/.test(e.field)));
  });

  test("rechaza JSON Schema con type inválido (ajv compile)", () => {
    const r = validateToolDefinition(
      validTool({
        inputSchema: {
          type: "object",
          properties: { foo: { type: "not-a-valid-type" } },
          additionalProperties: false,
        },
      }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
  });
});

describe("validateToolDefinition — handler", () => {
  test("rechaza handler que no es function", () => {
    const r = validateToolDefinition(validTool({ handler: "not a function" }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
  });

  test("rechaza handler undefined", () => {
    const r = validateToolDefinition(validTool({ handler: undefined }), BUILTIN_NAMES);
    assert.equal(r.valid, false);
  });
});

describe("validateToolDefinition — testCases opcionales", () => {
  test("acepta testCases bien formados", () => {
    const r = validateToolDefinition(
      validTool({
        testCases: [
          { name: "ok", args: { foo: "x" }, expect: { ok: true } },
        ],
      }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, true);
  });

  test("rechaza testCase sin name", () => {
    const r = validateToolDefinition(
      validTool({
        testCases: [{ args: { foo: "x" }, expect: { ok: true } }],
      }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
  });

  test("rechaza testCase con expect vacío", () => {
    const r = validateToolDefinition(
      validTool({
        testCases: [{ name: "x", args: {}, expect: {} }],
      }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
  });
});

describe("validateToolDefinition — tags", () => {
  test("acepta tags válidos", () => {
    const r = validateToolDefinition(
      validTool({ tags: ["read", "destructive"] }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, true);
  });

  test("rechaza tags que no son array", () => {
    const r = validateToolDefinition(
      validTool({ tags: "not-an-array" }),
      BUILTIN_NAMES
    );
    assert.equal(r.valid, false);
  });
});
