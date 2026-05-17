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
const rate_limit_1 = require("../middlewares/rate-limit");
(0, node_test_1.describe)("rate-limit: per-token check (Capa 1)", () => {
    (0, node_test_1.beforeEach)(() => {
        process.env.MCP_RATE_LIMIT_PER_MIN = "5";
        process.env.MCP_RATE_LIMIT_WINDOW_MS = "60000";
    });
    (0, node_test_1.test)("dentro del límite, allowed=true y remaining decrece", () => {
        const key = "token:test-key-1-" + Date.now();
        const r1 = (0, rate_limit_1.checkRateLimit)(key);
        assert.equal(r1.allowed, true);
        assert.equal(r1.remaining, 4);
        const r2 = (0, rate_limit_1.checkRateLimit)(key);
        assert.equal(r2.allowed, true);
        assert.equal(r2.remaining, 3);
    });
    (0, node_test_1.test)("al exceder el límite, allowed=false con retryAfterSec > 0", () => {
        const key = "token:test-key-2-" + Date.now();
        for (let i = 0; i < 5; i++) {
            (0, rate_limit_1.checkRateLimit)(key);
        }
        const r = (0, rate_limit_1.checkRateLimit)(key);
        assert.equal(r.allowed, false);
        assert.equal(r.remaining, 0);
        assert.ok(r.retryAfterSec >= 1);
    });
    (0, node_test_1.test)("limit refleja la env var por default", () => {
        process.env.MCP_RATE_LIMIT_PER_MIN = "100";
        const key = "token:test-key-3-" + Date.now();
        const r = (0, rate_limit_1.checkRateLimit)(key);
        assert.equal(r.limit, 100);
        assert.equal(r.remaining, 99);
    });
    (0, node_test_1.test)("keys distintos no interfieren entre sí", () => {
        const keyA = "token:test-key-a-" + Date.now();
        const keyB = "token:test-key-b-" + Date.now();
        for (let i = 0; i < 5; i++)
            (0, rate_limit_1.checkRateLimit)(keyA);
        const rA = (0, rate_limit_1.checkRateLimit)(keyA);
        assert.equal(rA.allowed, false);
        const rB = (0, rate_limit_1.checkRateLimit)(keyB);
        assert.equal(rB.allowed, true);
        assert.equal(rB.remaining, 4);
    });
    (0, node_test_1.test)("env var inválida cae a default 60", () => {
        process.env.MCP_RATE_LIMIT_PER_MIN = "not-a-number";
        const key = "token:test-key-defaults-" + Date.now();
        const r = (0, rate_limit_1.checkRateLimit)(key);
        assert.equal(r.limit, 60);
    });
    (0, node_test_1.test)("env var negativa cae a default 60", () => {
        process.env.MCP_RATE_LIMIT_PER_MIN = "-10";
        const key = "token:test-key-neg-" + Date.now();
        const r = (0, rate_limit_1.checkRateLimit)(key);
        assert.equal(r.limit, 60);
    });
});
(0, node_test_1.describe)("rate-limit: customLimit override (per-user, per-IP)", () => {
    (0, node_test_1.test)("checkRateLimit acepta customLimit explícito", () => {
        const key = "owner:42-" + Date.now();
        const r = (0, rate_limit_1.checkRateLimit)(key, 10);
        assert.equal(r.limit, 10);
        assert.equal(r.remaining, 9);
    });
    (0, node_test_1.test)("customLimit más restrictivo dispara antes", () => {
        const key = "ip:127.0.0.1-" + Date.now();
        for (let i = 0; i < 3; i++)
            (0, rate_limit_1.checkRateLimit)(key, 3);
        const r = (0, rate_limit_1.checkRateLimit)(key, 3);
        assert.equal(r.allowed, false);
    });
    (0, node_test_1.test)("distintos prefixes (token/owner/ip) son keys independientes aunque la suffix sea igual", () => {
        const suffix = "shared-suffix-" + Date.now();
        // Per-token y per-owner deben mantener contadores separados
        (0, rate_limit_1.checkRateLimit)(`token:${suffix}`, 5);
        (0, rate_limit_1.checkRateLimit)(`owner:${suffix}`, 5);
        // Cada uno solo cuenta su propia request
        const tokenCheck = (0, rate_limit_1.checkRateLimit)(`token:${suffix}`, 5);
        assert.equal(tokenCheck.remaining, 3); // 5 - 2 = 3
        const ownerCheck = (0, rate_limit_1.checkRateLimit)(`owner:${suffix}`, 5);
        assert.equal(ownerCheck.remaining, 3);
    });
});
