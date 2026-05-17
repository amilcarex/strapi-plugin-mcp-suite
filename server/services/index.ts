import registry from "./registry";

/**
 * Services del plugin strapi-mcp.
 *
 * - `registry`: registry de tools custom. Acceso desde el proyecto consumidor:
 *     strapi.plugin('strapi-mcp').service('registry').registerTool({...});
 *
 * El factory `createMcpServer` (en ./mcp-server) NO se expone como service
 * porque solo se usa internamente desde el controller stream.
 */
export default {
  registry,
};
