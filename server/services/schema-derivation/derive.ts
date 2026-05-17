import type { Core } from "@strapi/strapi";

/**
 * Derivador de schemas en runtime.
 *
 * Lee `strapi.components` y `strapi.contentTypes` (cargados en memoria desde los
 * archivos JSON del proyecto) y construye descripciones legibles de cada campo.
 * Cuando el usuario añade/modifica un campo y reinicia Strapi, el resultado se
 * actualiza automáticamente sin tocar archivos `.ts` del plugin.
 */

type AnyAttr = Record<string, any>;

function suffix(attr: AnyAttr): string {
  const parts: string[] = [];
  if (attr.required) parts.push("required");
  if (attr.unique) parts.push("unique");
  if (attr.default !== undefined) parts.push(`default: ${JSON.stringify(attr.default)}`);
  if (attr.min !== undefined) parts.push(`min: ${attr.min}`);
  if (attr.max !== undefined) parts.push(`max: ${attr.max}`);
  if (attr.minLength !== undefined) parts.push(`minLength: ${attr.minLength}`);
  if (attr.maxLength !== undefined) parts.push(`maxLength: ${attr.maxLength}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function formatAttribute(attr: AnyAttr): string {
  switch (attr?.type) {
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
      const enums = (attr.enum || []).map((v: string) => `'${v}'`).join("|");
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
      return attr?.type ?? "unknown";
  }
}

export function deriveAttributes(attrs: Record<string, AnyAttr>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, attr] of Object.entries(attrs ?? {})) {
    result[name] = formatAttribute(attr);
  }
  return result;
}

export function deriveComponentFields(
  strapi: Core.Strapi,
  uid: string
): { description: string; defaultName?: string; fields: Record<string, string> } | null {
  const comp = (strapi.components as any)?.[uid];
  if (!comp) return null;

  const defaultName = comp.attributes?.name?.default as string | undefined;

  return {
    description: comp.info?.description || "",
    defaultName,
    fields: deriveAttributes(comp.attributes),
  };
}

export function deriveContentTypeFields(
  strapi: Core.Strapi,
  uid: string
): { description: string; kind: string; fields: Record<string, string> } | null {
  const ct = (strapi.contentTypes as any)?.[uid];
  if (!ct) return null;

  return {
    description: ct.info?.description || "",
    kind: ct.kind ?? "collectionType",
    fields: deriveAttributes(ct.attributes),
  };
}

/**
 * Para cualquier content-type con un dynamic zone attribute dado, devuelve los
 * UIDs de los components permitidos. Útil para discovery genérico.
 */
export function getDynamicZoneUids(
  strapi: Core.Strapi,
  contentTypeUid: string,
  attributeName: string
): string[] {
  const ct = (strapi.contentTypes as any)?.[contentTypeUid];
  const attr = ct?.attributes?.[attributeName];
  if (attr?.type !== "dynamiczone") return [];
  return [...(attr.components || [])];
}
