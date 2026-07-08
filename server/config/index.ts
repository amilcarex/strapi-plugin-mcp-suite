import {
  FEATURE_DEFAULTS,
  COEXISTENCE_MODES,
  DEFAULT_COEXISTENCE,
  CUSTOM_WRITE_POLICIES,
  DEFAULT_CUSTOM_WRITE,
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
  default: {
    ...FEATURE_DEFAULTS,
    coexistence: DEFAULT_COEXISTENCE,
    customTokenWrite: DEFAULT_CUSTOM_WRITE,
  },

  validator(
    config: Partial<Record<keyof FeatureFlags, unknown>> & {
      coexistence?: unknown;
      customTokenWrite?: unknown;
    }
  ) {
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
    if (
      config.customTokenWrite !== undefined &&
      !(CUSTOM_WRITE_POLICIES as string[]).includes(config.customTokenWrite as string)
    ) {
      throw new Error(
        `[strapi-mcp-suite] config.customTokenWrite debe ser uno de: ${CUSTOM_WRITE_POLICIES.join(
          ", "
        )} — recibido: ${String(config.customTokenWrite)}.`
      );
    }
  },
};
