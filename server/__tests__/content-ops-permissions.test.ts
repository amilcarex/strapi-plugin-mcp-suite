import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { assertCanMutate } from "../services/tools/content-ops";
import { resolveCustomWritePolicy } from "../services/feature-flags";

function strapiWithCustomPerms(perms: any[] | null, writePolicy?: "strict" | "endpoint"): any {
  return {
    log: { warn: () => undefined },
    plugin: (name: string) =>
      name === "strapi-mcp-suite"
        ? { config: (k: string) => (k === "customTokenWrite" ? writePolicy : undefined) }
        : null,
    service: (uid: string) => {
      if (uid !== "admin::api-token") return null;
      return {
        getById: async () => (perms === null ? null : { permissions: perms }),
      };
    },
  };
}

const UID = "api::article.article";

describe("content-ops: assertCanMutate (punto 4)", () => {
  test("full-access → permite cualquier mutación", async () => {
    const auth = { credentials: { type: "full-access" } };
    await assert.doesNotReject(() => assertCanMutate({}, auth, UID, "create"));
    await assert.doesNotReject(() => assertCanMutate({}, auth, UID, "delete"));
  });

  test("read-only → BLOQUEA toda mutación", async () => {
    const auth = { credentials: { type: "read-only" } };
    await assert.rejects(() => assertCanMutate({}, auth, UID, "create"), /read-only/);
    await assert.rejects(() => assertCanMutate({}, auth, UID, "update"), /read-only/);
    await assert.rejects(() => assertCanMutate({}, auth, UID, "delete"), /read-only/);
    await assert.rejects(() => assertCanMutate({}, auth, UID, "publish"), /read-only/);
  });

  test("sin token → BLOQUEA (fail-closed)", async () => {
    await assert.rejects(() => assertCanMutate({}, {}, UID, "create"), /no se pudo determinar|bloqueada/i);
    await assert.rejects(() => assertCanMutate({}, undefined, UID, "create"), /bloqueada/i);
  });

  test("tipo desconocido → BLOQUEA (fail-closed)", async () => {
    const auth = { credentials: { type: "weird-type" } };
    await assert.rejects(() => assertCanMutate({}, auth, UID, "create"), /desconocido/);
  });

  test("custom con el permiso correspondiente → permite", async () => {
    const auth = { credentials: { type: "custom", id: 9 } };
    const strapi = strapiWithCustomPerms([`${UID}.create`, `${UID}.find`]);
    await assert.doesNotReject(() => assertCanMutate(strapi, auth, UID, "create"));
  });

  test("custom SIN el permiso → BLOQUEA", async () => {
    const auth = { credentials: { type: "custom", id: 9 } };
    const strapi = strapiWithCustomPerms([`${UID}.find`, `${UID}.findOne`]);
    await assert.rejects(() => assertCanMutate(strapi, auth, UID, "delete"), /no tiene permiso/);
  });

  test("custom: publish/discard aceptan el permiso update como equivalente de escritura", async () => {
    const auth = { credentials: { type: "custom", id: 9 } };
    const strapi = strapiWithCustomPerms([`${UID}.update`]);
    await assert.doesNotReject(() => assertCanMutate(strapi, auth, UID, "publish"));
    await assert.doesNotReject(() => assertCanMutate(strapi, auth, UID, "discard"));
  });

  test("custom con permisos irresolubles → permite con warning (no regresa; read-only sigue blindado)", async () => {
    const auth = { credentials: { type: "custom", id: 9 } };
    const strapi = strapiWithCustomPerms(null); // getById devuelve null
    await assert.doesNotReject(() => assertCanMutate(strapi, auth, UID, "create"));
  });
});

/* ─── 0.7.1: política customTokenWrite ─────────────────────────────────────── */

describe("feature-flags: resolveCustomWritePolicy", () => {
  function makeStrapi(cfg: unknown): any {
    return {
      plugin: (name: string) =>
        name === "strapi-mcp-suite"
          ? { config: (k: string) => (k === "customTokenWrite" ? cfg : undefined) }
          : null,
      config: { get: () => undefined },
    };
  }

  test("sin config → default 'strict'", () => {
    delete process.env.MCP_CUSTOM_TOKEN_WRITE;
    assert.equal(resolveCustomWritePolicy(makeStrapi(undefined)), "strict");
  });

  test("config 'endpoint' se respeta; valor inválido cae a 'strict'", () => {
    delete process.env.MCP_CUSTOM_TOKEN_WRITE;
    assert.equal(resolveCustomWritePolicy(makeStrapi("endpoint")), "endpoint");
    assert.equal(resolveCustomWritePolicy(makeStrapi("garbage")), "strict");
  });

  test("env MCP_CUSTOM_TOKEN_WRITE override gana sobre config", () => {
    process.env.MCP_CUSTOM_TOKEN_WRITE = "endpoint";
    try {
      assert.equal(resolveCustomWritePolicy(makeStrapi("strict")), "endpoint");
    } finally {
      delete process.env.MCP_CUSTOM_TOKEN_WRITE;
    }
  });
});

describe("content-ops: assertCanMutate con customTokenWrite='endpoint' (0.7.1)", () => {
  test("custom SIN el permiso puntual → PERMITE bajo 'endpoint' (escalable)", async () => {
    delete process.env.MCP_CUSTOM_TOKEN_WRITE;
    const auth = { credentials: { type: "custom", id: 9 } };
    // token sin ningún permiso de CRUD sobre el CT (foto vieja), policy endpoint
    const strapi = strapiWithCustomPerms([`${UID}.find`], "endpoint");
    await assert.doesNotReject(() => assertCanMutate(strapi, auth, UID, "create"));
    await assert.doesNotReject(() => assertCanMutate(strapi, auth, UID, "delete"));
  });

  test("read-only sigue BLOQUEADO aunque la policy sea 'endpoint'", async () => {
    const auth = { credentials: { type: "read-only" } };
    const strapi = strapiWithCustomPerms([], "endpoint");
    await assert.rejects(() => assertCanMutate(strapi, auth, UID, "create"), /read-only/);
  });

  test("'strict' (default) mantiene el chequeo per-permiso", async () => {
    delete process.env.MCP_CUSTOM_TOKEN_WRITE;
    const auth = { credentials: { type: "custom", id: 9 } };
    const strapi = strapiWithCustomPerms([`${UID}.find`], "strict");
    await assert.rejects(() => assertCanMutate(strapi, auth, UID, "create"), /no tiene permiso/);
  });
});
