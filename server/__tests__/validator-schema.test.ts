import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { validateSchemaProposal } from "../services/schema-authoring/validator";
import { makeMockStrapi } from "./_helpers";

const strapiEmpty = makeMockStrapi();

describe("validator-schema — happy path", () => {
  test("component plano válido pasa", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "shared.atom-button",
        kind: "component",
        schema: {
          collectionName: "components_shared_atom_buttons",
          info: { displayName: "Atom Button" },
          attributes: {
            label: { type: "string", required: true },
            size: { type: "enumeration", enum: ["small", "medium", "large"] },
          },
        },
      },
      "create"
    );
    assert.equal(r.valid, true);
    assert.equal(r.violations.length, 0);
  });

  test("content-type válido pasa", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "api::product.product",
        kind: "content-type",
        schema: {
          kind: "collectionType",
          collectionName: "products",
          info: { singularName: "product", pluralName: "products", displayName: "Product" },
          options: { draftAndPublish: true },
          attributes: {
            title: { type: "string", required: true },
            price: { type: "decimal" },
          },
        },
      },
      "create"
    );
    assert.equal(r.valid, true);
  });
});

describe("validator-schema — RESERVED_ATTRIBUTE_NAME", () => {
  const reserved = ["id", "documentId", "createdAt", "updatedAt", "publishedAt", "createdBy", "updatedBy", "locale", "localizations"];
  for (const name of reserved) {
    test(`rechaza atributo reservado "${name}"`, () => {
      const r = validateSchemaProposal(
        strapiEmpty as any,
        {
          uid: "shared.x",
          kind: "component",
          schema: { info: { displayName: "X" }, attributes: { [name]: { type: "string" } } },
        },
        "create"
      );
      assert.equal(r.valid, false);
      assert.ok(r.violations.some((v) => v.code === "RESERVED_ATTRIBUTE_NAME"));
    });
  }
});

describe("validator-schema — MISSING_REQUIRED_PROP", () => {
  test("relation sin target", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "api::demo.demo",
        kind: "content-type",
        schema: {
          info: { singularName: "demo", pluralName: "demos", displayName: "Demo" },
          attributes: { thing: { type: "relation", relation: "oneToMany" } },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === "MISSING_REQUIRED_PROP"));
  });

  test("enumeration sin enum array", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "shared.x",
        kind: "component",
        schema: {
          info: { displayName: "X" },
          attributes: { status: { type: "enumeration" } },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === "MISSING_REQUIRED_PROP"));
  });

  test("enumeration con enum vacío", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "shared.x",
        kind: "component",
        schema: {
          info: { displayName: "X" },
          attributes: { status: { type: "enumeration", enum: [] } },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
  });

  test("dynamiczone sin components", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "api::page.page",
        kind: "content-type",
        schema: {
          info: { singularName: "page", pluralName: "pages", displayName: "Page" },
          attributes: { blocks: { type: "dynamiczone", components: [] } },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
  });
});

describe("validator-schema — INVALID_NAME", () => {
  test("rechaza singularName con mayúscula", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "api::Product.Product",
        kind: "content-type",
        schema: {
          info: { singularName: "Product", pluralName: "Products", displayName: "Product" },
          attributes: {},
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
  });

  test("rechaza component category con caracter raro", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "BAD!CAT.x",
        kind: "component",
        schema: { info: { displayName: "X" }, attributes: {} },
      },
      "create"
    );
    assert.equal(r.valid, false);
  });
});

describe("validator-schema — UNKNOWN_REFERENCE", () => {
  test("component que referencia componente inexistente", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "shared.card",
        kind: "component",
        schema: {
          info: { displayName: "Card" },
          attributes: {
            inner: { type: "component", component: "atoms.does-not-exist", repeatable: false },
          },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === "UNKNOWN_REFERENCE"));
  });

  test("relation que apunta a CT inexistente", () => {
    const r = validateSchemaProposal(
      strapiEmpty as any,
      {
        uid: "api::demo.demo",
        kind: "content-type",
        schema: {
          info: { singularName: "demo", pluralName: "demos", displayName: "Demo" },
          attributes: {
            author: { type: "relation", relation: "manyToOne", target: "api::ghost.ghost" },
          },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === "UNKNOWN_REFERENCE"));
  });
});

describe("validator-schema — NESTED_COMPONENT_DEPTH_EXCEEDED", () => {
  test("rechaza component que anida a otro que ya tiene component (> 1 nivel)", () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.deep": {
          info: { displayName: "Deep" },
          attributes: {
            // ya tiene un component adentro → propuesta lo referenciaría = 2 niveles
            extra: { type: "component", component: "atoms.button", repeatable: false },
          },
        },
        "atoms.button": {
          info: { displayName: "Button" },
          attributes: { label: { type: "string" } },
        },
      },
    });

    const r = validateSchemaProposal(
      strapi as any,
      {
        uid: "molecules.card",
        kind: "component",
        schema: {
          info: { displayName: "Card" },
          attributes: {
            content: { type: "component", component: "atoms.deep", repeatable: false },
          },
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === "NESTED_COMPONENT_DEPTH_EXCEEDED"));
  });

  test("permite 1 nivel de anidamiento (component → component plano)", () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.button": {
          info: { displayName: "Button" },
          attributes: { label: { type: "string" } },
        },
      },
    });

    const r = validateSchemaProposal(
      strapi as any,
      {
        uid: "molecules.cta",
        kind: "component",
        schema: {
          info: { displayName: "CTA" },
          attributes: {
            button: { type: "component", component: "atoms.button", repeatable: false },
          },
        },
      },
      "create"
    );
    assert.equal(r.valid, true);
  });
});

describe("validator-schema — COLLISION_COLLECTION_NAME", () => {
  test("rechaza si collectionName ya existe", () => {
    const strapi = makeMockStrapi({
      contentTypes: {
        "api::existing.existing": {
          collectionName: "products",
          info: { singularName: "existing", pluralName: "existings", displayName: "Existing" },
          attributes: {},
        },
      },
    });
    const r = validateSchemaProposal(
      strapi as any,
      {
        uid: "api::new-thing.new-thing",
        kind: "content-type",
        schema: {
          collectionName: "products",
          info: { singularName: "new-thing", pluralName: "new-things", displayName: "New Thing" },
          attributes: {},
        },
      },
      "create"
    );
    assert.equal(r.valid, false);
    assert.ok(r.violations.some((v) => v.code === "COLLISION_COLLECTION_NAME"));
  });
});

describe("validator-schema — ENUM_VALUE_INVALID_GRAPHQL_NAME (warning, solo si graphql installed)", () => {
  test("no warning si graphql plugin NO instalado", () => {
    const strapi = makeMockStrapi(); // sin graphqlPlugin
    const r = validateSchemaProposal(
      strapi as any,
      {
        uid: "shared.x",
        kind: "component",
        schema: {
          info: { displayName: "X" },
          attributes: { cols: { type: "enumeration", enum: ["1", "2", "3"] } },
        },
      },
      "create"
    );
    assert.equal(r.valid, true);
    assert.equal(r.warnings.length, 0);
  });

  test("warning si graphql plugin INSTALADO + enum empieza con número", () => {
    const strapi = makeMockStrapi({
      graphqlPlugin: { service: () => null },
    });
    const r = validateSchemaProposal(
      strapi as any,
      {
        uid: "shared.x",
        kind: "component",
        schema: {
          info: { displayName: "X" },
          attributes: { cols: { type: "enumeration", enum: ["1col", "2col", "3col"] } },
        },
      },
      "create"
    );
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some((w) => w.code === "ENUM_VALUE_INVALID_GRAPHQL_NAME"));
  });

  test("sin warning si enum values son válidos GraphQL", () => {
    const strapi = makeMockStrapi({
      graphqlPlugin: { service: () => null },
    });
    const r = validateSchemaProposal(
      strapi as any,
      {
        uid: "shared.x",
        kind: "component",
        schema: {
          info: { displayName: "X" },
          attributes: { cols: { type: "enumeration", enum: ["one", "two", "three"] } },
        },
      },
      "create"
    );
    assert.equal(r.warnings.length, 0);
  });
});
