import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import {
  generateDeepPopulate,
  generateComponentPopulate,
  generateDynamicZonePopulate,
  DEFAULT_POPULATE_DEPTH,
  MAX_POPULATE_DEPTH,
} from "../services/populate/deep-populate";
import { makeMockStrapi } from "./_helpers";

describe("generateDeepPopulate — primitives & guards", () => {
  test("depth <= 0 returns '*'", () => {
    const strapi = makeMockStrapi({
      contentTypes: { "api::page.page": { attributes: { title: { type: "string" } } } },
    });
    assert.equal(generateDeepPopulate(strapi as any, "api::page.page", 0), "*");
    assert.equal(generateDeepPopulate(strapi as any, "api::page.page", -1), "*");
  });

  test("unknown UID returns '*'", () => {
    const strapi = makeMockStrapi({ contentTypes: {} });
    assert.equal(generateDeepPopulate(strapi as any, "api::missing.x", 4), "*");
  });

  test("CT with only scalars returns empty populate", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::page.page": {
          attributes: {
            title: { type: "string" },
            body: { type: "richtext" },
            count: { type: "integer" },
            active: { type: "boolean" },
          },
        },
      },
    });
    assert.deepEqual(generateDeepPopulate(strapi as any, "api::page.page", 4), {});
  });

  test("ignored attribute names (createdAt, documentId, etc.) are skipped", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::x.x": {
          attributes: {
            title: { type: "string" },
            createdAt: { type: "datetime" },
            createdBy: { type: "relation", target: "admin::user" },
            documentId: { type: "uid" },
          },
        },
      },
    });
    assert.deepEqual(generateDeepPopulate(strapi as any, "api::x.x", 4), {});
  });
});

describe("generateDeepPopulate — media & relations", () => {
  test("media field gets populate=true", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::page.page": {
          attributes: { cover: { type: "media" } },
        },
      },
    });
    assert.deepEqual(generateDeepPopulate(strapi as any, "api::page.page", 4), { cover: true });
  });

  test("relation to system model uses shallow populate=true (no recursion)", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::page.page": {
          attributes: { author: { type: "relation", target: "admin::user" } },
        },
      },
    });
    assert.deepEqual(generateDeepPopulate(strapi as any, "api::page.page", 4), { author: true });
  });

  test("relation to other CT recurses with depth-1", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::article.article": {
          attributes: {
            title: { type: "string" },
            author: { type: "relation", target: "api::author.author" },
          },
        },
        "api::author.author": {
          attributes: {
            name: { type: "string" },
            avatar: { type: "media" },
          },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::article.article", 4) as any;
    assert.ok(out.author, "author key should exist");
    assert.deepEqual(out.author, { populate: { avatar: true } });
  });

  test("cycle protection: relation back to a visited CT returns '*'", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::a.a": {
          attributes: { ref_b: { type: "relation", target: "api::b.b" } },
        },
        "api::b.b": {
          attributes: { ref_a: { type: "relation", target: "api::a.a" } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::a.a", 6) as any;
    assert.deepEqual(out, { ref_b: { populate: { ref_a: { populate: "*" } } } });
  });

  test("self-referencing relation does not loop", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::tree.tree": {
          attributes: { parent: { type: "relation", target: "api::tree.tree" } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::tree.tree", 4) as any;
    // Top call adds api::tree.tree to visited; recursion sees it visited → "*"
    assert.deepEqual(out, { parent: { populate: "*" } });
  });
});

describe("generateDeepPopulate — components", () => {
  test("component without complex fields → populate=true", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::x.x": {
          attributes: { btn: { type: "component", component: "atoms.button" } },
        },
      },
      components: {
        "atoms.button": {
          attributes: { label: { type: "string" }, url: { type: "string" } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::x.x", 4) as any;
    assert.deepEqual(out, { btn: true });
  });

  test("component with media inside → populate sub-tree", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::x.x": {
          attributes: { hero: { type: "component", component: "sections.hero" } },
        },
      },
      components: {
        "sections.hero": {
          attributes: { title: { type: "string" }, image: { type: "media" } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::x.x", 4) as any;
    assert.deepEqual(out, { hero: { populate: { image: true } } });
  });

  test("component with nested component → recurses", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::x.x": {
          attributes: { card: { type: "component", component: "molecules.card" } },
        },
      },
      components: {
        "molecules.card": {
          attributes: {
            label: { type: "string" },
            button: { type: "component", component: "atoms.button" },
          },
        },
        "atoms.button": {
          attributes: { label: { type: "string" }, icon: { type: "media" } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::x.x", 4) as any;
    assert.deepEqual(out, {
      card: { populate: { button: { populate: { icon: true } } } },
    });
  });
});

describe("generateDeepPopulate — dynamic zones", () => {
  test("dynamiczone produces { on: { compUid: ... } } syntax", () => {
    const strapi = makeMockStrapi({
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
      components: {
        "sections.hero": { attributes: { title: { type: "string" }, image: { type: "media" } } },
        "sections.cta": { attributes: { label: { type: "string" } } },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::page.page", 4) as any;
    assert.ok(out.blocks.on, "should produce { on: ... } for dynzone");
    assert.deepEqual(out.blocks.on["sections.hero"], { populate: { image: true } });
    assert.equal(out.blocks.on["sections.cta"], true);
  });

  test("dynamiczone with no components in the array → empty 'on'", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::x.x": {
          attributes: { blocks: { type: "dynamiczone", components: [] } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::x.x", 4) as any;
    assert.deepEqual(out.blocks, { on: {} });
  });
});

describe("generateDeepPopulate — depth cap behavior", () => {
  test("depth=1: relations populate but their sub-fields are '*'", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::a.a": {
          attributes: { ref: { type: "relation", target: "api::b.b" } },
        },
        "api::b.b": {
          attributes: { title: { type: "string" }, cover: { type: "media" } },
        },
      },
    });
    const out = generateDeepPopulate(strapi as any, "api::a.a", 1) as any;
    // depth 1: enter relation with depth 0 → returns "*"
    assert.deepEqual(out, { ref: { populate: "*" } });
  });

  test("constants exported correctly", () => {
    assert.equal(DEFAULT_POPULATE_DEPTH, 4);
    assert.equal(MAX_POPULATE_DEPTH, 6);
  });
});

describe("generateComponentPopulate — direct call edge cases", () => {
  test("unknown component returns true", () => {
    const strapi = makeMockStrapi({ components: {} });
    assert.equal(generateComponentPopulate(strapi as any, "missing.x", 4, new Set()), true);
  });

  test("component with only scalars returns true (no sub-populate)", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.x": { attributes: { label: { type: "string" } } } },
    });
    assert.equal(generateComponentPopulate(strapi as any, "atoms.x", 4, new Set()), true);
  });
});

describe("generateDynamicZonePopulate — direct call edge cases", () => {
  test("depth=0 returns { on: {} }", () => {
    const strapi = makeMockStrapi();
    assert.deepEqual(
      generateDynamicZonePopulate(strapi as any, ["sections.hero"], 0, new Set()),
      { on: {} }
    );
  });
});
