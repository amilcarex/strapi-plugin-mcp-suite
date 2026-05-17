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
const validator_1 = require("../services/schema-authoring/validator");
const _helpers_1 = require("./_helpers");
const strapiEmpty = (0, _helpers_1.makeMockStrapi)();
(0, node_test_1.describe)("validator-schema — happy path", () => {
    (0, node_test_1.test)("component plano válido pasa", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
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
        }, "create");
        assert.equal(r.valid, true);
        assert.equal(r.violations.length, 0);
    });
    (0, node_test_1.test)("content-type válido pasa", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
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
        }, "create");
        assert.equal(r.valid, true);
    });
});
(0, node_test_1.describe)("validator-schema — RESERVED_ATTRIBUTE_NAME", () => {
    const reserved = ["id", "documentId", "createdAt", "updatedAt", "publishedAt", "createdBy", "updatedBy", "locale", "localizations"];
    for (const name of reserved) {
        (0, node_test_1.test)(`rechaza atributo reservado "${name}"`, () => {
            const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
                uid: "shared.x",
                kind: "component",
                schema: { info: { displayName: "X" }, attributes: { [name]: { type: "string" } } },
            }, "create");
            assert.equal(r.valid, false);
            assert.ok(r.violations.some((v) => v.code === "RESERVED_ATTRIBUTE_NAME"));
        });
    }
});
(0, node_test_1.describe)("validator-schema — MISSING_REQUIRED_PROP", () => {
    (0, node_test_1.test)("relation sin target", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "api::demo.demo",
            kind: "content-type",
            schema: {
                info: { singularName: "demo", pluralName: "demos", displayName: "Demo" },
                attributes: { thing: { type: "relation", relation: "oneToMany" } },
            },
        }, "create");
        assert.equal(r.valid, false);
        assert.ok(r.violations.some((v) => v.code === "MISSING_REQUIRED_PROP"));
    });
    (0, node_test_1.test)("enumeration sin enum array", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "shared.x",
            kind: "component",
            schema: {
                info: { displayName: "X" },
                attributes: { status: { type: "enumeration" } },
            },
        }, "create");
        assert.equal(r.valid, false);
        assert.ok(r.violations.some((v) => v.code === "MISSING_REQUIRED_PROP"));
    });
    (0, node_test_1.test)("enumeration con enum vacío", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "shared.x",
            kind: "component",
            schema: {
                info: { displayName: "X" },
                attributes: { status: { type: "enumeration", enum: [] } },
            },
        }, "create");
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("dynamiczone sin components", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "api::page.page",
            kind: "content-type",
            schema: {
                info: { singularName: "page", pluralName: "pages", displayName: "Page" },
                attributes: { blocks: { type: "dynamiczone", components: [] } },
            },
        }, "create");
        assert.equal(r.valid, false);
    });
});
(0, node_test_1.describe)("validator-schema — INVALID_NAME", () => {
    (0, node_test_1.test)("rechaza singularName con mayúscula", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "api::Product.Product",
            kind: "content-type",
            schema: {
                info: { singularName: "Product", pluralName: "Products", displayName: "Product" },
                attributes: {},
            },
        }, "create");
        assert.equal(r.valid, false);
    });
    (0, node_test_1.test)("rechaza component category con caracter raro", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "BAD!CAT.x",
            kind: "component",
            schema: { info: { displayName: "X" }, attributes: {} },
        }, "create");
        assert.equal(r.valid, false);
    });
});
(0, node_test_1.describe)("validator-schema — UNKNOWN_REFERENCE", () => {
    (0, node_test_1.test)("component que referencia componente inexistente", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "shared.card",
            kind: "component",
            schema: {
                info: { displayName: "Card" },
                attributes: {
                    inner: { type: "component", component: "atoms.does-not-exist", repeatable: false },
                },
            },
        }, "create");
        assert.equal(r.valid, false);
        assert.ok(r.violations.some((v) => v.code === "UNKNOWN_REFERENCE"));
    });
    (0, node_test_1.test)("relation que apunta a CT inexistente", () => {
        const r = (0, validator_1.validateSchemaProposal)(strapiEmpty, {
            uid: "api::demo.demo",
            kind: "content-type",
            schema: {
                info: { singularName: "demo", pluralName: "demos", displayName: "Demo" },
                attributes: {
                    author: { type: "relation", relation: "manyToOne", target: "api::ghost.ghost" },
                },
            },
        }, "create");
        assert.equal(r.valid, false);
        assert.ok(r.violations.some((v) => v.code === "UNKNOWN_REFERENCE"));
    });
});
(0, node_test_1.describe)("validator-schema — NESTED_COMPONENT_DEPTH_EXCEEDED", () => {
    (0, node_test_1.test)("rechaza component que anida a otro que ya tiene component (> 1 nivel)", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
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
        const r = (0, validator_1.validateSchemaProposal)(strapi, {
            uid: "molecules.card",
            kind: "component",
            schema: {
                info: { displayName: "Card" },
                attributes: {
                    content: { type: "component", component: "atoms.deep", repeatable: false },
                },
            },
        }, "create");
        assert.equal(r.valid, false);
        assert.ok(r.violations.some((v) => v.code === "NESTED_COMPONENT_DEPTH_EXCEEDED"));
    });
    (0, node_test_1.test)("permite 1 nivel de anidamiento (component → component plano)", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            components: {
                "atoms.button": {
                    info: { displayName: "Button" },
                    attributes: { label: { type: "string" } },
                },
            },
        });
        const r = (0, validator_1.validateSchemaProposal)(strapi, {
            uid: "molecules.cta",
            kind: "component",
            schema: {
                info: { displayName: "CTA" },
                attributes: {
                    button: { type: "component", component: "atoms.button", repeatable: false },
                },
            },
        }, "create");
        assert.equal(r.valid, true);
    });
});
(0, node_test_1.describe)("validator-schema — COLLISION_COLLECTION_NAME", () => {
    (0, node_test_1.test)("rechaza si collectionName ya existe", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            contentTypes: {
                "api::existing.existing": {
                    collectionName: "products",
                    info: { singularName: "existing", pluralName: "existings", displayName: "Existing" },
                    attributes: {},
                },
            },
        });
        const r = (0, validator_1.validateSchemaProposal)(strapi, {
            uid: "api::new-thing.new-thing",
            kind: "content-type",
            schema: {
                collectionName: "products",
                info: { singularName: "new-thing", pluralName: "new-things", displayName: "New Thing" },
                attributes: {},
            },
        }, "create");
        assert.equal(r.valid, false);
        assert.ok(r.violations.some((v) => v.code === "COLLISION_COLLECTION_NAME"));
    });
});
(0, node_test_1.describe)("validator-schema — ENUM_VALUE_INVALID_GRAPHQL_NAME (warning, solo si graphql installed)", () => {
    (0, node_test_1.test)("no warning si graphql plugin NO instalado", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)(); // sin graphqlPlugin
        const r = (0, validator_1.validateSchemaProposal)(strapi, {
            uid: "shared.x",
            kind: "component",
            schema: {
                info: { displayName: "X" },
                attributes: { cols: { type: "enumeration", enum: ["1", "2", "3"] } },
            },
        }, "create");
        assert.equal(r.valid, true);
        assert.equal(r.warnings.length, 0);
    });
    (0, node_test_1.test)("warning si graphql plugin INSTALADO + enum empieza con número", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            graphqlPlugin: { service: () => null },
        });
        const r = (0, validator_1.validateSchemaProposal)(strapi, {
            uid: "shared.x",
            kind: "component",
            schema: {
                info: { displayName: "X" },
                attributes: { cols: { type: "enumeration", enum: ["1col", "2col", "3col"] } },
            },
        }, "create");
        assert.equal(r.valid, true);
        assert.ok(r.warnings.some((w) => w.code === "ENUM_VALUE_INVALID_GRAPHQL_NAME"));
    });
    (0, node_test_1.test)("sin warning si enum values son válidos GraphQL", () => {
        const strapi = (0, _helpers_1.makeMockStrapi)({
            graphqlPlugin: { service: () => null },
        });
        const r = (0, validator_1.validateSchemaProposal)(strapi, {
            uid: "shared.x",
            kind: "component",
            schema: {
                info: { displayName: "X" },
                attributes: { cols: { type: "enumeration", enum: ["one", "two", "three"] } },
            },
        }, "create");
        assert.equal(r.warnings.length, 0);
    });
});
