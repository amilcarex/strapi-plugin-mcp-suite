import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { suggestReusableAtoms } from "../services/atoms/suggest-atoms";
import { makeMockStrapi } from "./_helpers";

describe("suggestReusableAtoms — detection", () => {
  test("detecta un campo escalar repetido sobre el umbral", () => {
    const strapi = makeMockStrapi({
      components: {
        "sections.a": { attributes: { title: { type: "string" } } },
        "sections.b": { attributes: { title: { type: "string" } } },
        "sections.c": { attributes: { title: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const titleCand = r.candidates.find((c) => c.field_name === "title");
    assert.ok(titleCand, "title debe ser candidato");
    assert.equal(titleCand!.occurrences, 3);
    assert.equal(titleCand!.recommendation, "promote");
    assert.deepEqual(titleCand!.used_in, ["sections.a", "sections.b", "sections.c"]);
  });

  test("ignora patrones bajo el umbral", () => {
    const strapi = makeMockStrapi({
      components: {
        "sections.a": { attributes: { rare: { type: "string" } } },
        "sections.b": { attributes: { rare: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    assert.equal(r.candidates.find((c) => c.field_name === "rare"), undefined);
  });

  test("min_occurrences se clampa a mínimo 2", () => {
    const strapi = makeMockStrapi({
      components: {
        "sections.a": { attributes: { x: { type: "string" } } },
        "sections.b": { attributes: { x: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 1 });
    assert.equal(r.min_occurrences, 2);
    assert.ok(r.candidates.find((c) => c.field_name === "x"));
  });

  test("campos del sistema (createdAt, id, etc.) se ignoran", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { createdAt: { type: "datetime" }, documentId: { type: "uid" } } },
        "a.b": { attributes: { createdAt: { type: "datetime" }, documentId: { type: "uid" } } },
        "a.c": { attributes: { createdAt: { type: "datetime" }, documentId: { type: "uid" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    assert.equal(r.candidates.length, 0);
  });
});

describe("suggestReusableAtoms — recommendation tiers", () => {
  test("campo component repetido → already_component (informativo, sin plan)", () => {
    const strapi = makeMockStrapi({
      components: {
        "sections.a": { attributes: { ctas: { type: "component", component: "atoms.button" } } },
        "sections.b": { attributes: { ctas: { type: "component", component: "atoms.button" } } },
        "sections.c": { attributes: { ctas: { type: "component", component: "atoms.button" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const cand = r.candidates.find((c) => c.field_name === "ctas");
    assert.equal(cand!.recommendation, "already_component");
    assert.equal(cand!.execution_plan, undefined);
  });

  test("campo no-textual repetido (boolean) → review, sin plan", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { highlighted: { type: "boolean" } } },
        "a.b": { attributes: { highlighted: { type: "boolean" } } },
        "a.c": { attributes: { highlighted: { type: "boolean" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const cand = r.candidates.find((c) => c.field_name === "highlighted");
    assert.equal(cand!.recommendation, "review");
    assert.equal(cand!.execution_plan, undefined);
  });

  test("string/text/richtext son promotables", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { body: { type: "richtext" } } },
        "a.b": { attributes: { body: { type: "richtext" } } },
        "a.c": { attributes: { body: { type: "richtext" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    assert.equal(r.candidates.find((c) => c.field_name === "body")!.recommendation, "promote");
  });
});

describe("suggestReusableAtoms — execution plan", () => {
  test("plan: create_component (step 1) + 1 modify_schema por consumidor", () => {
    const strapi = makeMockStrapi({
      components: {
        "sections.a": { attributes: { title: { type: "string" } } },
        "sections.b": { attributes: { title: { type: "string" } } },
        "sections.c": { attributes: { title: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const plan = r.candidates.find((c) => c.field_name === "title")!.execution_plan!;
    assert.equal(plan.length, 4, "1 create + 3 modify");
    assert.equal(plan[0].tool, "create_component");
    assert.equal(plan[1].tool, "modify_schema");
    assert.deepEqual(plan[1].args.remove, ["title"]);
    assert.equal(plan[1].args.add[0].field.type, "component");
  });

  test("campo conocido (title) usa el enrichment atoms.heading", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { title: { type: "string" } } },
        "a.b": { attributes: { title: { type: "string" } } },
        "a.c": { attributes: { title: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const cand = r.candidates.find((c) => c.field_name === "title")!;
    assert.equal(cand.suggested_atom!.uid, "atoms.heading");
    assert.ok(cand.suggested_atom!.schema.attributes.tag, "heading tiene tag enum");
  });

  test("campo desconocido usa atom minimal atoms.<fieldName>", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { tagline: { type: "string" } } },
        "a.b": { attributes: { tagline: { type: "string" } } },
        "a.c": { attributes: { tagline: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const cand = r.candidates.find((c) => c.field_name === "tagline")!;
    assert.equal(cand.suggested_atom!.uid, "atoms.tagline");
    assert.ok(cand.suggested_atom!.schema.attributes.value, "atom minimal tiene campo 'value'");
  });

  test("data_migration_note presente en todo candidato 'promote'", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { title: { type: "string" } } },
        "a.b": { attributes: { title: { type: "string" } } },
        "a.c": { attributes: { title: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    assert.ok(r.candidates[0].data_migration_note);
  });
});

describe("suggestReusableAtoms — depth warnings", () => {
  test("consumidor que está anidado en otro component → depth_warning", () => {
    const strapi = makeMockStrapi({
      components: {
        // molecules.card está anidado dentro de sections.grid
        "sections.grid": {
          attributes: { card: { type: "component", component: "molecules.card" } },
        },
        // 3 molecules con 'label' escalar repetido — uno de ellos (card) está anidado
        "molecules.card": { attributes: { label: { type: "string" } } },
        "molecules.tile": { attributes: { label: { type: "string" } } },
        "molecules.chip": { attributes: { label: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    const cand = r.candidates.find((c) => c.field_name === "label")!;
    assert.equal(cand.recommendation, "promote");
    assert.ok(cand.depth_warnings, "debe tener depth_warnings");
    assert.ok(
      cand.depth_warnings!.some((w) => w.includes("molecules.card")),
      "el warning menciona el component anidado"
    );
  });
});

describe("suggestReusableAtoms — scope + ordering", () => {
  test("scope 'components' excluye content-types", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { shared: { type: "string" } } },
        "a.b": { attributes: { shared: { type: "string" } } },
      },
      contentTypes: {
        "api::x.x": { attributes: { shared: { type: "string" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { scope: "components", minOccurrences: 2 });
    const cand = r.candidates.find((c) => c.field_name === "shared")!;
    assert.equal(cand.occurrences, 2, "solo cuenta los 2 components, no el CT");
  });

  test("candidatos 'promote' ordenados antes que 'review'", () => {
    const strapi = makeMockStrapi({
      components: {
        "a.a": { attributes: { title: { type: "string" }, flag: { type: "boolean" } } },
        "a.b": { attributes: { title: { type: "string" }, flag: { type: "boolean" } } },
        "a.c": { attributes: { title: { type: "string" }, flag: { type: "boolean" } } },
      },
    });
    const r = suggestReusableAtoms(strapi as any, { minOccurrences: 3 });
    assert.equal(r.candidates[0].recommendation, "promote");
  });
});
