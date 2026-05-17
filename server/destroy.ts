import type { Core } from "@strapi/strapi";

export default ({ strapi: _strapi }: { strapi: Core.Strapi }) => {
  // destroy phase — limpiar conexiones / transports MCP activos cuando se cierre Strapi.
};
