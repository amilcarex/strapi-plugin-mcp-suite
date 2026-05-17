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
const path = __importStar(require("path"));
const writer_1 = require("../services/schema-authoring/writer");
(0, node_test_1.describe)("safeSegment", () => {
    (0, node_test_1.test)("acepta kebab-case válido", () => {
        assert.equal((0, writer_1.safeSegment)("article", "test"), "article");
        assert.equal((0, writer_1.safeSegment)("blog-post", "test"), "blog-post");
        assert.equal((0, writer_1.safeSegment)("a", "test"), "a");
        assert.equal((0, writer_1.safeSegment)("a1b2", "test"), "a1b2");
    });
    (0, node_test_1.test)("rechaza path traversal con ../", () => {
        assert.throws(() => (0, writer_1.safeSegment)("../etc", "category"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)("..", "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)("../..", "name"), /INVALID_PATH_SEGMENT/);
    });
    (0, node_test_1.test)("rechaza separadores de path", () => {
        assert.throws(() => (0, writer_1.safeSegment)("foo/bar", "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)("foo\\bar", "name"), /INVALID_PATH_SEGMENT/);
    });
    (0, node_test_1.test)("rechaza null bytes y caracteres de control", () => {
        assert.throws(() => (0, writer_1.safeSegment)("foo\0null", "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)("foo\nbar", "name"), /INVALID_PATH_SEGMENT/);
    });
    (0, node_test_1.test)("rechaza nombres que empiezan con número o mayúscula", () => {
        assert.throws(() => (0, writer_1.safeSegment)("1foo", "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)("Foo", "name"), /INVALID_PATH_SEGMENT/);
    });
    (0, node_test_1.test)("rechaza string vacío, undefined, null, números", () => {
        assert.throws(() => (0, writer_1.safeSegment)("", "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)(undefined, "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)(null, "name"), /INVALID_PATH_SEGMENT/);
        assert.throws(() => (0, writer_1.safeSegment)(123, "name"), /INVALID_PATH_SEGMENT/);
    });
});
(0, node_test_1.describe)("assertWithinAllowedRoot", () => {
    (0, node_test_1.test)("acepta path dentro del root", () => {
        const root = "/project/src/api";
        const file = "/project/src/api/article/schema.json";
        assert.doesNotThrow(() => (0, writer_1.assertWithinAllowedRoot)(file, root));
    });
    (0, node_test_1.test)("rechaza path que escapa con ../", () => {
        const root = "/project/src/api";
        const file = "/project/src/api/../../../etc/passwd";
        assert.throws(() => (0, writer_1.assertWithinAllowedRoot)(file, root), /PATH_ESCAPE_DETECTED/);
    });
    (0, node_test_1.test)("rechaza path en directorio hermano", () => {
        const root = "/project/src/api";
        const file = "/project/src/components/sneaky.json";
        assert.throws(() => (0, writer_1.assertWithinAllowedRoot)(file, root), /PATH_ESCAPE_DETECTED/);
    });
    (0, node_test_1.test)("acepta el root mismo (caso edge)", () => {
        const root = "/project/src/api";
        assert.doesNotThrow(() => (0, writer_1.assertWithinAllowedRoot)(root, root));
    });
});
(0, node_test_1.describe)("pathsForComponent", () => {
    (0, node_test_1.test)("genera path correcto con segments válidos", () => {
        const result = (0, writer_1.pathsForComponent)("shared", "seo");
        assert.equal(result.length, 1);
        assert.ok(result[0].path.endsWith(path.join("src", "components", "shared", "seo.json")));
    });
    (0, node_test_1.test)("rechaza category traversal", () => {
        assert.throws(() => (0, writer_1.pathsForComponent)("../etc", "evil"), /INVALID_PATH_SEGMENT/);
    });
    (0, node_test_1.test)("rechaza name traversal", () => {
        assert.throws(() => (0, writer_1.pathsForComponent)("shared", "../../etc/passwd"), /INVALID_PATH_SEGMENT/);
    });
});
(0, node_test_1.describe)("pathsForContentType", () => {
    (0, node_test_1.test)("genera los 4 paths (schema + controller + router + service)", () => {
        const paths = (0, writer_1.pathsForContentType)("article");
        assert.ok(paths.schema.includes(path.join("api", "article", "content-types", "article", "schema.json")));
        assert.ok(paths.controller.includes(path.join("api", "article", "controllers", "article.ts")));
        assert.ok(paths.router.includes(path.join("api", "article", "routes", "article.ts")));
        assert.ok(paths.service.includes(path.join("api", "article", "services", "article.ts")));
    });
    (0, node_test_1.test)("rechaza singular name traversal", () => {
        assert.throws(() => (0, writer_1.pathsForContentType)("../../etc"), /INVALID_PATH_SEGMENT/);
    });
});
(0, node_test_1.describe)("backupPathFor", () => {
    (0, node_test_1.test)("preserva jerarquía relativa bajo .strapi-mcp-backups/", () => {
        const original = path.join(process.cwd(), "src", "components", "shared", "seo.json");
        const backup = (0, writer_1.backupPathFor)(original, "2026-01-01");
        assert.ok(backup !== null);
        assert.ok(backup.includes(".strapi-mcp-backups"));
        assert.ok(backup.includes("seo.json.bak.2026-01-01"));
        // Y mantiene src/components/shared/ adentro
        assert.ok(backup.includes(path.join("src", "components", "shared")));
    });
    (0, node_test_1.test)("retorna null si el path está FUERA del project root", () => {
        const outside = "/tmp/foreign.json";
        const backup = (0, writer_1.backupPathFor)(outside, "2026-01-01");
        assert.equal(backup, null);
    });
});
(0, node_test_1.describe)("isProduction (fail-closed M4)", () => {
    var _a;
    const original = process.env.NODE_ENV;
    (0, node_test_1.test)("development → false", () => {
        process.env.NODE_ENV = "development";
        assert.equal((0, writer_1.isProduction)(), false);
    });
    (0, node_test_1.test)("dev → false", () => {
        process.env.NODE_ENV = "dev";
        assert.equal((0, writer_1.isProduction)(), false);
    });
    (0, node_test_1.test)("test → false", () => {
        process.env.NODE_ENV = "test";
        assert.equal((0, writer_1.isProduction)(), false);
    });
    (0, node_test_1.test)("production → true", () => {
        process.env.NODE_ENV = "production";
        assert.equal((0, writer_1.isProduction)(), true);
    });
    (0, node_test_1.test)("staging → true (fail-closed)", () => {
        process.env.NODE_ENV = "staging";
        assert.equal((0, writer_1.isProduction)(), true);
    });
    (0, node_test_1.test)("undefined → true (fail-closed)", () => {
        delete process.env.NODE_ENV;
        assert.equal((0, writer_1.isProduction)(), true);
    });
    (0, node_test_1.test)("empty string → true (fail-closed)", () => {
        process.env.NODE_ENV = "";
        assert.equal((0, writer_1.isProduction)(), true);
    });
    (0, node_test_1.test)("unknown value → true (fail-closed)", () => {
        process.env.NODE_ENV = "qa";
        assert.equal((0, writer_1.isProduction)(), true);
    });
    // restore
    (_a = node_test_1.test.after) === null || _a === void 0 ? void 0 : _a.call(node_test_1.test, () => {
        if (original !== undefined)
            process.env.NODE_ENV = original;
        else
            delete process.env.NODE_ENV;
    });
});
(0, node_test_1.describe)("COMPONENTS_ROOT / API_ROOT (sanity)", () => {
    (0, node_test_1.test)("ambos devuelven paths absolutos bajo cwd", () => {
        assert.ok(path.isAbsolute((0, writer_1.COMPONENTS_ROOT)()));
        assert.ok(path.isAbsolute((0, writer_1.API_ROOT)()));
        assert.ok((0, writer_1.COMPONENTS_ROOT)().includes("components"));
        assert.ok((0, writer_1.API_ROOT)().includes("api"));
    });
});
