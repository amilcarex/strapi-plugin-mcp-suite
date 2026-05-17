import type { Core } from "@strapi/strapi";

/**
 * Definición de una tool MCP.
 *
 * - `name`: identificador único expuesto al cliente MCP.
 * - `description`: instrucciones para el LLM (qué hace, cuándo usarla, warnings).
 * - `inputSchema`: JSON Schema del input.
 * - `handler`: función async que recibe `{ strapi }` y los args. El resultado se
 *   envuelve automáticamente en formato MCP por `mcp-server.ts`.
 */
export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (ctx: ToolContext, args: TArgs) => Promise<TResult>;
}

export interface ToolContext {
  strapi: Core.Strapi;
  /**
   * Auth state propagado desde la policy require-api-token. Incluye el
   * apiToken validado y el admin user resuelto (si aplicaba). Las tools que
   * llaman a APIs sensibles (GraphQL, etc.) deben pasarlo al sub-sistema para
   * que las permission checks downstream usen el contexto correcto, en vez de
   * ejecutar con auth vacío.
   */
  auth?: {
    strategy?: { name: string };
    credentials?: any; // apiToken record
  };
  /** Admin user resuelto vía adminUserOwner del token, si existe. */
  user?: any;
}
