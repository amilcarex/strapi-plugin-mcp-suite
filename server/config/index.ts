import {
  FEATURE_DEFAULTS,
  COEXISTENCE_MODES,
  DEFAULT_COEXISTENCE,
  type FeatureFlags,
} from "../services/feature-flags";

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
  default: { ...FEATURE_DEFAULTS, coexistence: DEFAULT_COEXISTENCE },

  validator(config: Partial<Record<keyof FeatureFlags, unknown>> & { coexistence?: unknown }) {
    (Object.keys(FEATURE_DEFAULTS) as (keyof FeatureFlags)[]).forEach((key) => {
      const v = config[key];
      if (v !== undefined && typeof v !== "boolean") {
        throw new Error(
          `[strapi-mcp-suite] config.${key} debe ser boolean — recibido: ${typeof v} (${String(v)}).`
        );
      }
    });
    if (
      config.coexistence !== undefined &&
      !(COEXISTENCE_MODES as string[]).includes(config.coexistence as string)
    ) {
      throw new Error(
        `[strapi-mcp-suite] config.coexistence debe ser uno de: ${COEXISTENCE_MODES.join(
          ", "
        )} — recibido: ${String(config.coexistence)}.`
      );
    }
  },
};
