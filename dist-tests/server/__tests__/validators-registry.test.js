"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const validators_1 = require("../services/registry/validators");
const BUILTIN_NAMES = new Set(["create_entry", "find_entries", "__health"]);
function validTool(overrides = {}) {
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
(0, node_test_1.describe)("validateToolDefinition — happy path", () => {
    (0, node_test_1.test)("tool válida pasa", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool(), BUILTIN_NAMES);
        assert.equal(r.valid, true);
        assert.equal(r.errors.length, 0);
    });
});
(0, node_test_1.describe)("validateToolDefinition — name validation", () => {
    (0, node_test_1.test)("rechaza name vacío", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ name: "" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => e.field === "name"));
    });
    (0, node_test_1.test)("rechaza name con mayúscula", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ name: "MyTool" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => e.field === "name" && /snake_case/.test(e.message)));
    });
    (0, node_test_1.test)("rechaza name con guiones (kebab)", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ name: "my-tool" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("rechaza name muy corto", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ name: "ab" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => /Mínimo/.test(e.message)));
    });
    (0, node_test_1.test)("rechaza name que colisiona con built-in", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ name: "create_entry" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => /built-in/.test(e.message)));
    });
    (0, node_test_1.test)("acepta name snake_case válido con números", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ name: "my_tool_v2" }), BUILTIN_NAMES);
        assert.equal(r.valid, true);
    });
});
(0, node_test_1.describe)("validateToolDefinition — description", () => {
    (0, node_test_1.test)("rechaza description vacía", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ description: "" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("rechaza description muy corta", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ description: "corta" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => e.field === "description"));
    });
});
(0, node_test_1.describe)("validateToolDefinition — inputSchema", () => {
    (0, node_test_1.test)("rechaza inputSchema sin type", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ inputSchema: { properties: {}, additionalProperties: false } }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("rechaza inputSchema sin additionalProperties:false", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ inputSchema: { type: "object", properties: {} } }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => /additionalProperties/.test(e.field)));
    });
    (0, node_test_1.test)("rechaza required con campo no presente en properties", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({
            inputSchema: {
                type: "object",
                properties: { foo: { type: "string" } },
                required: ["bar"], // bar no está en properties
                additionalProperties: false,
            },
        }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some((e) => /required/.test(e.field)));
    });
    (0, node_test_1.test)("rechaza JSON Schema con type inválido (ajv compile)", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({
            inputSchema: {
                type: "object",
                properties: { foo: { type: "not-a-valid-type" } },
                additionalProperties: false,
            },
        }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
});
(0, node_test_1.describe)("validateToolDefinition — handler", () => {
    (0, node_test_1.test)("rechaza handler que no es function", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ handler: "not a function" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("rechaza handler undefined", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ handler: undefined }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
});
(0, node_test_1.describe)("validateToolDefinition — testCases opcionales", () => {
    (0, node_test_1.test)("acepta testCases bien formados", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({
            testCases: [
                { name: "ok", args: { foo: "x" }, expect: { ok: true } },
            ],
        }), BUILTIN_NAMES);
        assert.equal(r.valid, true);
    });
    (0, node_test_1.test)("rechaza testCase sin name", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({
            testCases: [{ args: { foo: "x" }, expect: { ok: true } }],
        }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("rechaza testCase con expect vacío", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({
            testCases: [{ name: "x", args: {}, expect: {} }],
        }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
});
(0, node_test_1.describe)("validateToolDefinition — tags", () => {
    (0, node_test_1.test)("acepta tags válidos", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ tags: ["read", "destructive"] }), BUILTIN_NAMES);
        assert.equal(r.valid, true);
    });
    (0, node_test_1.test)("rechaza tags que no son array", () => {
        const r = (0, validators_1.validateToolDefinition)(validTool({ tags: "not-an-array" }), BUILTIN_NAMES);
        assert.equal(r.valid, false);
    });
});
