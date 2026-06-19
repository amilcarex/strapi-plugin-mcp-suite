import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import {
  FEATURE_DEFAULTS,
  parseBoolEnv,
  applyEnvOverrides,
  resolveFeatureFlags,
  type FeatureFlags,
} from "../services/feature-flags";

describe("feature-flags: parseBoolEnv", () => {
  test("'true' / '1' → true", () => {
    assert.equal(parseBoolEnv("true"), true);
    assert.equal(parseBoolEnv("1"), true);
    assert.equal(parseBoolEnv("  TRUE  "), true);
  });

  test("'false' / '0' → false", () => {
    assert.equal(parseBoolEnv("false"), false);
    assert.equal(parseBoolEnv("0"), false);
    assert.equal(parseBoolEnv("False"), false);
  });

  test("undefined / vacío / basura → undefined (sin override)", () => {
    assert.equal(parseBoolEnv(undefined), undefined);
    assert.equal(parseBoolEnv(""), undefined);
    assert.equal(parseBoolEnv("   "), undefined);
    assert.equal(parseBoolEnv("yes"), undefined);
  });
});

describe("feature-flags: applyEnvOverrides (precedencia env > config)", () => {
  const base: FeatureFlags = {
    contentOps: true,
    schemaAuthoring: false,
    upload: false,
    graphql: false,
  };

  test("sin env vars, devuelve los flags de config tal cual", () => {
    const out = applyEnvOverrides(base, {});
    assert.deepEqual(out, base);
  });

  test("env override gana sobre config (apagar contentOps)", () => {
    const out = applyEnvOverrides(base, { CONTENT_OPS_ENABLED: "false" });
    assert.equal(out.contentOps, false);
    // el resto intacto
    assert.equal(out.schemaAuthoring, false);
  });

  test("env override gana sobre config (prender schemaAuthoring/upload/graphql)", () => {
    const out = applyEnvOverrides(base, {
      SCHEMA_AUTHORING_ENABLED: "true",
      UPLOAD_ENABLED: "1",
      GRAPHQL_ENABLED: "true",
    });
    assert.equal(out.schemaAuthoring, true);
    assert.equal(out.upload, true);
    assert.equal(out.graphql, true);
    assert.equal(out.contentOps, true);
  });

  test("env var con valor inválido NO hace override (cae a config)", () => {
    const out = applyEnvOverrides(base, { CONTENT_OPS_ENABLED: "maybe" });
    assert.equal(out.contentOps, true);
  });

  test("no muta el objeto de entrada", () => {
    const input = { ...base };
    applyEnvOverrides(input, { CONTENT_OPS_ENABLED: "false" });
    assert.equal(input.contentOps, true);
  });
});

describe("feature-flags: resolveFeatureFlags (default → config → env)", () => {
  /** Mock mínimo de Strapi con config de plugin inyectable. */
  function makeStrapi(pluginConfig: Partial<FeatureFlags>): any {
    return {
      plugin(name: string) {
        if (name !== "strapi-mcp-suite") return null;
        return {
          config(key: string) {
            return (pluginConfig as any)[key];
          },
        };
      },
      config: {
        get(path: string) {
          const key = path.replace("plugin::strapi-mcp-suite.", "");
          return (pluginConfig as any)[key];
        },
      },
    };
  }

  test("sin config ni env, devuelve los defaults", () => {
    const strapi = makeStrapi({});
    // limpiar overrides que pudieran venir del entorno de test
    for (const v of [
      "CONTENT_OPS_ENABLED",
      "SCHEMA_AUTHORING_ENABLED",
      "UPLOAD_ENABLED",
      "GRAPHQL_ENABLED",
    ]) {
      delete process.env[v];
    }
    const out = resolveFeatureFlags(strapi);
    assert.deepEqual(out, FEATURE_DEFAULTS);
  });

  test("config del plugin sobrescribe el default", () => {
    const strapi = makeStrapi({ contentOps: false, schemaAuthoring: true });
    delete process.env.CONTENT_OPS_ENABLED;
    delete process.env.SCHEMA_AUTHORING_ENABLED;
    const out = resolveFeatureFlags(strapi);
    assert.equal(out.contentOps, false);
    assert.equal(out.schemaAuthoring, true);
    assert.equal(out.upload, false);
  });

  test("env override gana sobre la config del plugin", () => {
    const strapi = makeStrapi({ contentOps: false });
    process.env.CONTENT_OPS_ENABLED = "true";
    try {
      const out = resolveFeatureFlags(strapi);
      assert.equal(out.contentOps, true);
    } finally {
      delete process.env.CONTENT_OPS_ENABLED;
    }
  });
});
