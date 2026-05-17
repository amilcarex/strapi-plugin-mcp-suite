"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAttribute = formatAttribute;
exports.deriveAttributes = deriveAttributes;
exports.deriveComponentFields = deriveComponentFields;
exports.deriveContentTypeFields = deriveContentTypeFields;
exports.getDynamicZoneUids = getDynamicZoneUids;
function suffix(attr) {
    const parts = [];
    if (attr.required)
        parts.push("required");
    if (attr.unique)
        parts.push("unique");
    if (attr.default !== undefined)
        parts.push(`default: ${JSON.stringify(attr.default)}`);
    if (attr.min !== undefined)
        parts.push(`min: ${attr.min}`);
    if (attr.max !== undefined)
        parts.push(`max: ${attr.max}`);
    if (attr.minLength !== undefined)
        parts.push(`minLength: ${attr.minLength}`);
    if (attr.maxLength !== undefined)
        parts.push(`maxLength: ${attr.maxLength}`);
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
function formatAttribute(attr) {
    var _a;
    switch (attr === null || attr === void 0 ? void 0 : attr.type) {
        case "string":
        case "text":
        case "email":
        case "password":
            return `string${suffix(attr)}`;
        case "richtext":
            return `RichText (HTML)${suffix(attr)}`;
        case "blocks":
            return `Blocks (rich text estructurado)${suffix(attr)}`;
        case "integer":
        case "biginteger":
            return `integer${suffix(attr)}`;
        case "float":
        case "decimal":
            return `number${suffix(attr)}`;
        case "boolean":
            return `boolean${suffix(attr)}`;
        case "date":
        case "time":
        case "datetime":
        case "timestamp":
            return `${attr.type}${suffix(attr)}`;
        case "json":
            return "JSON (objeto/array libre)";
        case "enumeration": {
            const enums = (attr.enum || []).map((v) => `'${v}'`).join("|");
            return `${enums}${suffix(attr)}`;
        }
        case "uid": {
            const target = attr.targetField ? ` derivado de "${attr.targetField}"` : "";
            return `string (uid${target})${suffix(attr)}`;
        }
        case "media":
            return `media${attr.multiple ? "[]" : ""}${attr.required ? " (required)" : ""}`;
        case "component":
            return `${attr.component}${attr.repeatable ? "[]" : ""}${attr.required ? " (required)" : ""}`;
        case "dynamiczone": {
            const allowed = (attr.components || []).join(" | ");
            return `dynamiczone[ ${allowed} ]`;
        }
        case "relation":
            return `relation:${attr.relation} → ${attr.target}${attr.inversedBy ? ` (inversedBy: ${attr.inversedBy})` : ""}${attr.mappedBy ? ` (mappedBy: ${attr.mappedBy})` : ""}`;
        default:
            return (_a = attr === null || attr === void 0 ? void 0 : attr.type) !== null && _a !== void 0 ? _a : "unknown";
    }
}
function deriveAttributes(attrs) {
    const result = {};
    for (const [name, attr] of Object.entries(attrs !== null && attrs !== void 0 ? attrs : {})) {
        result[name] = formatAttribute(attr);
    }
    return result;
}
function deriveComponentFields(strapi, uid) {
    var _a, _b, _c, _d;
    const comp = (_a = strapi.components) === null || _a === void 0 ? void 0 : _a[uid];
    if (!comp)
        return null;
    const defaultName = (_c = (_b = comp.attributes) === null || _b === void 0 ? void 0 : _b.name) === null || _c === void 0 ? void 0 : _c.default;
    return {
        description: ((_d = comp.info) === null || _d === void 0 ? void 0 : _d.description) || "",
        defaultName,
        fields: deriveAttributes(comp.attributes),
    };
}
function deriveContentTypeFields(strapi, uid) {
    var _a, _b, _c;
    const ct = (_a = strapi.contentTypes) === null || _a === void 0 ? void 0 : _a[uid];
    if (!ct)
        return null;
    return {
        description: ((_b = ct.info) === null || _b === void 0 ? void 0 : _b.description) || "",
        kind: (_c = ct.kind) !== null && _c !== void 0 ? _c : "collectionType",
        fields: deriveAttributes(ct.attributes),
    };
}
/**
 * Para cualquier content-type con un dynamic zone attribute dado, devuelve los
 * UIDs de los components permitidos. Útil para discovery genérico.
 */
function getDynamicZoneUids(strapi, contentTypeUid, attributeName) {
    var _a, _b;
    const ct = (_a = strapi.contentTypes) === null || _a === void 0 ? void 0 : _a[contentTypeUid];
    const attr = (_b = ct === null || ct === void 0 ? void 0 : ct.attributes) === null || _b === void 0 ? void 0 : _b[attributeName];
    if ((attr === null || attr === void 0 ? void 0 : attr.type) !== "dynamiczone")
        return [];
    return [...(attr.components || [])];
}
