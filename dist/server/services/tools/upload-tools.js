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
exports.uploadTools = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto_1 = require("crypto");
const url_safety_1 = require("../url-safety");
/**
 * Tools de Upload — gestión del media library.
 *
 * Gated por UPLOAD_ENABLED=true (opt-in). Razón: si Strapi no tiene un provider
 * configurado correctamente (credenciales, bucket, etc.), los uploads tiran. El
 * dev decide explícitamente cuándo activar.
 *
 * El plugin upload de Strapi expone una API unificada que abstrae el provider
 * activo: local, AWS S3, Cloudinary, R2, etc. Estas tools llaman a:
 *   strapi.plugin('upload').service('upload').upload({data, files}, opts)
 *
 * Solo soportamos upload via URL (no base64 inline) — el LLM no puede mandar
 * bytes eficientemente.
 */
const FETCH_TIMEOUT_MS = 30000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
function getUploadService(strapi) {
    var _a, _b, _c;
    const svc = (_c = (_b = (_a = strapi.plugin) === null || _a === void 0 ? void 0 : _a.call(strapi, "upload")) === null || _b === void 0 ? void 0 : _b.service) === null || _c === void 0 ? void 0 : _c.call(_b, "upload");
    if (!svc) {
        throw new Error("Plugin @strapi/plugin-upload no disponible. Strapi v5 lo incluye por default — si no aparece, verificá tu instalación.");
    }
    return svc;
}
function inferExtensionFromContentType(contentType) {
    var _a;
    if (!contentType)
        return ".bin";
    const map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/avif": ".avif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "application/pdf": ".pdf",
        "application/json": ".json",
        "text/plain": ".txt",
    };
    return (_a = map[contentType.toLowerCase()]) !== null && _a !== void 0 ? _a : ".bin";
}
async function downloadToTmp(url) {
    var _a, _b, _c;
    // SSRF defense: fetchWithSafeRedirects valida la URL (protocolo http/https,
    // hostname/IPs no en rangos bloqueados — loopback, RFC1918, AWS IMDS, etc.)
    // antes de cada hop, y rechaza redirects que apunten a destinos prohibidos.
    const res = await (0, url_safety_1.fetchWithSafeRedirects)(url, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!res.ok) {
        throw new Error(`URL devolvió HTTP ${res.status}: ${res.statusText}`);
    }
    const contentType = (_c = (_b = (_a = res.headers.get("content-type")) === null || _a === void 0 ? void 0 : _a.split(";")[0]) === null || _b === void 0 ? void 0 : _b.trim()) !== null && _c !== void 0 ? _c : null;
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Archivo demasiado grande: ${contentLength} bytes (máximo ${MAX_DOWNLOAD_BYTES}).`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Archivo demasiado grande: ${buffer.length} bytes (máximo ${MAX_DOWNLOAD_BYTES}).`);
    }
    // Inferir nombre original: last segment del path, o random si no hay
    const urlObj = new URL(url);
    const lastSegment = decodeURIComponent(path.basename(urlObj.pathname));
    const ext = path.extname(lastSegment) || inferExtensionFromContentType(contentType);
    const originalFilename = lastSegment && lastSegment !== "/" ? lastSegment : `download-${(0, crypto_1.randomBytes)(4).toString("hex")}${ext}`;
    // Escribir a tmp file
    const tmpName = `strapi-mcp-upload-${(0, crypto_1.randomBytes)(8).toString("hex")}${ext}`;
    const filepath = path.join(os.tmpdir(), tmpName);
    await fs.writeFile(filepath, buffer);
    return {
        filepath,
        mimetype: contentType !== null && contentType !== void 0 ? contentType : "application/octet-stream",
        size: buffer.length,
        originalFilename,
    };
}
async function cleanupTmp(filepath) {
    try {
        await fs.unlink(filepath);
    }
    catch {
        // best-effort
    }
}
function assertEnabled() {
    if (process.env.UPLOAD_ENABLED !== "true") {
        const err = new Error("UPLOAD_DISABLED");
        err.details = {
            reason: "Las tools de upload están deshabilitadas. Setea UPLOAD_ENABLED=true en .env y reinicia Strapi. Asegurate también de tener un provider configurado en config/plugins.ts (local, S3, Cloudinary, etc.).",
        };
        throw err;
    }
}
exports.uploadTools = [
    // ── 1. list_media ───────────────────────────────────────────────────────────
    {
        name: "list_media",
        description: "Lista archivos del media library con filters/sort/pagination. Soporta búsqueda por nombre, filtros por mime, fecha de subida. Devuelve metadata + URL pública (puede apuntar a CDN si hay provider configurado).",
        inputSchema: {
            type: "object",
            properties: {
                filters: { type: "object", description: 'Sintaxis Strapi. Ej: {"mime": {"$contains": "image/"}}.' },
                sort: { description: 'Ej: ["createdAt:desc"].' },
                pagination: {
                    type: "object",
                    properties: {
                        page: { type: "integer", default: 1 },
                        pageSize: { type: "integer", default: 25 },
                    },
                },
            },
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a, _b, _c, _d;
            assertEnabled();
            const svc = getUploadService(strapi);
            const page = (_b = (_a = args.pagination) === null || _a === void 0 ? void 0 : _a.page) !== null && _b !== void 0 ? _b : 1;
            const pageSize = (_d = (_c = args.pagination) === null || _c === void 0 ? void 0 : _c.pageSize) !== null && _d !== void 0 ? _d : 25;
            const result = await svc.findPage({
                filters: args.filters,
                sort: args.sort,
                page,
                pageSize,
            });
            return {
                results: result.results,
                pagination: result.pagination,
            };
        },
    },
    // ── 2. get_media ────────────────────────────────────────────────────────────
    {
        name: "get_media",
        description: "Obtiene un archivo del media library por id, con todos sus metadatos y formatos generados (thumbnails, variantes responsive).",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "integer", description: "Id numérico del archivo (no documentId)." },
            },
            required: ["id"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            assertEnabled();
            const svc = getUploadService(strapi);
            const file = await svc.findOne(args.id);
            if (!file)
                throw new Error(`Media file id=${args.id} no encontrado.`);
            return file;
        },
    },
    // ── 3. upload_media_from_url ────────────────────────────────────────────────
    {
        name: "upload_media_from_url",
        description: "Descarga un archivo desde una URL pública y lo sube al media library. El provider configurado (local, S3, Cloudinary, etc.) recibe el archivo de forma transparente. Soporta imágenes, video, PDF, etc. Tamaño máximo: 50MB. Timeout de descarga: 30s.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL pública del archivo a descargar (debe ser HTTP/HTTPS accesible)." },
                name: {
                    type: "string",
                    description: "Nombre para el archivo en el media library (opcional, default: nombre del archivo en la URL).",
                },
                alternative_text: { type: "string", description: "Alt text (recomendado para imágenes, SEO + accesibilidad)." },
                caption: { type: "string" },
                folder: { type: "integer", description: "Id de la folder del media library donde guardar (opcional)." },
            },
            required: ["url"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a;
            assertEnabled();
            const svc = getUploadService(strapi);
            const downloaded = await downloadToTmp(args.url);
            try {
                const fileInfo = {};
                if (args.name)
                    fileInfo.name = args.name;
                if (args.alternative_text)
                    fileInfo.alternativeText = args.alternative_text;
                if (args.caption)
                    fileInfo.caption = args.caption;
                if (args.folder !== undefined)
                    fileInfo.folder = args.folder;
                const result = await svc.upload({
                    data: { fileInfo },
                    files: {
                        filepath: downloaded.filepath,
                        originalFilename: (_a = args.name) !== null && _a !== void 0 ? _a : downloaded.originalFilename,
                        mimetype: downloaded.mimetype,
                        size: downloaded.size,
                    },
                });
                const uploaded = Array.isArray(result) ? result[0] : result;
                return {
                    success: true,
                    file: uploaded,
                    source_url: args.url,
                    bytes_uploaded: downloaded.size,
                };
            }
            finally {
                await cleanupTmp(downloaded.filepath);
            }
        },
    },
    // ── 4. update_media_metadata ────────────────────────────────────────────────
    {
        name: "update_media_metadata",
        description: "Actualiza metadata de un archivo del media library sin re-uploadear el archivo: name, alternativeText, caption, folder. Útil para corregir alt text o reorganizar archivos.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "integer" },
                name: { type: "string" },
                alternative_text: { type: "string" },
                caption: { type: "string" },
                folder: { type: "integer" },
            },
            required: ["id"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            assertEnabled();
            const svc = getUploadService(strapi);
            const updated = await svc.updateFileInfo(args.id, {
                name: args.name,
                alternativeText: args.alternative_text,
                caption: args.caption,
                folder: args.folder,
            });
            return { success: true, file: updated };
        },
    },
    // ── 5. delete_media ─────────────────────────────────────────────────────────
    {
        name: "delete_media",
        description: "Elimina un archivo del media library Y del provider configurado (S3, etc.). REQUIERE confirm:true. Operación destructiva — el provider borra el archivo físico también.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "integer" },
                confirm: { type: "boolean" },
            },
            required: ["id", "confirm"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            assertEnabled();
            if (args.confirm !== true) {
                throw new Error("delete_media requiere confirm:true. El archivo se borra del provider físicamente.");
            }
            const svc = getUploadService(strapi);
            const file = await svc.findOne(args.id);
            if (!file)
                throw new Error(`Media file id=${args.id} no encontrado.`);
            const removed = await svc.remove(file);
            return { success: true, removed };
        },
    },
    // ── 6. link_media_to_entry ──────────────────────────────────────────────────
    {
        name: "link_media_to_entry",
        description: "Asocia uno o más archivos del media library a un campo media de un entry. Valida que el campo exista en el schema, que sea de tipo media, y que el mime del archivo esté en allowedTypes del schema. Si el campo es multiple:false, solo acepta 1 file_id; si es multiple:true, acepta varios.",
        inputSchema: {
            type: "object",
            properties: {
                uid: { type: "string", description: "UID del content-type del entry. Ej: api::article.article." },
                documentId: { type: "string" },
                field: { type: "string", description: "Nombre del campo media en el schema." },
                file_ids: {
                    type: "array",
                    items: { type: "integer" },
                    minItems: 1,
                    description: "Ids de los archivos del media library a asociar.",
                },
            },
            required: ["uid", "documentId", "field", "file_ids"],
            additionalProperties: false,
        },
        handler: async ({ strapi }, args) => {
            var _a, _b, _c;
            assertEnabled();
            const svc = getUploadService(strapi);
            // Validar schema del campo
            const ct = (_a = strapi.contentTypes) === null || _a === void 0 ? void 0 : _a[args.uid];
            if (!ct)
                throw new Error(`Content-type "${args.uid}" no existe.`);
            const attr = (_b = ct.attributes) === null || _b === void 0 ? void 0 : _b[args.field];
            if (!attr)
                throw new Error(`Campo "${args.field}" no existe en "${args.uid}".`);
            if (attr.type !== "media") {
                throw new Error(`Campo "${args.field}" es de tipo "${attr.type}", no "media". Solo se puede asociar media a campos media.`);
            }
            const isMultiple = attr.multiple === true;
            if (!isMultiple && args.file_ids.length > 1) {
                throw new Error(`Campo "${args.field}" es single (multiple:false). Pasaste ${args.file_ids.length} file_ids; máximo 1.`);
            }
            // Validar tipos contra allowedTypes del schema
            const allowedTypes = attr.allowedTypes;
            if (allowedTypes && allowedTypes.length > 0) {
                const ALLOWED_GROUPS = {
                    images: /^image\//,
                    videos: /^video\//,
                    audios: /^audio\//,
                    files: /^application\/|^text\//,
                };
                for (const fileId of args.file_ids) {
                    const file = await svc.findOne(fileId);
                    if (!file)
                        throw new Error(`Media file id=${fileId} no encontrado.`);
                    const mime = (_c = file.mime) !== null && _c !== void 0 ? _c : "";
                    const matchesAny = allowedTypes.some((group) => {
                        const re = ALLOWED_GROUPS[group];
                        return re ? re.test(mime) : false;
                    });
                    if (!matchesAny) {
                        throw new Error(`File id=${fileId} (mime: ${mime}) no matchea allowedTypes del campo "${args.field}": [${allowedTypes.join(", ")}]. Subí un archivo del tipo correcto o cambiá el schema.`);
                    }
                }
            }
            // Update via documents API para que pase por lifecycle hooks
            const updated = await strapi.documents(args.uid).update({
                documentId: args.documentId,
                data: {
                    [args.field]: isMultiple ? args.file_ids : args.file_ids[0],
                },
            });
            return { success: true, uid: args.uid, documentId: args.documentId, field: args.field, linked_ids: args.file_ids, entry: updated };
        },
    },
];
