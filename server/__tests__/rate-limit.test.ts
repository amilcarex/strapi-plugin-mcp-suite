import { test, describe, beforeEach } from "node:test";
import * as assert from "node:assert/strict";

import { checkRateLimit } from "../middlewares/rate-limit";

describe("rate-limit: per-token check (Capa 1)", () => {
  beforeEach(() => {
    process.env.MCP_RATE_LIMIT_PER_MIN = "5";
    process.env.MCP_RATE_LIMIT_WINDOW_MS = "60000";
  });

  test("dentro del límite, allowed=true y remaining decrece", () => {
    const key = "token:test-key-1-" + Date.now();
    const r1 = checkRateLimit(key);
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 4);

    const r2 = checkRateLimit(key);
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 3);
  });

  test("al exceder el límite, allowed=false con retryAfterSec > 0", () => {
    const key = "token:test-key-2-" + Date.now();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key);
    }
    const r = checkRateLimit(key);
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
    assert.ok(r.retryAfterSec >= 1);
  });

  test("limit refleja la env var por default", () => {
    process.env.MCP_RATE_LIMIT_PER_MIN = "100";
    const key = "token:test-key-3-" + Date.now();
    const r = checkRateLimit(key);
    assert.equal(r.limit, 100);
    assert.equal(r.remaining, 99);
  });

  test("keys distintos no interfieren entre sí", () => {
    const keyA = "token:test-key-a-" + Date.now();
    const keyB = "token:test-key-b-" + Date.now();

    for (let i = 0; i < 5; i++) checkRateLimit(keyA);
    const rA = checkRateLimit(keyA);
    assert.equal(rA.allowed, false);

    const rB = checkRateLimit(keyB);
    assert.equal(rB.allowed, true);
    assert.equal(rB.remaining, 4);
  });

  test("env var inválida cae a default 60", () => {
    process.env.MCP_RATE_LIMIT_PER_MIN = "not-a-number";
    const key = "token:test-key-defaults-" + Date.now();
    const r = checkRateLimit(key);
    assert.equal(r.limit, 60);
  });

  test("env var negativa cae a default 60", () => {
    process.env.MCP_RATE_LIMIT_PER_MIN = "-10";
    const key = "token:test-key-neg-" + Date.now();
    const r = checkRateLimit(key);
    assert.equal(r.limit, 60);
  });
});

describe("rate-limit: customLimit override (per-user, per-IP)", () => {
  test("checkRateLimit acepta customLimit explícito", () => {
    const key = "owner:42-" + Date.now();
    const r = checkRateLimit(key, 10);
    assert.equal(r.limit, 10);
    assert.equal(r.remaining, 9);
  });

  test("customLimit más restrictivo dispara antes", () => {
    const key = "ip:127.0.0.1-" + Date.now();
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3);
    const r = checkRateLimit(key, 3);
    assert.equal(r.allowed, false);
  });

  test("distintos prefixes (token/owner/ip) son keys independientes aunque la suffix sea igual", () => {
    const suffix = "shared-suffix-" + Date.now();
    // Per-token y per-owner deben mantener contadores separados
    checkRateLimit(`token:${suffix}`, 5);
    checkRateLimit(`owner:${suffix}`, 5);
    // Cada uno solo cuenta su propia request
    const tokenCheck = checkRateLimit(`token:${suffix}`, 5);
    assert.equal(tokenCheck.remaining, 3); // 5 - 2 = 3
    const ownerCheck = checkRateLimit(`owner:${suffix}`, 5);
    assert.equal(ownerCheck.remaining, 3);
  });
});
