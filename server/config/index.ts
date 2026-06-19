import { FEATURE_DEFAULTS, type FeatureFlags } from "../services/feature-flags";

/**
 * Config default + validator del plugin.
 *
 * Strapi mergea lo que el proyecto declara en `config/plugins.ts` bajo
 * `config: { … }` sobre estos defaults, valida con `validator`, y lo deja
 * accesible vía `strapi.plugin('strapi-mcp-suite').config(key)`.
 *
 * Los flags se resuelven en runtime con `resolveFeatureFlags` (que además
 * aplica las env vars como override). Ver `services/feature-flags.ts`.
 */
export default {
  default: { ...FEATURE_DEFAULTS } as FeatureFlags,

  validator(config: Partial<Record<keyof FeatureFlags, unknown>>) {
    (Object.keys(FEATURE_DEFAULTS) as (keyof FeatureFlags)[]).forEach((key) => {
      const v = config[key];
      if (v !== undefined && typeof v !== "boolean") {
        throw new Error(
          `[strapi-mcp-suite] config.${key} debe ser boolean — recibido: ${typeof v} (${String(v)}).`
        );
      }
    });
  },
};
