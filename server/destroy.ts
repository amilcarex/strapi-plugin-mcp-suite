import type { Core } from "@strapi/strapi";
import { clearAuditCleanupHandle } from "./bootstrap";

export default ({ strapi }: { strapi: Core.Strapi }) => {
  // Clear the periodic op-log cleanup job. Without this, the setInterval would
  // keep the process alive after Strapi shutdown in some host environments.
  try {
    clearAuditCleanupHandle();
  } catch (err) {
    strapi.log.warn(`[strapi-mcp audit] error clearing cleanup job: ${String(err)}`);
  }
};
