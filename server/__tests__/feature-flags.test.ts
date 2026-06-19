import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import {
  FEATURE_DEFAULTS,
  parseBoolEnv,
  applyEnvOverrides,
  resolveFeatureFlags,
  versionGte,
  isNativeMcpActive,
  resolveCoexistence,
  applyCoexistence,
  DEFAULT_COEXISTENCE,
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

/* ─── Punto 2: coexistencia con el MCP nativo ──────────────────────────────── */

describe("feature-flags: versionGte", () => {
  test("compara semver correctamente", () => {
    assert.equal(versionGte("5.47.0", "5.47.0"), true);
    assert.equal(versionGte("5.48.1", "5.47.0"), true);
    assert.equal(versionGte("5.46.0", "5.47.0"), false);
    assert.equal(versionGte("6.0.0", "5.47.0"), true);
    assert.equal(versionGte("5.47.0-beta.1", "5.47.0"), true); // matchea 5.47.0
  });

  test("input inválido → false (fail-safe)", () => {
    assert.equal(versionGte(undefined, "5.47.0"), false);
    assert.equal(versionGte("unknown", "5.47.0"), false);
    assert.equal(versionGte(547, "5.47.0"), false);
  });
});

describe("feature-flags: isNativeMcpActive", () => {
  function makeStrapi(version: string | undefined, mcpEnabled: unknown): any {
    return {
      config: {
        info: { strapi: version },
        get(path: string) {
          if (path === "server.mcp.enabled") return mcpEnabled;
          return undefined;
        },
      },
    };
  }

  test("5.48 + server.mcp.enabled=true → activo", () => {
    assert.equal(isNativeMcpActive(makeStrapi("5.48.1", true)), true);
  });

  test("5.47 pero enabled!=true → inactivo", () => {
    assert.equal(isNativeMcpActive(makeStrapi("5.47.0", false)), false);
    assert.equal(isNativeMcpActive(makeStrapi("5.47.0", undefined)), false);
  });

  test("<5.47 aunque enabled=true → inactivo (no existe el nativo)", () => {
    assert.equal(isNativeMcpActive(makeStrapi("5.46.0", true)), false);
  });
});

describe("feature-flags: resolveCoexistence", () => {
  function makeStrapi(cfg: unknown): any {
    return {
      plugin(name: string) {
        if (name !== "strapi-mcp-suite") return null;
        return { config: (k: string) => (k === "coexistence" ? cfg : undefined) };
      },
      config: { get: () => undefined },
    };
  }

  test("sin config → default 'auto'", () => {
    delete process.env.MCP_COEXISTENCE;
    assert.equal(resolveCoexistence(makeStrapi(undefined)), DEFAULT_COEXISTENCE);
    assert.equal(resolveCoexistence(makeStrapi(undefined)), "auto");
  });

  test("config válida se respeta", () => {
    delete process.env.MCP_COEXISTENCE;
    assert.equal(resolveCoexistence(makeStrapi("standalone")), "standalone");
  });

  test("valor inválido cae al default", () => {
    delete process.env.MCP_COEXISTENCE;
    assert.equal(resolveCoexistence(makeStrapi("garbage")), "auto");
  });

  test("env MCP_COEXISTENCE override gana sobre config", () => {
    process.env.MCP_COEXISTENCE = "standalone";
    try {
      assert.equal(resolveCoexistence(makeStrapi("auto")), "standalone");
    } finally {
      delete process.env.MCP_COEXISTENCE;
    }
  });
});

describe("feature-flags: applyCoexistence (auto-supresión de contentOps)", () => {
  const base: FeatureFlags = {
    contentOps: true,
    schemaAuthoring: true,
    upload: false,
    graphql: false,
  };

  test("auto + nativo activo → suprime contentOps", () => {
    const { flags, contentOpsSuppressed } = applyCoexistence(base, {
      coexistence: "auto",
      nativeActive: true,
      envContentOps: undefined,
    });
    assert.equal(flags.contentOps, false);
    assert.equal(contentOpsSuppressed, true);
    // no toca los demás flags
    assert.equal(flags.schemaAuthoring, true);
  });

  test("auto + nativo INACTIVO → no suprime", () => {
    const { flags, contentOpsSuppressed } = applyCoexistence(base, {
      coexistence: "auto",
      nativeActive: false,
      envContentOps: undefined,
    });
    assert.equal(flags.contentOps, true);
    assert.equal(contentOpsSuppressed, false);
  });

  test("standalone + nativo activo → NO suprime (escape hatch)", () => {
    const { flags, contentOpsSuppressed } = applyCoexistence(base, {
      coexistence: "standalone",
      nativeActive: true,
      envContentOps: undefined,
    });
    assert.equal(flags.contentOps, true);
    assert.equal(contentOpsSuppressed, false);
  });

  test("env CONTENT_OPS_ENABLED=true fuerza contentOps aunque el nativo esté activo", () => {
    const { flags, contentOpsSuppressed } = applyCoexistence(base, {
      coexistence: "auto",
      nativeActive: true,
      envContentOps: true,
    });
    assert.equal(flags.contentOps, true);
    assert.equal(contentOpsSuppressed, false);
  });

  test("extend-native se comporta como auto (suprime)", () => {
    const { contentOpsSuppressed } = applyCoexistence(base, {
      coexistence: "extend-native",
      nativeActive: true,
      envContentOps: undefined,
    });
    assert.equal(contentOpsSuppressed, true);
  });

  test("si contentOps ya estaba off, no marca supresión", () => {
    const { contentOpsSuppressed } = applyCoexistence(
      { ...base, contentOps: false },
      { coexistence: "auto", nativeActive: true, envContentOps: undefined }
    );
    assert.equal(contentOpsSuppressed, false);
  });
});
