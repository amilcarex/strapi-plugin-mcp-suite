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

/* ─── Coexistencia con el MCP nativo de Strapi 5.47+ (punto 2) ──────────────── */

/**
 * Modos de convivencia:
 *   - "auto" (default): si se detecta el MCP nativo activo, se suprime contentOps
 *     automáticamente para no exponer tools de CRUD duplicadas. Sin tocar config.
 *   - "standalone": ignora el nativo; el plugin sirve lo que digan los flags
 *     (útil si querés el CRUD del plugin aunque el nativo esté prendido).
 *   - "extend-native": reservado para el punto 3 (registrar las tools en
 *     `strapi.ai.mcp`). De cara a la supresión se comporta como "auto".
 */
export type CoexistenceMode = "auto" | "standalone" | "extend-native";
export const COEXISTENCE_MODES: CoexistenceMode[] = ["auto", "standalone", "extend-native"];
export const DEFAULT_COEXISTENCE: CoexistenceMode = "auto";
export const COEXISTENCE_ENV = "MCP_COEXISTENCE";

/** Parsea "5.47.0" → [5,47,0]. Devuelve null si no parsea. */
function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** ¿`version` >= `min`? Función pura. */
export function versionGte(version: unknown, min: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(min);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/**
 * ¿Está el MCP nativo de Strapi sirviendo? Requiere dos condiciones:
 *   1. Strapi >= 5.47.0 (antes no existe la capability), y
 *   2. `server.mcp.enabled === true` (resuelto, incluye defaults del core).
 * En <5.47 nunca devuelve true → jamás auto-suprime sin que haya un nativo real.
 */
export function isNativeMcpActive(strapi: Core.Strapi): boolean {
  const version = (strapi.config as any)?.info?.strapi;
  if (!versionGte(version, "5.47.0")) return false;
  let enabled: unknown;
  try {
    enabled = (strapi.config as any)?.get?.("server.mcp.enabled");
  } catch {
    enabled = undefined;
  }
  return enabled === true;
}

/** Lee el modo de coexistencia: default → config → env override (MCP_COEXISTENCE). */
export function resolveCoexistence(strapi: Core.Strapi): CoexistenceMode {
  let mode: CoexistenceMode = DEFAULT_COEXISTENCE;
  try {
    const plugin: any = strapi.plugin("strapi-mcp-suite");
    const fromCfg =
      typeof plugin?.config === "function"
        ? plugin.config("coexistence")
        : (strapi.config as any)?.get?.("plugin::strapi-mcp-suite.coexistence");
    if (typeof fromCfg === "string" && (COEXISTENCE_MODES as string[]).includes(fromCfg)) {
      mode = fromCfg as CoexistenceMode;
    }
  } catch {
    /* noop */
  }
  const envMode = process.env[COEXISTENCE_ENV];
  if (typeof envMode === "string" && (COEXISTENCE_MODES as string[]).includes(envMode)) {
    mode = envMode as CoexistenceMode;
  }
  return mode;
}

/**
 * Aplica la política de coexistencia sobre los flags. Función pura.
 *
 * Suprime contentOps cuando: el modo NO es "standalone", el nativo está activo,
 * contentOps estaba on, y NO hay un override explícito de env forzándolo (true).
 * El override de env y el modo "standalone" son las dos vías de escape.
 */
export function applyCoexistence(
  flags: FeatureFlags,
  opts: {
    coexistence: CoexistenceMode;
    nativeActive: boolean;
    envContentOps: boolean | undefined;
  }
): { flags: FeatureFlags; contentOpsSuppressed: boolean } {
  const out: FeatureFlags = { ...flags };
  const suppress =
    opts.coexistence !== "standalone" &&
    opts.nativeActive &&
    out.contentOps === true &&
    opts.envContentOps !== true;
  if (suppress) out.contentOps = false;
  return { flags: out, contentOpsSuppressed: suppress };
}

export interface RuntimeFlags {
  flags: FeatureFlags;
  coexistence: CoexistenceMode;
  nativeActive: boolean;
  contentOpsSuppressed: boolean;
}

/**
 * Flags efectivos en runtime: resuelve feature flags + aplica coexistencia con
 * el MCP nativo. Es lo que debe usar el server para decidir qué tools exponer.
 */
export function resolveRuntimeFlags(strapi: Core.Strapi): RuntimeFlags {
  const flags = resolveFeatureFlags(strapi);
  const coexistence = resolveCoexistence(strapi);
  const nativeActive = isNativeMcpActive(strapi);
  const envContentOps = parseBoolEnv(process.env.CONTENT_OPS_ENABLED);
  const applied = applyCoexistence(flags, { coexistence, nativeActive, envContentOps });
  return {
    flags: applied.flags,
    coexistence,
    nativeActive,
    contentOpsSuppressed: applied.contentOpsSuppressed,
  };
}
