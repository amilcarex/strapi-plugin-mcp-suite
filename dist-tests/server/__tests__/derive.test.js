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
const derive_1 = require("../services/schema-derivation/derive");
const _helpers_1 = require("./_helpers");
(0, node_test_1.describe)("formatAttribute", () => {
    (0, node_test_1.test)("string simple", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "string" }), "string");
    });
    (0, node_test_1.test)("string required", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "string", required: true }), "string (required)");
    });
    (0, node_test_1.test)("string con min/max", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "string", min: 3, max: 50 }), "string (min: 3, max: 50)");
    });
    (0, node_test_1.test)("enumeration formatea valores con pipes", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "enumeration", enum: ["a", "b", "c"] }), "'a'|'b'|'c'");
    });
    (0, node_test_1.test)("relation con target", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "relation", relation: "manyToOne", target: "api::author.author" }), "relation:manyToOne → api::author.author");
    });
    (0, node_test_1.test)("relation con inversedBy", () => {
        const r = (0, derive_1.formatAttribute)({
            type: "relation",
            relation: "manyToOne",
            target: "api::author.author",
            inversedBy: "articles",
        });
        assert.match(r, /inversedBy: articles/);
    });
    (0, node_test_1.test)("media multiple", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "media", multiple: true }), "media[]");
    });
    (0, node_test_1.test)("media required", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "media", required: true }), "media (required)");
    });
    (0, node_test_1.test)("component repeatable", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "component", component: "shared.seo", repeatable: true }), "shared.seo[]");
    });
    (0, node_test_1.test)("dynamiczone con components", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "dynamiczone", components: ["sections.hero", "sections.faq"] }), "dynamiczone[ sections.hero | sections.faq ]");
    });
    (0, node_test_1.test)("type desconocido devuelve el type", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "weird-type" }), "weird-type");
    });
    (0, node_test_1.test)("uid con targetField", () => {
        const r = (0, derive_1.formatAttribute)({ type: "uid", targetField: "title" });
        assert.match(r, /uid.*"title"/);
    });
    (0, node_test_1.test)("boolean", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "boolean" }), "boolean");
    });
    (0, node_test_1.test)("integer y biginteger", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "integer" }), "integer");
        assert.equal((0, derive_1.formatAttribute)({ type: "biginteger" }), "integer");
    });
    (0, node_test_1.test)("float y decimal", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "float" }), "number");
        assert.equal((0, derive_1.formatAttribute)({ type: "decimal" }), "number");
    });
    (0, node_test_1.test)("json", () => {
        assert.equal((0, derive_1.formatAttribute)({ type: "json" }), "JSON (objeto/array libre)");
    });
});
(0, node_test_1.describe)("deriveAttributes", () => {
    (0, node_test_1.test)("mapea cada attribute con su formato", () => {
        const r = (0, derive_1.deriveAttributes)({
            title: { type: "string", required: true },
            count: { type: "integer" },
        });
        assert.equal(r.title, "string (required)");
        assert.equal(r.count, "integer");
    });
    (0, node_test_1.test)("attrs vacíos devuelve objeto vacío", () => {
        assert.deepEqual((0, derive_1.deriveAttributes)({}), {});
    });
});
(0, node_test_1.describe)("deriveComponentFields / deriveContentTypeFields", () => {
    (0, node_test_1.test)("deriveComponentFields devuelve fields formateados", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            components: {
                "shared.seo": {
                    info: { description: "Metadata" },
                    attributes: { title: { type: "string" }, description: { type: "text" } },
                },
            },
        });
        const r = (0, derive_1.deriveComponentFields)(strapi, "shared.seo");
        assert.ok(r);
        assert.equal(r.description, "Metadata");
        assert.equal(r.fields.title, "string");
        assert.equal(r.fields.description, "string");
    });
    (0, node_test_1.test)("deriveComponentFields devuelve null para UID inexistente", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)();
        const r = (0, derive_1.deriveComponentFields)(strapi, "no.exists");
        assert.equal(r, null);
    });
    (0, node_test_1.test)("deriveComponentFields lee defaultName si existe", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            components: {
                "sections.hero": {
                    info: { description: "Hero" },
                    attributes: { name: { type: "string", default: "hero_section" } },
                },
            },
        });
        const r = (0, derive_1.deriveComponentFields)(strapi, "sections.hero");
        assert.equal(r.defaultName, "hero_section");
    });
    (0, node_test_1.test)("deriveContentTypeFields devuelve kind correcto", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "api::article.article": {
                    kind: "collectionType",
                    info: { description: "Posts" },
                    attributes: { title: { type: "string" } },
                },
            },
        });
        const r = (0, derive_1.deriveContentTypeFields)(strapi, "api::article.article");
        assert.equal(r.kind, "collectionType");
        assert.equal(r.description, "Posts");
    });
});
(0, node_test_1.describe)("getDynamicZoneUids", () => {
    (0, node_test_1.test)("devuelve UIDs cuando hay dynamic zone", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "api::page.page": {
                    attributes: {
                        blocks: {
                            type: "dynamiczone",
                            components: ["sections.hero", "sections.cta"],
                        },
                    },
                },
            },
        });
        const r = (0, derive_1.getDynamicZoneUids)(strapi, "api::page.page", "blocks");
        assert.deepEqual(r, ["sections.hero", "sections.cta"]);
    });
    (0, node_test_1.test)("devuelve array vacío si no hay dynamic zone con ese nombre", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "api::article.article": {
                    attributes: { title: { type: "string" } },
                },
            },
        });
        const r = (0, derive_1.getDynamicZoneUids)(strapi, "api::article.article", "nonexistent");
        assert.deepEqual(r, []);
    });
    (0, node_test_1.test)("devuelve array vacío si el CT no existe", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)();
        const r = (0, derive_1.getDynamicZoneUids)(strapi, "api::ghost.ghost", "blocks");
        assert.deepEqual(r, []);
    });
});
