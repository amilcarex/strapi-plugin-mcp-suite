"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateToolDefinition = validateToolDefinition;
exports.getToolExtensions = getToolExtensions;
const ajv_1 = __importDefault(require("ajv"));
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const NAME_MIN = 3;
const NAME_MAX = 64;
const DESC_MIN = 30;
// Ajv instance reutilizable. strict:false para que warnings de schema no aborten.
let ajvInstance = null;
function getAjv() {
    var _a;
    if (!ajvInstance) {
        const AjvCtor = (_a = ajv_1.default.default) !== null && _a !== void 0 ? _a : ajv_1.default;
        ajvInstance = new AjvCtor({ strict: false, allErrors: true });
    }
    return ajvInstance;
}
/**
 * Valida una ToolDefinition. NO toca el handler — solo metadata + inputSchema.
 *
 * @param tool        La definición a validar.
 * @param builtinNames Lista de nombres reservados (no se pueden overridear).
 */
function validateToolDefinition(tool, builtinNames) {
    var _a;
    const errors = [];
    // ── name ────────────────────────────────────────────────────────────────
    if (typeof (tool === null || tool === void 0 ? void 0 : tool.name) !== "string" || tool.name.length === 0) {
        errors.push({ field: "name", message: "Es requerido y debe ser string no vacío." });
    }
    else {
        if (tool.name.length < NAME_MIN) {
            errors.push({ field: "name", message: `Mínimo ${NAME_MIN} caracteres.` });
        }
        if (tool.name.length > NAME_MAX) {
            errors.push({ field: "name", message: `Máximo ${NAME_MAX} caracteres.` });
        }
        if (!NAME_PATTERN.test(tool.name)) {
            errors.push({
                field: "name",
                message: "Debe ser snake_case empezando con letra: ^[a-z][a-z0-9_]*$ (ej: 'my_custom_tool').",
            });
        }
        if (builtinNames.has(tool.name)) {
            errors.push({
                field: "name",
                message: `"${tool.name}" colisiona con una tool built-in del plugin. Elige otro nombre.`,
            });
        }
    }
    // ── description ─────────────────────────────────────────────────────────
    if (typeof (tool === null || tool === void 0 ? void 0 : tool.description) !== "string" || tool.description.length === 0) {
        errors.push({ field: "description", message: "Es requerido y debe ser string no vacío." });
    }
    else if (tool.description.length < DESC_MIN) {
        errors.push({
            field: "description",
            message: `Mínimo ${DESC_MIN} caracteres. El LLM usa esta descripción para decidir cuándo invocar la tool — sé específico sobre QUÉ hace y CUÁNDO usarla.`,
        });
    }
    // ── handler ─────────────────────────────────────────────────────────────
    if (typeof (tool === null || tool === void 0 ? void 0 : tool.handler) !== "function") {
        errors.push({ field: "handler", message: "Es requerido y debe ser una function (preferentemente async)." });
    }
    // ── inputSchema ─────────────────────────────────────────────────────────
    const schema = tool === null || tool === void 0 ? void 0 : tool.inputSchema;
    if (!schema || typeof schema !== "object") {
        errors.push({ field: "inputSchema", message: "Es requerido y debe ser un objeto JSON Schema." });
    }
    else {
        if (schema.type !== "object") {
            errors.push({
                field: "inputSchema.type",
                message: "Debe ser 'object' (el cliente MCP envía args como objeto).",
            });
        }
        if (schema.additionalProperties !== false) {
            errors.push({
                field: "inputSchema.additionalProperties",
                message: "Best practice: setear a false para que el LLM no inyecte campos no declarados (que el handler ignoraría silenciosamente).",
            });
        }
        if (schema.properties && typeof schema.properties !== "object") {
            errors.push({ field: "inputSchema.properties", message: "Debe ser un objeto (o ser omitido)." });
        }
        if (schema.required !== undefined) {
            if (!Array.isArray(schema.required)) {
                errors.push({ field: "inputSchema.required", message: "Si está, debe ser array de strings." });
            }
            else {
                const props = Object.keys((_a = schema.properties) !== null && _a !== void 0 ? _a : {});
                for (const r of schema.required) {
                    if (typeof r !== "string") {
                        errors.push({ field: "inputSchema.required", message: `Elemento "${r}" debe ser string.` });
                    }
                    else if (props.length > 0 && !props.includes(r)) {
                        errors.push({
                            field: "inputSchema.required",
                            message: `"${r}" está en required pero no en properties. Agrégalo a properties o quítalo de required.`,
                        });
                    }
                }
            }
        }
        // Validar contra el meta-schema de JSON Schema usando ajv
        try {
            const ajv = getAjv();
            ajv.compile(schema);
        }
        catch (err) {
            errors.push({
                field: "inputSchema",
                message: `JSON Schema inválido: ${err.message}`,
            });
        }
    }
    // ── outputSchema (opcional) ─────────────────────────────────────────────
    if ((tool === null || tool === void 0 ? void 0 : tool.outputSchema) !== undefined) {
        if (typeof tool.outputSchema !== "object" || tool.outputSchema === null) {
            errors.push({ field: "outputSchema", message: "Si está, debe ser un objeto JSON Schema." });
        }
        else {
            try {
                getAjv().compile(tool.outputSchema);
            }
            catch (err) {
                errors.push({ field: "outputSchema", message: `JSON Schema inválido: ${err.message}` });
            }
        }
    }
    // ── testCases (opcional) ────────────────────────────────────────────────
    if ((tool === null || tool === void 0 ? void 0 : tool.testCases) !== undefined) {
        if (!Array.isArray(tool.testCases)) {
            errors.push({ field: "testCases", message: "Si está, debe ser array." });
        }
        else {
            for (const [idx, tc] of tool.testCases.entries()) {
                if (typeof (tc === null || tc === void 0 ? void 0 : tc.name) !== "string" || !tc.name) {
                    errors.push({ field: `testCases[${idx}].name`, message: "Es requerido (string)." });
                }
                if ((tc === null || tc === void 0 ? void 0 : tc.args) === undefined) {
                    errors.push({ field: `testCases[${idx}].args`, message: "Es requerido (objeto con los args a pasar al handler)." });
                }
                if (typeof (tc === null || tc === void 0 ? void 0 : tc.expect) !== "object" || tc.expect === null) {
                    errors.push({ field: `testCases[${idx}].expect`, message: "Es requerido (objeto con expectativas)." });
                }
                else {
                    const { ok, shapeIncludes, errorMatches } = tc.expect;
                    const hasOne = ok !== undefined || shapeIncludes !== undefined || errorMatches !== undefined;
                    if (!hasOne) {
                        errors.push({
                            field: `testCases[${idx}].expect`,
                            message: "Debe declarar al menos una expectativa: ok | shapeIncludes | errorMatches.",
                        });
                    }
                    if (shapeIncludes !== undefined && !Array.isArray(shapeIncludes)) {
                        errors.push({ field: `testCases[${idx}].expect.shapeIncludes`, message: "Debe ser array de strings." });
                    }
                }
            }
        }
    }
    // ── tags (opcional) ─────────────────────────────────────────────────────
    if ((tool === null || tool === void 0 ? void 0 : tool.tags) !== undefined) {
        if (!Array.isArray(tool.tags) || !tool.tags.every((t) => typeof t === "string")) {
            errors.push({ field: "tags", message: "Si está, debe ser array de strings." });
        }
    }
    return { valid: errors.length === 0, errors };
}
/**
 * Helper para detectar si la definición usa los campos opcionales nuevos.
 * Útil para logging diferenciado.
 */
function getToolExtensions(tool) {
    const t = tool;
    return {
        hasOutputSchema: !!t.outputSchema,
        hasTestCases: Array.isArray(t.testCases) && t.testCases.length > 0,
        testCaseCount: Array.isArray(t.testCases) ? t.testCases.length : 0,
        tags: Array.isArray(t.tags) ? t.tags : [],
    };
}
