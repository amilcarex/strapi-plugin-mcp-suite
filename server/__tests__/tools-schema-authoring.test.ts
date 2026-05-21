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

// ── modify_schema (batch remove + add + update, v0.6.0) ───────────────────────

describe("modify_schema — pre-flight conflict detection (no fs)", () => {
  test("todas las listas vacías → error", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler({ strapi: strapi as any }, { uid: "molecules.x" } as any),
      /al menos una operaci/i
    );
  });

  test("duplicado en remove[] → error", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        { uid: "molecules.x", remove: ["a", "b", "a"] } as any
      ),
      /"a" duplicado en remove/i
    );
  });

  test("duplicado en add[] → error", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        {
          uid: "molecules.x",
          add: [
            { field_name: "f", field: { type: "string" } },
            { field_name: "f", field: { type: "text" } },
          ],
        } as any
      ),
      /"f" duplicado en add/i
    );
  });

  test("campo en remove[] y add[] a la vez → error (sugiere update)", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        {
          uid: "molecules.x",
          remove: ["title"],
          add: [{ field_name: "title", field: { type: "string" } }],
        } as any
      ),
      /remove\[\] y add\[\] a la vez.*update/i
    );
  });

  test("campo en remove[] y update[] a la vez → error", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        {
          uid: "molecules.x",
          remove: ["title"],
          update: [{ field_name: "title", field: { type: "string" } }],
        } as any
      ),
      /remove\[\] y update\[\] a la vez/i
    );
  });

  test("campo en add[] y update[] a la vez → error", async () => {
    const strapi = makeMockStrapi();
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapi as any },
        {
          uid: "molecules.x",
          add: [{ field_name: "title", field: { type: "string" } }],
          update: [{ field_name: "title", field: { type: "text" } }],
        } as any
      ),
      /add\[\] y update\[\] a la vez/i
    );
  });
});

describe("modify_schema — fs-backed operations", () => {
  // Fixture: a real component schema file the tool will read + rewrite.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const fixtureDir = path.join(process.cwd(), "src", "components", "molecules");
  const fixturePath = path.join(fixtureDir, "zz-modify-test.json");
  const backupsDir = path.join(process.cwd(), ".strapi-mcp-backups");

  const baseSchema = {
    collectionName: "components_molecules_zz_modify_tests",
    info: { displayName: "ZZ Modify Test" },
    attributes: {
      title: { type: "string", required: true },
      legacy: { type: "text" },
      count: { type: "integer" },
    },
  };

  beforeEach(() => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(baseSchema, null, 2) + "\n");
  });
  afterEach(() => {
    try { fs.rmSync(fixturePath, { force: true }); } catch {}
    try { fs.rmSync(backupsDir, { recursive: true, force: true }); } catch {}
  });

  function strapiForFixture() {
    return makeMockStrapi({
      components: { "molecules.zz-modify-test": { attributes: baseSchema.attributes } },
    });
  }

  test("remove + add + update combinados en 1 escritura", async () => {
    const tool = getTool("modify_schema");
    const result: any = await tool.handler(
      { strapi: strapiForFixture() as any },
      {
        uid: "molecules.zz-modify-test",
        remove: ["legacy"],
        update: [{ field_name: "count", field: { type: "biginteger" } }],
        add: [{ field_name: "slug", field: { type: "uid", targetField: "title" } }],
      } as any
    );
    assert.equal(result.success, true);
    assert.deepEqual(result.operations, { removed: ["legacy"], updated: ["count"], added: ["slug"] });

    const written = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.equal(written.attributes.legacy, undefined, "legacy eliminado");
    assert.equal(written.attributes.count.type, "biginteger", "count actualizado");
    assert.equal(written.attributes.slug.type, "uid", "slug agregado");
    assert.equal(written.attributes.title.type, "string", "title intacto");
  });

  test("update cambia el type de un campo existente (text → string)", async () => {
    const tool = getTool("modify_schema");
    const result: any = await tool.handler(
      { strapi: strapiForFixture() as any },
      {
        uid: "molecules.zz-modify-test",
        update: [{ field_name: "legacy", field: { type: "string" } }],
      } as any
    );
    assert.equal(result.success, true);
    const written = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.equal(written.attributes.legacy.type, "string");
  });

  test("remove de campo inexistente → error, no escribe", async () => {
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapiForFixture() as any },
        { uid: "molecules.zz-modify-test", remove: ["ghost"] } as any
      ),
      /"ghost" no existe/i
    );
    const untouched = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.ok(untouched.attributes.title, "schema sin cambios");
  });

  test("add de campo que ya existe → error", async () => {
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapiForFixture() as any },
        {
          uid: "molecules.zz-modify-test",
          add: [{ field_name: "title", field: { type: "string" } }],
        } as any
      ),
      /"title" ya existe/i
    );
  });

  test("update de campo inexistente → error", async () => {
    const tool = getTool("modify_schema");
    await assert.rejects(
      tool.handler(
        { strapi: strapiForFixture() as any },
        {
          uid: "molecules.zz-modify-test",
          update: [{ field_name: "ghost", field: { type: "string" } }],
        } as any
      ),
      /"ghost" no existe/i
    );
  });

  test("remove + add del MISMO nombre vía 2 ops separadas funciona (recrear campo)", async () => {
    // remove 'legacy' y add 'legacy' nuevo con otro type — permitido porque
    // el add chequea "existe Y no está en remove".
    const tool = getTool("modify_schema");
    const result: any = await tool.handler(
      { strapi: strapiForFixture() as any },
      {
        uid: "molecules.zz-modify-test",
        remove: ["legacy"],
        add: [{ field_name: "legacy_v2", field: { type: "string" } }],
      } as any
    );
    assert.equal(result.success, true);
    const written = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.equal(written.attributes.legacy, undefined);
    assert.equal(written.attributes.legacy_v2.type, "string");
  });

  test("dry_run no escribe pero devuelve operations + files_to_write", async () => {
    const tool = getTool("modify_schema");
    const result: any = await tool.handler(
      { strapi: strapiForFixture() as any },
      {
        uid: "molecules.zz-modify-test",
        remove: ["count"],
        dry_run: true,
      } as any
    );
    assert.equal(result.dry_run, true);
    assert.ok(result.files_to_write);
    assert.deepEqual(result.operations.removed, ["count"]);
    // El archivo en disco NO debe haber cambiado.
    const onDisk = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.ok(onDisk.attributes.count, "count sigue en disco (dry_run)");
  });
});
