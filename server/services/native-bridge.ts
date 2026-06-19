import type { Core } from "@strapi/strapi";

import type { ToolDefinition } from "./tools/types";
import { schemaAuthoringTools } from "./tools/schema-authoring";
import { layoutOpsTools } from "./tools/layout-ops";
import { registryTools } from "./tools/registry-tools";
import { healthTools } from "./tools/health-tools";
import { uploadTools } from "./tools/upload-tools";
import { graphqlTools } from "./tools/graphql-tools";
import { resolveFeatureFlags } from "./feature-flags";

/**
 * Punto 3 — Bridge hacia el MCP nativo de Strapi 5.47+ (`coexistence:"extend-native"`).
 *
 * Registra los DIFERENCIADORES del plugin dentro de `strapi.ai.mcp` para que se
 * sirvan desde el endpoint único `/mcp` junto al CRUD nativo. Así el cliente
 * conecta un solo endpoint y obtiene: CRUD del nativo + schema authoring + layout
 * + media/graphql del plugin.
 *
 * NO registra:
 *   - contentOps: el nativo ya hace el CRUD.
 *   - audit (__audit_*): exigen super-admin vía `ctx.user.roles`, y el contexto
 *     del nativo solo trae `user.id` — quedan solo en el endpoint standalone.
 *
 * Timing: hay que registrar ANTES de que el provider nativo haga `.start()` (si
 * no, `registerTool` tira). Por eso se llama desde la fase `register` del plugin.
 *
 * El SDK del nativo exige `inputSchema` como Zod (raw shape), no JSON Schema, así
 * que convertimos. `zod` se resuelve en runtime (está presente en hosts 5.47+).
 */

type Zod = any;

/** Convierte una prop JSON-Schema a un validador Zod. Cubre el subset que usan las tools. */
function propToZod(z: Zod, prop: any): Zod {
  let v: Zod;
  const enumVals = Array.isArray(prop?.enum) ? prop.enum : null;
  if (enumVals && enumVals.length > 0 && enumVals.every((e: any) => typeof e === "string")) {
    v = z.enum(enumVals as [string, ...string[]]);
  } else {
    switch (prop?.type) {
      case "string":
        v = z.string();
        break;
      case "number":
      case "integer":
        v = z.number();
        break;
      case "boolean":
        v = z.boolean();
        break;
      case "array":
        v = z.array(prop.items ? propToZod(z, prop.items) : z.any());
        break;
      case "object":
        v = z.record(z.any());
        break;
      default:
        v = z.any();
    }
  }
  if (typeof prop?.description === "string" && prop.description.length > 0) {
    v = v.describe(prop.description);
  }
  return v;
}

/**
 * JSON Schema (object) → ZodRawShape. Devuelve undefined si no hay properties
 * (tool sin args), que el nativo trata como "sin inputSchema".
 */
export function jsonSchemaToZodShape(z: Zod, schema: any): Record<string, Zod> | undefined {
  const props = schema?.properties;
  if (!props || typeof props !== "object" || Object.keys(props).length === 0) {
    return undefined;
  }
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const shape: Record<string, Zod> = {};
  for (const [key, prop] of Object.entries(props)) {
    let v = propToZod(z, prop);
    if (!required.includes(key)) v = v.optional();
    shape[key] = v;
  }
  return shape;
}

/** Adapta una ToolDefinition del plugin al shape que espera `strapi.ai.mcp.registerTool`. */
export function toNativeToolDefinition(z: Zod, tool: ToolDefinition): any {
  const shape = jsonSchemaToZodShape(z, tool.inputSchema);
  const def: any = {
    name: tool.name,
    title: tool.name,
    description: tool.description,
    // El nativo exige `auth.policies` o `devModeOnly`. Los diferenciadores son
    // herramientas de desarrollo (schema authoring escribe al FS y reinicia;
    // layout/health son de dev), así que devModeOnly es lo semánticamente correcto
    // — y se alinea con que el plugin ya bloquea schema authoring en producción.
    devModeOnly: true,
    resolveOutputSchema: () => undefined,
    // createHandler(strapi, nativeCtx) → handler que el nativo invoca como
    // safeHandler({ args, extra }) cuando hay inputSchema, o ({ extra }) si no.
    createHandler: (strapi: Core.Strapi, nativeCtx: any) => {
      return async (payload: any) => {
        const args = payload?.args ?? {};
        const toolCtx = { strapi, auth: undefined, user: nativeCtx?.user };
        try {
          const result = await tool.handler(toolCtx as any, args);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const details = (err as any)?.details;
          return {
            content: [{ type: "text", text: JSON.stringify({ error: message, details }, null, 2) }],
            isError: true,
          };
        }
      };
    },
  };
  if (shape !== undefined) {
    def.resolveInputSchema = () => shape;
  }
  return def;
}

/** Junta los diferenciadores a publicar en el nativo según los flags activos. */
export function differentiatorTools(strapi: Core.Strapi): ToolDefinition[] {
  const flags = resolveFeatureFlags(strapi);
  const tools: ToolDefinition[] = [];
  if (flags.schemaAuthoring) tools.push(...schemaAuthoringTools);
  tools.push(...layoutOpsTools);
  tools.push(...registryTools);
  tools.push(...healthTools);
  if (flags.upload) tools.push(...uploadTools);
  if (flags.graphql) tools.push(...graphqlTools);
  return tools;
}

/**
 * Registra los diferenciadores del plugin en el MCP nativo.
 * Idempotente a nivel proceso (no re-registra si ya corrió).
 * Devuelve la cantidad registrada, o -1 si el nativo no está disponible/registrable.
 */
let alreadyBridged = false;

export function registerIntoNativeMcp(strapi: Core.Strapi): number {
  if (alreadyBridged) return 0;
  const native: any = (strapi as any).ai?.mcp;
  if (!native || typeof native.registerTool !== "function") {
    strapi.log.warn(
      "[strapi-mcp] coexistence:extend-native pedido pero strapi.ai.mcp no está disponible — se omite el bridge."
    );
    return -1;
  }
  if (typeof native.isRunning === "function" && native.isRunning()) {
    strapi.log.warn(
      "[strapi-mcp] el MCP nativo ya arrancó — no se pueden registrar tools. El bridge debe correr en la fase `register`."
    );
    return -1;
  }

  let z: Zod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    z = require("zod");
    z = z?.z ?? z; // soporta `export const z` o default
  } catch {
    strapi.log.warn("[strapi-mcp] no pude cargar `zod` — el bridge al nativo requiere zod (presente en Strapi 5.47+).");
    return -1;
  }

  const tools = differentiatorTools(strapi);
  let count = 0;
  for (const tool of tools) {
    try {
      native.registerTool(toNativeToolDefinition(z, tool));
      count++;
    } catch (err) {
      strapi.log.warn(`[strapi-mcp] no pude registrar "${tool.name}" en el nativo: ${String(err)}`);
    }
  }
  alreadyBridged = true;
  strapi.log.info(
    `[strapi-mcp] ${count} diferenciador(es) registrado(s) en el MCP nativo (/mcp) — modo extend-native. El CRUD lo sirve el nativo; el plugin agrega schema authoring + layout + media/graphql.`
  );
  return count;
}
