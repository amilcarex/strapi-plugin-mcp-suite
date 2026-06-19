import type { Core } from "@strapi/strapi";

/**
 * Feature flags que controlan qué categorías de tools expone el MCP server.
 *
 * Histórico: hasta v0.6.x el gating vivía exclusivamente en `process.env`
 * (SCHEMA_AUTHORING_ENABLED, UPLOAD_ENABLED, GRAPHQL_ENABLED) y `contentOps`
 * no se podía apagar (los content-ops se empujaban siempre). Eso hacía
 * imposible convivir con el MCP nativo de Strapi 5.47+, que también expone
 * CRUD de contenido — el LLM terminaba viendo tools duplicadas
 * (`find_entries` vs `list`, `create_entry` vs `create`, …).
 *
 * Desde v0.7.0 el gating es config-driven (`config/plugins.ts`), con las env
 * vars como OVERRIDE para compatibilidad hacia atrás.
 *
 * Precedencia (de menor a mayor):
 *   1. default (este módulo)
 *   2. config del plugin   → strapi.plugin('strapi-mcp-suite').config(key)
 *   3. env var override     → si está seteada, gana sobre todo lo demás
 *
 * `contentOps` es el toggle nuevo: ponlo en `false` cuando el MCP nativo
 * maneje el CRUD, para que este plugin exponga solo sus diferenciadores
 * (schema authoring, layout, audit, media, graphql).
 */
export interface FeatureFlags {
  /** CRUD de entries + publish/unpublish (`find_entries`, `create_entry`, …). */
  contentOps: boolean;
  /** Tools que escriben schema al filesystem (`create_content_type`, …). */
  schemaAuthoring: boolean;
  /** Tools del media library (`upload_media_from_url`, …). */
  upload: boolean;
  /** Tools de @strapi/plugin-graphql (`graphql_query`, …). */
  graphql: boolean;
}

export const FEATURE_DEFAULTS: FeatureFlags = {
  contentOps: true,
  schemaAuthoring: false,
  upload: false,
  graphql: false,
};

/**
 * Mapeo flag → env var de override. Los nombres preservan los que ya usaban
 * los deployments existentes; `CONTENT_OPS_ENABLED` es nuevo.
 */
export const ENV_OVERRIDES: Record<keyof FeatureFlags, string> = {
  contentOps: "CONTENT_OPS_ENABLED",
  schemaAuthoring: "SCHEMA_AUTHORING_ENABLED",
  upload: "UPLOAD_ENABLED",
  graphql: "GRAPHQL_ENABLED",
};

/**
 * Parsea una env var booleana de forma tolerante.
 *   "true" / "1"  → true
 *   "false" / "0" → false
 *   undefined / "" / cualquier otra cosa → undefined (sin override)
 */
export function parseBoolEnv(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/**
 * Aplica los overrides de env sobre los flags resueltos por config.
 * Función pura — testeable sin mockear Strapi.
 */
export function applyEnvOverrides(
  configFlags: FeatureFlags,
  env: Record<string, string | undefined>
): FeatureFlags {
  const out: FeatureFlags = { ...configFlags };
  (Object.keys(ENV_OVERRIDES) as (keyof FeatureFlags)[]).forEach((key) => {
    const override = parseBoolEnv(env[ENV_OVERRIDES[key]]);
    if (override !== undefined) out[key] = override;
  });
  return out;
}

/**
 * Lee un booleano de la config del plugin, defensivo ante las distintas
 * superficies que Strapi expone (`plugin().config(key)` y
 * `strapi.config.get('plugin::…')`). Devuelve undefined si no hay valor
 * booleano explícito, para que el caller caiga al default.
 */
function readPluginConfig(
  strapi: Core.Strapi,
  key: keyof FeatureFlags
): boolean | undefined {
  try {
    const plugin: any = strapi.plugin("strapi-mcp-suite");
    if (plugin && typeof plugin.config === "function") {
      const v = plugin.config(key);
      if (typeof v === "boolean") return v;
    }
  } catch {
    /* noop — caemos al siguiente intento */
  }
  try {
    const v = (strapi.config as any)?.get?.(`plugin::strapi-mcp-suite.${key}`);
    if (typeof v === "boolean") return v;
  } catch {
    /* noop */
  }
  return undefined;
}

/**
 * Resuelve los feature flags efectivos combinando default → config → env.
 */
export function resolveFeatureFlags(strapi: Core.Strapi): FeatureFlags {
  const configFlags: FeatureFlags = { ...FEATURE_DEFAULTS };
  (Object.keys(FEATURE_DEFAULTS) as (keyof FeatureFlags)[]).forEach((key) => {
    const fromConfig = readPluginConfig(strapi, key);
    if (fromConfig !== undefined) configFlags[key] = fromConfig;
  });
  return applyEnvOverrides(configFlags, process.env);
}
