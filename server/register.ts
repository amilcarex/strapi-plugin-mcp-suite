import type { Core } from "@strapi/strapi";

export default ({ strapi: _strapi }: { strapi: Core.Strapi }) => {
  // register phase — runs before bootstrap, before routes are mounted.
};
