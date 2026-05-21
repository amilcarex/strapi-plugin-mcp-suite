import { test, describe, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import { schemaAuthoringTools } from "../services/tools/schema-authoring";
import { makeMockStrapi } from "./_helpers";

function getTool(name: string) {
  const t = schemaAuthoringTools.find((tool) => tool.name === name);
  if (!t) throw new Error(`Tool ${name} not in schemaAuthoringTools`);
  return t;
}

// NODE_ENV must be development (or test) so writer doesn't refuse.
const savedNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "development";
});
afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe("create_component — strategy resolution flow", () => {
  function strapiWithNestedComponent() {
    // atoms.button itself has a nested component → atoms.icon
    // So any new component referencing atoms.button triggers
    // NESTED_COMPONENT_DEPTH_EXCEEDED.
    return makeMockStrapi({
      components: {
        "atoms.icon": { attributes: { name: { type: "string" } } },
        "atoms.button": {
          attributes: {
            label: { type: "string" },
            url: { type: "string" },
            icon: { type: "component", component: "atoms.icon", repeatable: false },
          },
        },
      },
    });
  }

  test("propuesta con depth>1 sin strategy → respuesta con strategies, NO escribe", async () => {
    const strapi = strapiWithNestedComponent();
    const tool = getTool("create_component");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "molecules",
        name: "card-with-button",
        schema: {
          collectionName: "components_molecules_card_with_buttons",
          info: { displayName: "Card with button" },
          attributes: {
            title: { type: "string" },
            button: { type: "component", component: "atoms.button", repeatable: false },
          },
        },
        dry_run: false,
      } as any
    );

    assert.equal(result.success, false);
    assert.ok(result.strategies, "respuesta debe incluir strategies");
    assert.equal(result.strategies.length, 4);
    const names = result.strategies.map((s: any) => s.name);
    assert.deepEqual(names, ["flat", "modular", "dynamiczone", "as-proposed"]);
    assert.match(result.hint, /strategy/i);
    assert.equal(result.restart_required, false);
  });

  test("propuesta con depth>1 + strategy:'flat' → escribe el flat", async () => {
    const strapi = strapiWithNestedComponent();
    const tool = getTool("create_component");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "molecules",
        name: "card-with-button",
        schema: {
          collectionName: "components_molecules_card_with_buttons",
          info: { displayName: "Card" },
          attributes: {
            title: { type: "string" },
            button: { type: "component", component: "atoms.button", repeatable: false },
          },
        },
        strategy: "flat",
        dry_run: true,
      } as any
    );

    // dry_run avoids touching disk; we just want to confirm the flat schema
    // would have been written.
    assert.equal(result.dry_run, true);
    assert.ok(result.files_to_write);
    const fileContent = JSON.parse(result.files_to_write[0].content);
    assert.equal(fileContent.attributes.button, undefined, "nested attr removed");
    assert.equal(fileContent.attributes.button_label.type, "string");
    assert.equal(fileContent.attributes.button_url.type, "string");
    assert.ok(result.strategy_applied);
    assert.equal(result.strategy_applied.name, "flat");
  });

  test("propuesta con depth>1 + strategy:'modular' + parent repeatable=true → escribe parent sin nested attr + wiring_instructions", async () => {
    const strapi = strapiWithNestedComponent();
    const tool = getTool("create_component");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "molecules",
        name: "card-list",
        schema: {
          collectionName: "components_molecules_card_lists",
          info: { displayName: "Card list" },
          attributes: {
            title: { type: "string" },
            buttons: { type: "component", component: "atoms.button", repeatable: true },
          },
        },
        strategy: "modular",
        dry_run: true,
      } as any
    );

    assert.equal(result.dry_run, true);
    const fileContent = JSON.parse(result.files_to_write[0].content);
    assert.equal(fileContent.attributes.title?.type, "string");
    assert.equal(fileContent.attributes.buttons, undefined);
    assert.ok(result.strategy_applied);
    assert.equal(result.strategy_applied.name, "modular");
    assert.ok(result.strategy_applied.wiring_instructions);
    assert.match(result.strategy_applied.wiring_instructions, /atoms\.button/);
    assert.match(result.strategy_applied.wiring_instructions, /repeatable.*true/);
  });

  test("propuesta con depth>1 + strategy:'flat' + parent repeatable → error claro", async () => {
    const strapi = strapiWithNestedComponent();
    const tool = getTool("create_component");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "molecules",
        name: "card-list",
        schema: {
          collectionName: "components_molecules_card_lists",
          info: { displayName: "Card list" },
          attributes: {
            buttons: { type: "component", component: "atoms.button", repeatable: true },
          },
        },
        strategy: "flat",
      } as any
    );

    assert.equal(result.success, false);
    assert.match(result.error, /flat.*no se pudo aplicar/i);
    assert.match(result.error, /repeatable/i);
  });

  test("propuesta con depth>1 + strategy:'as-proposed' → escribe el schema sin modificar", async () => {
    const strapi = strapiWithNestedComponent();
    const tool = getTool("create_component");
    const originalSchema = {
      collectionName: "components_molecules_card_with_buttons",
      info: { displayName: "Card with button" },
      attributes: {
        title: { type: "string" },
        button: { type: "component", component: "atoms.button", repeatable: false },
      },
    };
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "molecules",
        name: "card-with-button",
        schema: originalSchema,
        strategy: "as-proposed",
        dry_run: true,
      } as any
    );

    assert.equal(result.dry_run, true);
    assert.ok(result.files_to_write);
    const fileContent = JSON.parse(result.files_to_write[0].content);
    // El schema debe preservar la profundidad original (button como component, NO inlineado)
    assert.deepEqual(fileContent.attributes.button, originalSchema.attributes.button);
    assert.equal(fileContent.attributes.button_label, undefined, "NO debe haber prefijado nada");
    assert.ok(result.strategy_applied);
    assert.equal(result.strategy_applied.name, "as-proposed");
  });

  test("propuesta con depth>1 + strategy:'dynamiczone' → error porque no aplica a components", async () => {
    const strapi = strapiWithNestedComponent();
    const tool = getTool("create_component");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "molecules",
        name: "card",
        schema: {
          collectionName: "components_molecules_cards",
          info: { displayName: "Card" },
          attributes: {
            button: { type: "component", component: "atoms.button", repeatable: false },
          },
        },
        strategy: "dynamiczone",
      } as any
    );

    assert.equal(result.success, false);
    assert.match(result.error, /content-types?/i);
  });

  test("propuesta válida (depth=1) sin strategy → escribe normal, sin strategies en response", async () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.icon": { attributes: { name: { type: "string" } } },
      },
    });
    const tool = getTool("create_component");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        category: "atoms",
        name: "labeled-icon",
        schema: {
          collectionName: "components_atoms_labeled_icons",
          info: { displayName: "Labeled icon" },
          attributes: {
            label: { type: "string" },
            icon: { type: "component", component: "atoms.icon", repeatable: false },
          },
        },
        dry_run: true,
      } as any
    );

    assert.equal(result.dry_run, true);
    assert.equal(result.strategies, undefined, "no strategies para propuestas válidas");
    assert.equal(result.strategy_applied, undefined);
    assert.ok(result.files_to_write);
  });
});

// ── add_fields_to_schema (batch, v0.5.0) ──────────────────────────────────────
//
// The batch tool reads the target schema.json from disk. Full integration tests
// would need to set up real fixture files under the plugin's working directory,
// which is messy. So here we cover the args-validation surface (duplicate
// detection runs BEFORE the fs read — it's a pre-flight pure check). End-to-end
// happy paths are covered by live E2E testing on Strapi + the live demo notes.

describe("add_fields_to_schema — pre-flight args validation", () => {
  test("duplicado de field_name dentro del batch → rechaza antes de tocar fs", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("add_fields_to_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        {
          uid: "api::x.x",
          fields: [
            { field_name: "subtitle", field: { type: "string" } },
            { field_name: "subtitle", field: { type: "text" } }, // duplicado
          ],
          dry_run: true,
        } as any
      ),
      /duplicado/i
    );
  });

  test("la tool existe y está expuesta en schemaAuthoringTools", () => {
    const tool = schemaAuthoringTools.find((t) => t.name === "add_fields_to_schema");
    assert.ok(tool, "add_fields_to_schema debería estar registrada");
    assert.ok(tool!.inputSchema.properties);
    const inputProps = tool!.inputSchema.properties as Record<string, any>;
    assert.ok(inputProps.fields, "inputSchema debe declarar fields[]");
    assert.equal(inputProps.fields.type, "array");
    assert.equal(inputProps.fields.minItems, 1);
  });
});

describe("propose_schema_strategy — read-only dry run", () => {
  test("propuesta con depth>1 → devuelve strategies", async () => {
    const strapi = makeMockStrapi({
      components: {
        "atoms.icon": { attributes: { name: { type: "string" } } },
        "atoms.button": {
          attributes: {
            label: { type: "string" },
            icon: { type: "component", component: "atoms.icon", repeatable: false },
          },
        },
      },
    });
    const tool = getTool("propose_schema_strategy");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        uid: "molecules.card",
        schema: {
          attributes: {
            button: { type: "component", component: "atoms.button", repeatable: false },
          },
        },
      } as any
    );

    assert.equal(result.valid, false);
    assert.ok(result.strategies);
    assert.equal(result.strategies.length, 4);
    assert.ok(result.notes.some((n: string) => /no escribe/i.test(n)));
  });

  test("propuesta válida → strategies vacío", async () => {
    const strapi = makeMockStrapi({
      components: { "atoms.icon": { attributes: { name: { type: "string" } } } },
    });
    const tool = getTool("propose_schema_strategy");
    const result: any = await tool.handler(
      { strapi: strapi as any },
      {
        uid: "atoms.labeled-icon",
        schema: {
          attributes: {
            label: { type: "string" },
            icon: { type: "component", component: "atoms.icon", repeatable: false },
          },
        },
      } as any
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.strategies, []);
  });
});
