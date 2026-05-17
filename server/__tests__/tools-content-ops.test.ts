import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { contentOpsTools } from "../services/tools/content-ops";
import { makeMockStrapi } from "./_helpers";

function getTool(name: string) {
  const t = contentOpsTools.find((tool) => tool.name === name);
  if (!t) throw new Error(`Tool ${name} not in contentOpsTools`);
  return t;
}

describe("content-ops: assertContentType", () => {
  test("find_entries rechaza uid que no es api::*", async () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "admin::user": { attributes: {} },
      },
    });
    const tool = getTool("find_entries");
    await assert.rejects(
      tool.handler({ strapi: strapi as any }, { uid: "admin::user" } as any),
      /internos? de Strapi|no existe/i
    );
  });

  test("find_entries rechaza uid inexistente", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("find_entries");
    await assert.rejects(
      tool.handler({ strapi: strapi as any }, { uid: "api::ghost.ghost" } as any),
      /no existe/
    );
  });
});

describe("content-ops: find_entries pageSize cap (M1)", () => {
  test("pageSize > 200 se capea a 200 y devuelve pagination_capped warning", async () => {
    let captured: any = null;
    const strapi = makeMockStrapi({
      contentTypes: { "api::article.article": { attributes: {} } },
      documentsImpl: (_uid: string) => ({
        findMany: async (q: any) => {
          captured = q;
          return [];
        },
        count: async () => 0,
      }),
    });
    const tool = getTool("find_entries");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      { uid: "api::article.article", pagination: { page: 1, pageSize: 100000 } } as any
    );
    assert.equal(captured.limit, 200, "limit pasado a strapi.documents debe ser 200");
    assert.equal(result.pagination.pageSize, 200);
    assert.ok(result.pagination_capped, "respuesta debe incluir pagination_capped");
    assert.match(result.pagination_capped, /cap/);
  });

  test("pageSize válido (default 25) no capea", async () => {
    const strapi = makeMockStrapi({
      contentTypes: { "api::article.article": { attributes: {} } },
      documentsImpl: (_uid: string) => ({
        findMany: async () => [],
        count: async () => 0,
      }),
    });
    const tool = getTool("find_entries");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      { uid: "api::article.article" } as any
    );
    assert.equal(result.pagination.pageSize, 25);
    assert.equal(result.pagination_capped, undefined);
  });

  test("pageSize negativo se eleva a 1", async () => {
    const strapi = makeMockStrapi({
      contentTypes: { "api::article.article": { attributes: {} } },
      documentsImpl: () => ({ findMany: async () => [], count: async () => 0 }),
    });
    const tool = getTool("find_entries");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      { uid: "api::article.article", pagination: { page: 1, pageSize: -10 } } as any
    );
    assert.equal(result.pagination.pageSize, 1);
  });
});

describe("content-ops: delete_entry confirm flag", () => {
  test("rechaza sin confirm:true", async () => {
    const strapi = makeMockStrapi({
      contentTypes: { "api::article.article": { attributes: {} } },
    });
    const tool = getTool("delete_entry");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        { uid: "api::article.article", documentId: "x", confirm: false } as any
      ),
      /confirm:true/
    );
  });

  test("acepta con confirm:true", async () => {
    let deleted = false;
    const strapi = makeMockStrapi({
      contentTypes: { "api::article.article": { attributes: {} } },
      documentsImpl: (_uid: string) => ({
        delete: async () => {
          deleted = true;
          return { documentId: "x" };
        },
      }),
    });
    const tool = getTool("delete_entry");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      { uid: "api::article.article", documentId: "x", confirm: true } as any
    );
    assert.equal(deleted, true);
    assert.equal(result.success, true);
  });
});

describe("content-ops: publish/unpublish requiere D&P", () => {
  test("publish_entry rechaza si CT no tiene draftAndPublish", async () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::article.article": {
          attributes: {},
          options: { draftAndPublish: false },
        },
      },
    });
    const tool = getTool("publish_entry");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        { uid: "api::article.article", documentId: "x", confirm: true } as any
      ),
      /draftAndPublish/
    );
  });

  test("publish_entry funciona si CT tiene D&P y confirm:true", async () => {
    let published = false;
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::article.article": {
          attributes: {},
          options: { draftAndPublish: true },
        },
      },
      documentsImpl: (_uid: string) => ({
        publish: async () => {
          published = true;
          return { documentId: "x", versions: [] };
        },
      }),
    });
    const tool = getTool("publish_entry");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      { uid: "api::article.article", documentId: "x", confirm: true } as any
    );
    assert.equal(published, true);
    assert.equal(result.success, true);
  });
});
