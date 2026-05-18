import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import {
  flattenComponent,
  proposeSchemaStrategies,
} from "../services/schema-authoring/strategies";
import { makeMockStrapi } from "./_helpers";

const DEPTH_VIOLATION = {
  code: "NESTED_COMPONENT_DEPTH_EXCEEDED",
  severity: "error" as const,
  path: "attributes.button.component → atoms.button.attributes.icon",
  message: "Test violation",
};

// ── flattenComponent ──────────────────────────────────────────────────────────

describe("flattenComponent — happy path", () => {
  test("inlines nested attributes with prefix", () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.button": {
          attributes: {
            label: { type: "string", required: true },
            url: { type: "string" },
          },
        },
      },
    });
    const parentAttrs = {
      title: { type: "string" },
      button: { type: "component", component: "atoms.button", repeatable: false },
    };
    const result = flattenComponent(strapi as any, parentAttrs, "button", "atoms.button");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.flat_attributes, {
        title: { type: "string" },
        button_label: { type: "string", required: true },
        button_url: { type: "string" },
      });
      assert.deepEqual(result.renamed, [
        { from: "label", to: "button_label" },
        { from: "url", to: "button_url" },
      ]);
      assert.equal((result.flat_attributes as any).button, undefined, "original nested attr removed");
    }
  });

  test("preserves non-nested attributes verbatim", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.x": { attributes: { foo: { type: "string" } } } },
    });
    const parentAttrs = {
      title: { type: "string", required: true, maxLength: 100 },
      x: { type: "component", component: "atoms.x" },
      counter: { type: "integer", default: 0 },
    };
    const result = flattenComponent(strapi as any, parentAttrs, "x", "atoms.x");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.flat_attributes.title, parentAttrs.title);
      assert.deepEqual(result.flat_attributes.counter, parentAttrs.counter);
    }
  });
});

describe("flattenComponent — refusals", () => {
  test("refuses when parent attr is repeatable", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const parentAttrs = {
      buttons: { type: "component", component: "atoms.button", repeatable: true },
    };
    const result = flattenComponent(strapi as any, parentAttrs, "buttons", "atoms.button");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "PARENT_REPEATABLE");
      assert.match(result.explanation, /repeatable/);
    }
  });

  test("refuses when nested component doesn't exist", () => {
    const strapi = makeMockStrapi({ components: {} });
    const parentAttrs = {
      button: { type: "component", component: "atoms.missing", repeatable: false },
    };
    const result = flattenComponent(strapi as any, parentAttrs, "button", "atoms.missing");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "NESTED_NOT_FOUND");
    }
  });

  test("refuses when prefixed name would collide with existing parent attr", () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.button": { attributes: { label: { type: "string" } } },
      },
    });
    const parentAttrs = {
      button_label: { type: "string" }, // pre-existing collision
      button: { type: "component", component: "atoms.button", repeatable: false },
    };
    const result = flattenComponent(strapi as any, parentAttrs, "button", "atoms.button");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "NAME_COLLISION");
      assert.match(result.explanation, /button_label/);
    }
  });
});

// ── proposeSchemaStrategies ───────────────────────────────────────────────────

describe("proposeSchemaStrategies — flat strategy", () => {
  test("flat available when parent is not repeatable", () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.button": { attributes: { label: { type: "string" }, url: { type: "string" } } },
      },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.card",
      schema: {
        attributes: {
          title: { type: "string" },
          button: { type: "component", component: "atoms.button", repeatable: false },
        },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, DEPTH_VIOLATION);
    const flat = result.strategies.find((s) => s.name === "flat")!;
    assert.equal(flat.available, true);
    assert.ok(flat.schema);
    assert.equal(flat.schema.attributes.button_label.type, "string");
    assert.equal(flat.schema.attributes.button, undefined);
  });

  test("flat unavailable when parent attr is repeatable", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.cards",
      schema: {
        attributes: {
          button: { type: "component", component: "atoms.button", repeatable: true },
        },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, DEPTH_VIOLATION);
    const flat = result.strategies.find((s) => s.name === "flat")!;
    assert.equal(flat.available, false);
    assert.match(flat.unavailable_reason!, /repeatable/);
  });
});

describe("proposeSchemaStrategies — modular strategy", () => {
  test("always available; emits schema sin nested attr + wiring_instructions", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.card",
      schema: {
        attributes: {
          title: { type: "string" },
          button: { type: "component", component: "atoms.button", repeatable: false },
        },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, DEPTH_VIOLATION);
    const modular = result.strategies.find((s) => s.name === "modular")!;
    assert.equal(modular.available, true);
    assert.equal(modular.schema.attributes.title?.type, "string");
    assert.equal(modular.schema.attributes.button, undefined, "modular schema removes nested ref");
    assert.ok(modular.wiring_instructions);
    assert.match(modular.wiring_instructions!, /atoms\.button/);
    assert.match(modular.wiring_instructions!, /"component": "atoms\.button"/);
  });

  test("respects parent's repeatable flag in wiring snippet", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.card",
      schema: {
        attributes: {
          buttons: { type: "component", component: "atoms.button", repeatable: true },
        },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, {
      ...DEPTH_VIOLATION,
      path: "attributes.buttons.component → atoms.button.attributes.icon",
    });
    const modular = result.strategies.find((s) => s.name === "modular")!;
    assert.match(modular.wiring_instructions!, /"repeatable": true/);
  });
});

describe("proposeSchemaStrategies — dynamiczone strategy", () => {
  test("never available for component proposals (only CTs can host dynzones)", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.card",
      schema: {
        attributes: { button: { type: "component", component: "atoms.button", repeatable: false } },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, DEPTH_VIOLATION);
    const dz = result.strategies.find((s) => s.name === "dynamiczone")!;
    assert.equal(dz.available, false);
    assert.match(dz.unavailable_reason!, /content-types?/i);
  });
});

describe("proposeSchemaStrategies — as-proposed strategy (escape hatch)", () => {
  test("always available; schema is the unchanged proposal", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.card",
      schema: {
        collectionName: "components_molecules_cards",
        info: { displayName: "Card" },
        attributes: {
          title: { type: "string" },
          button: { type: "component", component: "atoms.button", repeatable: false },
        },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, DEPTH_VIOLATION);
    const asProposed = result.strategies.find((s) => s.name === "as-proposed")!;
    assert.equal(asProposed.available, true);
    assert.deepEqual(asProposed.schema, proposal.schema, "schema debe ser igual al original, no transformado");
    assert.ok(asProposed.trade_offs.some((t) => /editabilidad UI/i.test(t)));
    assert.ok(asProposed.trade_offs.some((t) => /Content-Type Builder/i.test(t)));
  });

  test("works even when parent attr is repeatable (escape hatch funciona en todos los casos)", () => {
    const strapi = makeMockStrapi({
      components: { "atoms.button": { attributes: { label: { type: "string" } } } },
    });
    const proposal: any = {
      kind: "component",
      uid: "molecules.cards",
      schema: {
        attributes: {
          buttons: { type: "component", component: "atoms.button", repeatable: true },
        },
      },
    };
    const result = proposeSchemaStrategies(strapi as any, proposal, {
      ...DEPTH_VIOLATION,
      path: "attributes.buttons.component → atoms.button.attributes.icon",
    });
    const asProposed = result.strategies.find((s) => s.name === "as-proposed")!;
    assert.equal(asProposed.available, true, "as-proposed siempre disponible, repeatable o no");
  });
});

describe("proposeSchemaStrategies — defensive", () => {
  test("returns fallback when violation path can't be parsed", () => {
    const strapi = makeMockStrapi();
    const proposal: any = {
      kind: "component",
      uid: "molecules.x",
      schema: { attributes: {} },
    };
    const malformed = { ...DEPTH_VIOLATION, path: "garbage" };
    const result = proposeSchemaStrategies(strapi as any, proposal, malformed);
    assert.equal(result.strategies.length, 1);
    assert.equal(result.strategies[0].name, "modular");
  });
});
