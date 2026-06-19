/**
 * Metadata del plugin, derivada de una única fuente de verdad: el package.json.
 *
 * Antes la versión estaba hardcodeada en dos lugares (health-tools y mcp-server)
 * y se desincronizó (`__health` reportaba 0.5.0 con el package en 0.6.2). Acá se
 * lee del package.json en runtime para que no vuelva a pasar.
 *
 * El `require` se resuelve relativo al archivo COMPILADO:
 *   dist/server/plugin-meta.js        → ../../package.json = raíz del plugin
 *   dist-tests/server/plugin-meta.js  → ../../package.json = raíz del plugin
 * (misma profundidad en ambos outputs).
 */
function readVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("../../package.json");
    return typeof pkg?.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const PLUGIN_NAME = "strapi-mcp-suite";
export const PLUGIN_VERSION = readVersion();
