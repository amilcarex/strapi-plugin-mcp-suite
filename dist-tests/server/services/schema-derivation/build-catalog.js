"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSchemaCatalog = buildSchemaCatalog;
const derive_1 = require("./derive");
function buildSchemaCatalog(strapi) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    const cts = (_a = strapi.contentTypes) !== null && _a !== void 0 ? _a : {};
    const comps = (_b = strapi.components) !== null && _b !== void 0 ? _b : {};
    const content_types = [];
    let internalCount = 0;
    for (const uid of Object.keys(cts)) {
        if (!uid.startsWith("api::")) {
            internalCount += 1;
            continue;
        }
        const ct = cts[uid];
        content_types.push({
            uid,
            kind: (_c = ct.kind) !== null && _c !== void 0 ? _c : "collectionType",
            displayName: (_e = (_d = ct.info) === null || _d === void 0 ? void 0 : _d.displayName) !== null && _e !== void 0 ? _e : uid,
            description: (_g = (_f = ct.info) === null || _f === void 0 ? void 0 : _f.description) !== null && _g !== void 0 ? _g : "",
            collectionName: (_h = ct.collectionName) !== null && _h !== void 0 ? _h : "",
            draftAndPublish: Boolean((_j = ct.options) === null || _j === void 0 ? void 0 : _j.draftAndPublish),
            i18n: Boolean((_l = (_k = ct.pluginOptions) === null || _k === void 0 ? void 0 : _k.i18n) === null || _l === void 0 ? void 0 : _l.localized),
            fields: (0, derive_1.deriveAttributes)((_m = ct.attributes) !== null && _m !== void 0 ? _m : {}),
        });
    }
    const components = [];
    for (const uid of Object.keys(comps)) {
        const comp = comps[uid];
        const [category] = uid.split(".");
        components.push({
            uid,
            category: category !== null && category !== void 0 ? category : "",
            displayName: (_p = (_o = comp.info) === null || _o === void 0 ? void 0 : _o.displayName) !== null && _p !== void 0 ? _p : uid,
            description: (_r = (_q = comp.info) === null || _q === void 0 ? void 0 : _q.description) !== null && _r !== void 0 ? _r : "",
            fields: (0, derive_1.deriveAttributes)((_s = comp.attributes) !== null && _s !== void 0 ? _s : {}),
        });
    }
    return {
        content_types: content_types.sort((a, b) => a.uid.localeCompare(b.uid)),
        components: components.sort((a, b) => a.uid.localeCompare(b.uid)),
        internal_content_types_count: internalCount,
    };
}
