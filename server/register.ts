import type { Core } from "@strapi/strapi";

import { resolveCoexistence, isNativeMcpActive } from "./services/feature-flags";
import { registerIntoNativeMcp } from "./services/native-bridge";

export default ({ strapi }: { strapi: Core.Strapi }) => {
  // register phase — runs before bootstrap, before routes are mounted, y ANTES
  // de que el provider nativo haga `.start()`. Es la ventana correcta para
  // registrar tools en el MCP nativo (después tira).
  try {
    if (resolveCoexistence(strapi) === "extend-native" && isNativeMcpActive(strapi)) {
      registerIntoNativeMcp(strapi);
    }
  } catch (err) {
    strapi.log.warn(`[strapi-mcp] bridge al MCP nativo falló (se sigue con el endpoint standalone): ${String(err)}`);
  }
};
