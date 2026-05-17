"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = __importDefault(require("./registry"));
/**
 * Services del plugin strapi-mcp.
 *
 * - `registry`: registry de tools custom. Acceso desde el proyecto consumidor:
 *     strapi.plugin('strapi-mcp').service('registry').registerTool({...});
 *
 * El factory `createMcpServer` (en ./mcp-server) NO se expone como service
 * porque solo se usa internamente desde el controller stream.
 */
exports.default = {
    registry: registry_1.default,
};
