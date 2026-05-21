import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomBytes } from "crypto";

import type { ToolDefinition } from "./types";
import { fetchWithSafeRedirects } from "../url-safety";

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

function getUploadService(strapi: any): any {
  const svc = strapi.plugin?.("upload")?.service?.("upload");
  if (!svc) {
    throw new Error(
      "Plugin @strapi/plugin-upload no disponible. Strapi v5 lo incluye por default — si no aparece, verificá tu instalación."
    );
  }
  return svc;
}

function inferExtensionFromContentType(contentType: string | null): string {
  if (!contentType) return ".bin";
  const map: Record<string, string> = {
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
  return map[contentType.toLowerCase()] ?? ".bin";
}

async function downloadToTmp(
  url: string
): Promise<{ filepath: string; mimetype: string; size: number; originalFilename: string }> {
  // SSRF defense: fetchWithSafeRedirects valida la URL (protocolo http/https,
  // hostname/IPs no en rangos bloqueados — loopback, RFC1918, AWS IMDS, etc.)
  // antes de cada hop, y rechaza redirects que apunten a destinos prohibidos.
  const res = await fetchWithSafeRedirects(url, { timeoutMs: FETCH_TIMEOUT_MS });

  if (!res.ok) {
    throw new Error(`URL devolvió HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Archivo demasiado grande: ${contentLength} bytes (máximo ${MAX_DOWNLOAD_BYTES}).`
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Archivo demasiado grande: ${buffer.length} bytes (máximo ${MAX_DOWNLOAD_BYTES}).`);
  }

  // Inferir nombre original: last segment del path, o random si no hay
  const urlObj = new URL(url);
  const lastSegment = decodeURIComponent(path.basename(urlObj.pathname));
  const ext = path.extname(lastSegment) || inferExtensionFromContentType(contentType);
  const originalFilename = lastSegment && lastSegment !== "/" ? lastSegment : `download-${randomBytes(4).toString("hex")}${ext}`;

  // Escribir a tmp file
  const tmpName = `strapi-mcp-upload-${randomBytes(8).toString("hex")}${ext}`;
  const filepath = path.join(os.tmpdir(), tmpName);
  await fs.writeFile(filepath, buffer);

  return {
    filepath,
    mimetype: contentType ?? "application/octet-stream",
    size: buffer.length,
    originalFilename,
  };
}

async function cleanupTmp(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath);
  } catch {
    // best-effort
  }
}

function assertEnabled() {
  if (process.env.UPLOAD_ENABLED !== "true") {
    const err = new Error("UPLOAD_DISABLED") as any;
    err.details = {
      reason:
        "Las tools de upload están deshabilitadas. Setea UPLOAD_ENABLED=true en .env y reinicia Strapi. Asegurate también de tener un provider configurado en config/plugins.ts (local, S3, Cloudinary, etc.).",
    };
    throw err;
  }
}

export const uploadTools: ToolDefinition[] = [
  // ── 1. list_media ───────────────────────────────────────────────────────────
  {
    name: "list_media",
    description:
      "Lista archivos del media library con filters/sort/pagination. Soporta búsqueda por nombre, filtros por mime, fecha de subida. Devuelve metadata + URL pública (puede apuntar a CDN si hay provider configurado).",
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
    handler: async ({ strapi }, args: any) => {
      assertEnabled();
      const svc = getUploadService(strapi);
      const page = args.pagination?.page ?? 1;
      const pageSize = args.pagination?.pageSize ?? 25;

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
    handler: async ({ strapi }, args: any) => {
      assertEnabled();
      const svc = getUploadService(strapi);
      const file = await svc.findOne(args.id);
      if (!file) throw new Error(`Media file id=${args.id} no encontrado.`);
      return file;
    },
  },

  // ── 3. upload_media_from_url ────────────────────────────────────────────────
  {
    name: "upload_media_from_url",
    description:
      "Descarga un archivo desde una URL pública y lo sube al media library. El provider configurado (local, S3, Cloudinary, etc.) recibe el archivo de forma transparente. Soporta imágenes, video, PDF, etc. Tamaño máximo: 50MB. Timeout de descarga: 30s.",
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
    handler: async ({ strapi }, args: any) => {
      assertEnabled();
      const svc = getUploadService(strapi);

      const downloaded = await downloadToTmp(args.url);
      try {
        const fileInfo: any = {};
        if (args.name) fileInfo.name = args.name;
        if (args.alternative_text) fileInfo.alternativeText = args.alternative_text;
        if (args.caption) fileInfo.caption = args.caption;
        if (args.folder !== undefined) fileInfo.folder = args.folder;

        const result = await svc.upload({
          data: { fileInfo },
          files: {
            filepath: downloaded.filepath,
            originalFilename: args.name ?? downloaded.originalFilename,
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
      } finally {
        await cleanupTmp(downloaded.filepath);
      }
    },
  },

  // ── 4. update_media_metadata ────────────────────────────────────────────────
  {
    name: "update_media_metadata",
    description:
      "Actualiza metadata de un archivo del media library sin re-uploadear el archivo: name, alternativeText, caption, folder. Útil para corregir alt text o reorganizar archivos.",
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
    handler: async ({ strapi }, args: any) => {
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
    description: "⚠️ DESTRUCTIVA. Elimina un archivo del media library Y del provider configurado (S3, etc.). REQUIERE confirm:true. El provider borra el archivo físico también — es irreversible. USA ESTA TOOL SOLO cuando el usuario nombró explícitamente el archivo a eliminar; no la uses para 'limpiar' por tu cuenta.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        confirm: { type: "boolean" },
      },
      required: ["id", "confirm"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      assertEnabled();
      if (args.confirm !== true) {
        throw new Error("delete_media requiere confirm:true. El archivo se borra del provider físicamente.");
      }
      const svc = getUploadService(strapi);
      const file = await svc.findOne(args.id);
      if (!file) throw new Error(`Media file id=${args.id} no encontrado.`);
      const removed = await svc.remove(file);
      return { success: true, removed };
    },
  },

  // ── 6. link_media_to_entry ──────────────────────────────────────────────────
  {
    name: "link_media_to_entry",
    description:
      "Asocia uno o más archivos del media library a un campo media de un entry. Valida que el campo exista en el schema, que sea de tipo media, y que el mime del archivo esté en allowedTypes del schema. Si el campo es multiple:false, solo acepta 1 file_id; si es multiple:true, acepta varios.",
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
    handler: async ({ strapi }, args: any) => {
      assertEnabled();
      const svc = getUploadService(strapi);

      // Validar schema del campo
      const ct = (strapi.contentTypes as any)?.[args.uid];
      if (!ct) throw new Error(`Content-type "${args.uid}" no existe.`);
      const attr = ct.attributes?.[args.field];
      if (!attr) throw new Error(`Campo "${args.field}" no existe en "${args.uid}".`);
      if (attr.type !== "media") {
        throw new Error(`Campo "${args.field}" es de tipo "${attr.type}", no "media". Solo se puede asociar media a campos media.`);
      }

      const isMultiple = attr.multiple === true;
      if (!isMultiple && args.file_ids.length > 1) {
        throw new Error(`Campo "${args.field}" es single (multiple:false). Pasaste ${args.file_ids.length} file_ids; máximo 1.`);
      }

      // Validar tipos contra allowedTypes del schema
      const allowedTypes: string[] | undefined = attr.allowedTypes;
      if (allowedTypes && allowedTypes.length > 0) {
        const ALLOWED_GROUPS: Record<string, RegExp> = {
          images: /^image\//,
          videos: /^video\//,
          audios: /^audio\//,
          files: /^application\/|^text\//,
        };
        for (const fileId of args.file_ids) {
          const file = await svc.findOne(fileId);
          if (!file) throw new Error(`Media file id=${fileId} no encontrado.`);
          const mime: string = file.mime ?? "";
          const matchesAny = allowedTypes.some((group: string) => {
            const re = ALLOWED_GROUPS[group];
            return re ? re.test(mime) : false;
          });
          if (!matchesAny) {
            throw new Error(
              `File id=${fileId} (mime: ${mime}) no matchea allowedTypes del campo "${args.field}": [${allowedTypes.join(", ")}]. Subí un archivo del tipo correcto o cambiá el schema.`
            );
          }
        }
      }

      // Update via documents API para que pase por lifecycle hooks
      const updated = await strapi.documents(args.uid as any).update({
        documentId: args.documentId,
        data: {
          [args.field]: isMultiple ? args.file_ids : args.file_ids[0],
        },
      } as any);

      return { success: true, uid: args.uid, documentId: args.documentId, field: args.field, linked_ids: args.file_ids, entry: updated };
    },
  },
];
