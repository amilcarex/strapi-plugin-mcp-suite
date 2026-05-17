import type { ToolDefinition } from "./types";

/**
 * Tools de "visual layout" — modifican la configuración del Content Manager
 * (labels, widths de campos, orden, etc.). Esta configuración vive en
 * `strapi_core_store_settings` (no en schema.json) y NO requiere reinicio.
 *
 * Edit grid de Strapi: 12 columnas.
 *   - size 12 = 100% (fila completa)
 *   - size 6  = 50%
 *   - size 4  = 33%
 *   - size 3  = 25%
 * La suma de `size` de una fila debe ser ≤ 12.
 *
 * APIs internas usadas:
 *   strapi.plugin('content-manager').service('content-types')
 *     .findConfiguration({uid}) / .updateConfiguration({uid}, newConfig)
 *   strapi.plugin('content-manager').service('components')
 *     .findConfiguration({uid}) / .updateConfiguration({uid}, newConfig)
 */

const MAX_ROW_SIZE = 12;

function getConfigService(strapi: any, uid: string) {
  const isComponent = !uid.startsWith("api::");
  const serviceName = isComponent ? "components" : "content-types";
  const service = strapi.plugin("content-manager").service(serviceName);
  if (!service) {
    throw new Error(`Content-manager service "${serviceName}" no disponible.`);
  }
  return { service, isComponent };
}

function getModel(strapi: any, uid: string) {
  const isComponent = !uid.startsWith("api::");
  const source = isComponent
    ? (strapi.components as any)?.[uid]
    : (strapi.contentTypes as any)?.[uid];
  if (!source) {
    throw new Error(`"${uid}" no existe en strapi.${isComponent ? "components" : "contentTypes"}.`);
  }
  return { ...source, uid };
}

function assertFieldExists(model: any, fieldName: string) {
  if (!model.attributes?.[fieldName]) {
    throw new Error(
      `El campo "${fieldName}" no existe en "${model.uid}". Atributos disponibles: ${Object.keys(model.attributes ?? {}).join(", ")}.`
    );
  }
}

export const layoutOpsTools: ToolDefinition[] = [
  // ── 1. get_visual_layout ────────────────────────────────────────────────────
  {
    name: "get_visual_layout",
    description:
      "Devuelve la configuración visual actual del Content Manager para un content-type o component: settings (mainField, defaultSort, pageSize), metadatas (label/description/placeholder/visible/editable por campo, para edit y list view), y layouts (orden y widths de campos en el form de edit + columnas del list view). Esta config NO está en el schema.json — vive en strapi_core_store_settings.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "UID del content-type (api::*) o component." },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const model = getModel(strapi, args.uid);
      const { service } = getConfigService(strapi, args.uid);
      const config = await service.findConfiguration(model);
      return {
        uid: args.uid,
        settings: config?.settings ?? null,
        metadatas: config?.metadatas ?? null,
        layouts: config?.layouts ?? null,
        grid_size: MAX_ROW_SIZE,
        grid_size_hint: `Edit view usa grid de ${MAX_ROW_SIZE} columnas. size:12=100%, 6=50%, 4=33%, 3=25%. Cada row debe sumar ≤ ${MAX_ROW_SIZE}.`,
      };
    },
  },

  // ── 2. set_field_layout ─────────────────────────────────────────────────────
  {
    name: "set_field_layout",
    description:
      "Reorganiza visualmente los campos del edit view y/o list view de un content-type o component. NO requiere reinicio de Strapi. Valida que cada campo exista en el schema, que cada size sea 1-12, y que cada fila del edit no exceda 12. Si se omite edit_rows o list_fields, se preserva el valor actual.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        edit_rows: {
          type: "array",
          description:
            "Array de filas. Cada fila es array de {field, size}. size 12=100%, 6=50%, 4=33%, 3=25%. Suma de cada fila ≤ 12.",
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                size: { type: "integer", minimum: 1, maximum: 12 },
              },
              required: ["field", "size"],
            },
          },
        },
        list_fields: {
          type: "array",
          description: "Orden de columnas en la list view. Cada elemento es un nombre de campo.",
          items: { type: "string" },
        },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const model = getModel(strapi, args.uid);
      const { service } = getConfigService(strapi, args.uid);
      const current = await service.findConfiguration(model);

      const newLayouts: any = { ...(current.layouts ?? {}) };

      if (args.edit_rows !== undefined) {
        // Validar
        for (const [rowIdx, row] of args.edit_rows.entries()) {
          if (!Array.isArray(row)) {
            throw new Error(`edit_rows[${rowIdx}] debe ser un array.`);
          }
          let sum = 0;
          for (const cell of row) {
            assertFieldExists(model, cell.field);
            sum += cell.size;
          }
          if (sum > MAX_ROW_SIZE) {
            throw new Error(
              `edit_rows[${rowIdx}] suma ${sum} > ${MAX_ROW_SIZE}. Reduce widths o divide en otra fila.`
            );
          }
        }
        newLayouts.edit = args.edit_rows.map((row: any[]) =>
          row.map((cell: any) => ({ name: cell.field, size: cell.size }))
        );
      }

      if (args.list_fields !== undefined) {
        for (const fieldName of args.list_fields) {
          assertFieldExists(model, fieldName);
        }
        newLayouts.list = args.list_fields;
      }

      const newConfig = {
        ...current,
        layouts: newLayouts,
      };

      const saved = await service.updateConfiguration(model, newConfig);
      return {
        success: true,
        uid: args.uid,
        layouts: saved.layouts,
        restart_required: false,
        hint: "El cambio se refleja en el admin de Strapi sin reiniciar. Haz F5 si tenías la pestaña abierta.",
      };
    },
  },

  // ── 3. set_field_metadata ───────────────────────────────────────────────────
  {
    name: "set_field_metadata",
    description:
      "Setea label, description, placeholder, visible o editable de un campo en el edit view, y/o label, searchable, sortable en la list view. Merge parcial — los campos no enviados se preservan. NO requiere reinicio. NO modifica el schema, solo la presentación.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string" },
        field: { type: "string" },
        edit: {
          type: "object",
          description: "Overrides para edit view.",
          properties: {
            label: { type: "string" },
            description: { type: "string" },
            placeholder: { type: "string" },
            visible: { type: "boolean" },
            editable: { type: "boolean" },
            mainField: { type: "string", description: "Solo para campos relation: qué campo del CT relacionado mostrar." },
          },
          additionalProperties: false,
        },
        list: {
          type: "object",
          description: "Overrides para list view.",
          properties: {
            label: { type: "string" },
            searchable: { type: "boolean" },
            sortable: { type: "boolean" },
            mainField: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      required: ["uid", "field"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      const model = getModel(strapi, args.uid);
      assertFieldExists(model, args.field);
      const { service } = getConfigService(strapi, args.uid);
      const current = await service.findConfiguration(model);

      const newMetadatas = { ...(current.metadatas ?? {}) };
      const fieldMeta = { ...(newMetadatas[args.field] ?? {}) };

      if (args.edit) {
        fieldMeta.edit = { ...(fieldMeta.edit ?? {}), ...args.edit };
      }
      if (args.list) {
        fieldMeta.list = { ...(fieldMeta.list ?? {}), ...args.list };
      }

      newMetadatas[args.field] = fieldMeta;

      const saved = await service.updateConfiguration(model, {
        ...current,
        metadatas: newMetadatas,
      });

      return {
        success: true,
        uid: args.uid,
        field: args.field,
        metadata: saved.metadatas?.[args.field],
        restart_required: false,
      };
    },
  },

  // ── 4. set_view_settings ────────────────────────────────────────────────────
  {
    name: "set_view_settings",
    description:
      "Setea opciones del list view de un content-type: mainField (campo principal mostrado), defaultSortBy, defaultSortOrder (ASC|DESC), pageSize, searchable, filterable, bulkable. Merge parcial. NO requiere reinicio. No aplicable a components.",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "string", description: "Solo content-types (api::*). Components no tienen list view." },
        main_field: { type: "string" },
        default_sort_by: { type: "string" },
        default_sort_order: { type: "string", enum: ["ASC", "DESC"] },
        page_size: { type: "integer", minimum: 1, maximum: 100 },
        searchable: { type: "boolean" },
        filterable: { type: "boolean" },
        bulkable: { type: "boolean" },
      },
      required: ["uid"],
      additionalProperties: false,
    },
    handler: async ({ strapi }, args: any) => {
      if (!args.uid.startsWith("api::")) {
        throw new Error("set_view_settings solo aplica a content-types (api::*). Para components usa set_field_metadata.");
      }
      const model = getModel(strapi, args.uid);
      const { service } = getConfigService(strapi, args.uid);
      const current = await service.findConfiguration(model);

      const newSettings = { ...(current.settings ?? {}) };
      if (args.main_field !== undefined) {
        assertFieldExists(model, args.main_field);
        newSettings.mainField = args.main_field;
      }
      if (args.default_sort_by !== undefined) {
        assertFieldExists(model, args.default_sort_by);
        newSettings.defaultSortBy = args.default_sort_by;
      }
      if (args.default_sort_order !== undefined) newSettings.defaultSortOrder = args.default_sort_order;
      if (args.page_size !== undefined) newSettings.pageSize = args.page_size;
      if (args.searchable !== undefined) newSettings.searchable = args.searchable;
      if (args.filterable !== undefined) newSettings.filterable = args.filterable;
      if (args.bulkable !== undefined) newSettings.bulkable = args.bulkable;

      const saved = await service.updateConfiguration(model, {
        ...current,
        settings: newSettings,
      });

      return {
        success: true,
        uid: args.uid,
        settings: saved.settings,
        restart_required: false,
      };
    },
  },
];
