import type { Core } from "@strapi/strapi";
import { deriveAttributes } from "./derive";

/**
 * Catálogo de schemas vivo — refleja `strapi.contentTypes` y `strapi.components`
 * al momento de la llamada. Después de un `create_content_type` + reinicio de
 * Strapi, el nuevo UID aparece automáticamente.
 *
 * Filtra los content-types nativos de Strapi (admin::, plugin::) y deja solo
 * los del proyecto (api::) — son los que el LLM puede gestionar.
 */

export type CatalogContentType = {
  uid: string;
  kind: string;
  displayName: string;
  description: string;
  collectionName: string;
  draftAndPublish: boolean;
  i18n: boolean;
  fields: Record<string, string>;
};

export type CatalogComponent = {
  uid: string;
  category: string;
  displayName: string;
  description: string;
  fields: Record<string, string>;
};

export type SchemaCatalog = {
  content_types: CatalogContentType[];
  components: CatalogComponent[];
  internal_content_types_count: number;
};

export function buildSchemaCatalog(strapi: Core.Strapi): SchemaCatalog {
  const cts = (strapi.contentTypes as any) ?? {};
  const comps = (strapi.components as any) ?? {};

  const content_types: CatalogContentType[] = [];
  let internalCount = 0;

  for (const uid of Object.keys(cts)) {
    if (!uid.startsWith("api::")) {
      internalCount += 1;
      continue;
    }
    const ct = cts[uid];
    content_types.push({
      uid,
      kind: ct.kind ?? "collectionType",
      displayName: ct.info?.displayName ?? uid,
      description: ct.info?.description ?? "",
      collectionName: ct.collectionName ?? "",
      draftAndPublish: Boolean(ct.options?.draftAndPublish),
      i18n: Boolean(ct.pluginOptions?.i18n?.localized),
      fields: deriveAttributes(ct.attributes ?? {}),
    });
  }

  const components: CatalogComponent[] = [];
  for (const uid of Object.keys(comps)) {
    const comp = comps[uid];
    const [category] = uid.split(".");
    components.push({
      uid,
      category: category ?? "",
      displayName: comp.info?.displayName ?? uid,
      description: comp.info?.description ?? "",
      fields: deriveAttributes(comp.attributes ?? {}),
    });
  }

  return {
    content_types: content_types.sort((a, b) => a.uid.localeCompare(b.uid)),
    components: components.sort((a, b) => a.uid.localeCompare(b.uid)),
    internal_content_types_count: internalCount,
  };
}
