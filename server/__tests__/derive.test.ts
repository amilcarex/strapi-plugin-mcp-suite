import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import {
  formatAttribute,
  deriveAttributes,
  deriveComponentFields,
  deriveContentTypeFields,
  getDynamicZoneUids,
} from "../services/schema-derivation/derive";
import { makeMockStrapi } from "./_helpers";

describe("formatAttribute", () => {
  test("string simple", () => {
    assert.equal(formatAttribute({ type: "string" }), "string");
  });

  test("string required", () => {
    assert.equal(formatAttribute({ type: "string", required: true }), "string (required)");
  });

  test("string con min/max", () => {
    assert.equal(
      formatAttribute({ type: "string", min: 3, max: 50 }),
      "string (min: 3, max: 50)"
    );
  });

  test("enumeration formatea valores con pipes", () => {
    assert.equal(
      formatAttribute({ type: "enumeration", enum: ["a", "b", "c"] }),
      "'a'|'b'|'c'"
    );
  });

  test("relation con target", () => {
    assert.equal(
      formatAttribute({ type: "relation", relation: "manyToOne", target: "api::author.author" }),
      "relation:manyToOne → api::author.author"
    );
  });

  test("relation con inversedBy", () => {
    const r = formatAttribute({
      type: "relation",
      relation: "manyToOne",
      target: "api::author.author",
      inversedBy: "articles",
    });
    assert.match(r, /inversedBy: articles/);
  });

  test("media multiple", () => {
    assert.equal(formatAttribute({ type: "media", multiple: true }), "media[]");
  });

  test("media required", () => {
    assert.equal(
      formatAttribute({ type: "media", required: true }),
      "media (required)"
    );
  });

  test("component repeatable", () => {
    assert.equal(
      formatAttribute({ type: "component", component: "shared.seo", repeatable: true }),
      "shared.seo[]"
    );
  });

  test("dynamiczone con components", () => {
    assert.equal(
      formatAttribute({ type: "dynamiczone", components: ["sections.hero", "sections.faq"] }),
      "dynamiczone[ sections.hero | sections.faq ]"
    );
  });

  test("type desconocido devuelve el type", () => {
    assert.equal(formatAttribute({ type: "weird-type" }), "weird-type");
  });

  test("uid con targetField", () => {
    const r = formatAttribute({ type: "uid", targetField: "title" });
    assert.match(r, /uid.*"title"/);
  });

  test("boolean", () => {
    assert.equal(formatAttribute({ type: "boolean" }), "boolean");
  });

  test("integer y biginteger", () => {
    assert.equal(formatAttribute({ type: "integer" }), "integer");
    assert.equal(formatAttribute({ type: "biginteger" }), "integer");
  });

  test("float y decimal", () => {
    assert.equal(formatAttribute({ type: "float" }), "number");
    assert.equal(formatAttribute({ type: "decimal" }), "number");
  });

  test("json", () => {
    assert.equal(formatAttribute({ type: "json" }), "JSON (objeto/array libre)");
  });
});

describe("deriveAttributes", () => {
  test("mapea cada attribute con su formato", () => {
    const r = deriveAttributes({
      title: { type: "string", required: true },
      count: { type: "integer" },
    });
    assert.equal(r.title, "string (required)");
    assert.equal(r.count, "integer");
  });

  test("attrs vacíos devuelve objeto vacío", () => {
    assert.deepEqual(deriveAttributes({}), {});
  });
});

describe("deriveComponentFields / deriveContentTypeFields", () => {
  test("deriveComponentFields devuelve fields formateados", () => {
    const strapi = makeMockStrapi({
      components: {
        "shared.seo": {
          info: { description: "Metadata" },
          attributes: { title: { type: "string" }, description: { type: "text" } },
        },
      },
    });
    const r = deriveComponentFields(strapi as any, "shared.seo");
    assert.ok(r);
    assert.equal(r!.description, "Metadata");
    assert.equal(r!.fields.title, "string");
    assert.equal(r!.fields.description, "string");
  });

  test("deriveComponentFields devuelve null para UID inexistente", () => {
    const strapi = makeMockStrapi();
    const r = deriveComponentFields(strapi as any, "no.exists");
    assert.equal(r, null);
  });

  test("deriveComponentFields lee defaultName si existe", () => {
    const strapi = makeMockStrapi({
      components: {
        "sections.hero": {
          info: { description: "Hero" },
          attributes: { name: { type: "string", default: "hero_section" } },
        },
      },
    });
    const r = deriveComponentFields(strapi as any, "sections.hero");
    assert.equal(r!.defaultName, "hero_section");
  });

  test("deriveContentTypeFields devuelve kind correcto", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::article.article": {
          kind: "collectionType",
          info: { description: "Posts" },
          attributes: { title: { type: "string" } },
        },
      },
    });
    const r = deriveContentTypeFields(strapi as any, "api::article.article");
    assert.equal(r!.kind, "collectionType");
    assert.equal(r!.description, "Posts");
  });
});

describe("getDynamicZoneUids", () => {
  test("devuelve UIDs cuando hay dynamic zone", () => {
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
    });
    const r = getDynamicZoneUids(strapi as any, "api::page.page", "blocks");
    assert.deepEqual(r, ["sections.hero", "sections.cta"]);
  });

  test("devuelve array vacío si no hay dynamic zone con ese nombre", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::article.article": {
          attributes: { title: { type: "string" } },
        },
      },
    });
    const r = getDynamicZoneUids(strapi as any, "api::article.article", "nonexistent");
    assert.deepEqual(r, []);
  });

  test("devuelve array vacío si el CT no existe", () => {
    const strapi = makeMockStrapi();
    const r = getDynamicZoneUids(strapi as any, "api::ghost.ghost", "blocks");
    assert.deepEqual(r, []);
  });
});
