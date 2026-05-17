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
const content_ops_1 = require("../services/tools/content-ops");
const _helpers_1 = require("./_helpers");
function getTool(name) {
    const t = content_ops_1.contentOpsTools.find((tool) => tool.name === name);
    if (!t)
        throw new Error(`Tool ${name} not in contentOpsTools`);
    return t;
}
(0, node_test_1.describe)("content-ops: assertContentType", () => {
    (0, node_test_1.test)("find_entries rechaza uid que no es api::*", async () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "admin::user": { attributes: {} },
            },
        });
        const tool = getTool("find_entries");
        await assert.rejects(tool.handler({ strapi: strapi }, { uid: "admin::user" }), /internos? de Strapi|no existe/i);
    });
    (0, node_test_1.test)("find_entries rechaza uid inexistente", async () => {
        const strapi = (0, _helpers_1.makeMockStrapi)();
        const tool = getTool("find_entries");
        await assert.rejects(tool.handler({ strapi: strapi }, { uid: "api::ghost.ghost" }), /no existe/);
    });
});
(0, node_test_1.describe)("content-ops: find_entries pageSize cap (M1)", () => {
    (0, node_test_1.test)("pageSize > 200 se capea a 200 y devuelve pagination_capped warning", async () => {
        let captured = null;
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: { "api::article.article": { attributes: {} } },
            documentsImpl: (_uid) => ({
                findMany: async (q) => {
                    captured = q;
                    return [];
                },
                count: async () => 0,
            }),
        });
        const tool = getTool("find_entries");
        const result = await tool.handler({ strapi: strapi }, { uid: "api::article.article", pagination: { page: 1, pageSize: 100000 } });
        assert.equal(captured.limit, 200, "limit pasado a strapi.documents debe ser 200");
        assert.equal(result.pagination.pageSize, 200);
        assert.ok(result.pagination_capped, "respuesta debe incluir pagination_capped");
        assert.match(result.pagination_capped, /cap/);
    });
    (0, node_test_1.test)("pageSize válido (default 25) no capea", async () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: { "api::article.article": { attributes: {} } },
            documentsImpl: (_uid) => ({
                findMany: async () => [],
                count: async () => 0,
            }),
        });
        const tool = getTool("find_entries");
        const result = await tool.handler({ strapi: strapi }, { uid: "api::article.article" });
        assert.equal(result.pagination.pageSize, 25);
        assert.equal(result.pagination_capped, undefined);
    });
    (0, node_test_1.test)("pageSize negativo se eleva a 1", async () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: { "api::article.article": { attributes: {} } },
            documentsImpl: () => ({ findMany: async () => [], count: async () => 0 }),
        });
        const tool = getTool("find_entries");
        const result = await tool.handler({ strapi: strapi }, { uid: "api::article.article", pagination: { page: 1, pageSize: -10 } });
        assert.equal(result.pagination.pageSize, 1);
    });
});
(0, node_test_1.describe)("content-ops: delete_entry confirm flag", () => {
    (0, node_test_1.test)("rechaza sin confirm:true", async () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: { "api::article.article": { attributes: {} } },
        });
        const tool = getTool("delete_entry");
        await assert.rejects(tool.handler({ strapi: strapi }, { uid: "api::article.article", documentId: "x", confirm: false }), /confirm:true/);
    });
    (0, node_test_1.test)("acepta con confirm:true", async () => {
        let deleted = false;
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: { "api::article.article": { attributes: {} } },
            documentsImpl: (_uid) => ({
                delete: async () => {
                    deleted = true;
                    return { documentId: "x" };
                },
            }),
        });
        const tool = getTool("delete_entry");
        const result = await tool.handler({ strapi: strapi }, { uid: "api::article.article", documentId: "x", confirm: true });
        assert.equal(deleted, true);
        assert.equal(result.success, true);
    });
});
(0, node_test_1.describe)("content-ops: publish/unpublish requiere D&P", () => {
    (0, node_test_1.test)("publish_entry rechaza si CT no tiene draftAndPublish", async () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "api::article.article": {
                    attributes: {},
                    options: { draftAndPublish: false },
                },
            },
        });
        const tool = getTool("publish_entry");
        await assert.rejects(tool.handler({ strapi: strapi }, { uid: "api::article.article", documentId: "x", confirm: true }), /draftAndPublish/);
    });
    (0, node_test_1.test)("publish_entry funciona si CT tiene D&P y confirm:true", async () => {
        let published = false;
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "api::article.article": {
                    attributes: {},
                    options: { draftAndPublish: true },
                },
            },
            documentsImpl: (_uid) => ({
                publish: async () => {
                    published = true;
                    return { documentId: "x", versions: [] };
                },
            }),
        });
        const tool = getTool("publish_entry");
        const result = await tool.handler({ strapi: strapi }, { uid: "api::article.article", documentId: "x", confirm: true });
        assert.equal(published, true);
        assert.equal(result.success, true);
    });
});
