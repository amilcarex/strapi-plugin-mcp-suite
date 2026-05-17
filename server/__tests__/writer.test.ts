import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "path";

import {
  safeSegment,
  assertWithinAllowedRoot,
  pathsForComponent,
  pathsForContentType,
  backupPathFor,
  isProduction,
  COMPONENTS_ROOT,
  API_ROOT,
} from "../services/schema-authoring/writer";

describe("safeSegment", () => {
  test("acepta kebab-case válido", () => {
    assert.equal(safeSegment("article", "test"), "article");
    assert.equal(safeSegment("blog-post", "test"), "blog-post");
    assert.equal(safeSegment("a", "test"), "a");
    assert.equal(safeSegment("a1b2", "test"), "a1b2");
  });

  test("rechaza path traversal con ../", () => {
    assert.throws(() => safeSegment("../etc", "category"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment("..", "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment("../..", "name"), /INVALID_PATH_SEGMENT/);
  });

  test("rechaza separadores de path", () => {
    assert.throws(() => safeSegment("foo/bar", "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment("foo\\bar", "name"), /INVALID_PATH_SEGMENT/);
  });

  test("rechaza null bytes y caracteres de control", () => {
    assert.throws(() => safeSegment("foo\0null", "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment("foo\nbar", "name"), /INVALID_PATH_SEGMENT/);
  });

  test("rechaza nombres que empiezan con número o mayúscula", () => {
    assert.throws(() => safeSegment("1foo", "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment("Foo", "name"), /INVALID_PATH_SEGMENT/);
  });

  test("rechaza string vacío, undefined, null, números", () => {
    assert.throws(() => safeSegment("", "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment(undefined as any, "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment(null as any, "name"), /INVALID_PATH_SEGMENT/);
    assert.throws(() => safeSegment(123 as any, "name"), /INVALID_PATH_SEGMENT/);
  });
});

describe("assertWithinAllowedRoot", () => {
  test("acepta path dentro del root", () => {
    const root = "/project/src/api";
    const file = "/project/src/api/article/schema.json";
    assert.doesNotThrow(() => assertWithinAllowedRoot(file, root));
  });

  test("rechaza path que escapa con ../", () => {
    const root = "/project/src/api";
    const file = "/project/src/api/../../../etc/passwd";
    assert.throws(() => assertWithinAllowedRoot(file, root), /PATH_ESCAPE_DETECTED/);
  });

  test("rechaza path en directorio hermano", () => {
    const root = "/project/src/api";
    const file = "/project/src/components/sneaky.json";
    assert.throws(() => assertWithinAllowedRoot(file, root), /PATH_ESCAPE_DETECTED/);
  });

  test("acepta el root mismo (caso edge)", () => {
    const root = "/project/src/api";
    assert.doesNotThrow(() => assertWithinAllowedRoot(root, root));
  });
});

describe("pathsForComponent", () => {
  test("genera path correcto con segments válidos", () => {
    const result = pathsForComponent("shared", "seo");
    assert.equal(result.length, 1);
    assert.ok(result[0].path.endsWith(path.join("src", "components", "shared", "seo.json")));
  });

  test("rechaza category traversal", () => {
    assert.throws(() => pathsForComponent("../etc", "evil"), /INVALID_PATH_SEGMENT/);
  });

  test("rechaza name traversal", () => {
    assert.throws(() => pathsForComponent("shared", "../../etc/passwd"), /INVALID_PATH_SEGMENT/);
  });
});

describe("pathsForContentType", () => {
  test("genera los 4 paths (schema + controller + router + service)", () => {
    const paths = pathsForContentType("article");
    assert.ok(paths.schema.includes(path.join("api", "article", "content-types", "article", "schema.json")));
    assert.ok(paths.controller.includes(path.join("api", "article", "controllers", "article.ts")));
    assert.ok(paths.router.includes(path.join("api", "article", "routes", "article.ts")));
    assert.ok(paths.service.includes(path.join("api", "article", "services", "article.ts")));
  });

  test("rechaza singular name traversal", () => {
    assert.throws(() => pathsForContentType("../../etc"), /INVALID_PATH_SEGMENT/);
  });
});

describe("backupPathFor", () => {
  test("preserva jerarquía relativa bajo .strapi-mcp-backups/", () => {
    const original = path.join(process.cwd(), "src", "components", "shared", "seo.json");
    const backup = backupPathFor(original, "2026-01-01");
    assert.ok(backup !== null);
    assert.ok(backup!.includes(".strapi-mcp-backups"));
    assert.ok(backup!.includes("seo.json.bak.2026-01-01"));
    // Y mantiene src/components/shared/ adentro
    assert.ok(backup!.includes(path.join("src", "components", "shared")));
  });

  test("retorna null si el path está FUERA del project root", () => {
    const outside = "/tmp/foreign.json";
    const backup = backupPathFor(outside, "2026-01-01");
    assert.equal(backup, null);
  });
});

describe("isProduction (fail-closed M4)", () => {
  const original = process.env.NODE_ENV;

  test("development → false", () => {
    process.env.NODE_ENV = "development";
    assert.equal(isProduction(), false);
  });

  test("dev → false", () => {
    process.env.NODE_ENV = "dev";
    assert.equal(isProduction(), false);
  });

  test("test → false", () => {
    process.env.NODE_ENV = "test";
    assert.equal(isProduction(), false);
  });

  test("production → true", () => {
    process.env.NODE_ENV = "production";
    assert.equal(isProduction(), true);
  });

  test("staging → true (fail-closed)", () => {
    process.env.NODE_ENV = "staging";
    assert.equal(isProduction(), true);
  });

  test("undefined → true (fail-closed)", () => {
    delete process.env.NODE_ENV;
    assert.equal(isProduction(), true);
  });

  test("empty string → true (fail-closed)", () => {
    process.env.NODE_ENV = "";
    assert.equal(isProduction(), true);
  });

  test("unknown value → true (fail-closed)", () => {
    process.env.NODE_ENV = "qa";
    assert.equal(isProduction(), true);
  });

  // restore
  test.after?.(() => {
    if (original !== undefined) process.env.NODE_ENV = original;
    else delete process.env.NODE_ENV;
  });
});

describe("COMPONENTS_ROOT / API_ROOT (sanity)", () => {
  test("ambos devuelven paths absolutos bajo cwd", () => {
    assert.ok(path.isAbsolute(COMPONENTS_ROOT()));
    assert.ok(path.isAbsolute(API_ROOT()));
    assert.ok(COMPONENTS_ROOT().includes("components"));
    assert.ok(API_ROOT().includes("api"));
  });
});
