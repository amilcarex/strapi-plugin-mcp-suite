import tokenAudit from "./token-audit";
import opLog from "./op-log";

/**
 * Strapi expects this map to be keyed by the content-type's `singularName`
 * (info.singularName). The UID is then `plugin::strapi-mcp-suite.<singularName>`.
 *
 * Verified against `@strapi/plugin-users-permissions`
 * (`dist/server/content-types/index.js` exports `{ permission, role, user }`).
 */
export default {
  "token-audit": tokenAudit,
  "op-log": opLog,
};
