// URL final: /api/strapi-mcp-suite/stream (POST + GET)
// Auth: API token vía header Authorization: Bearer <token>.

const policies = ["plugin::strapi-mcp-suite.require-api-token"];
const middlewares = ["plugin::strapi-mcp-suite.rate-limit"];

export default {
  "content-api": {
    type: "content-api",
    routes: [
      {
        method: "GET",
        path: "/stream",
        handler: "stream.handle",
        config: { policies, middlewares, auth: false },
      },
      {
        method: "POST",
        path: "/stream",
        handler: "stream.handle",
        config: { policies, middlewares, auth: false },
      },
    ],
  },
};
