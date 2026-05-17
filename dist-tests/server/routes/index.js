"use strict";
// URL final: /api/strapi-mcp/stream (POST + GET)
// Auth: API token vía header Authorization: Bearer <token>.
Object.defineProperty(exports, "__esModule", { value: true });
const policies = ["plugin::strapi-mcp.require-api-token"];
const middlewares = ["plugin::strapi-mcp.rate-limit"];
exports.default = {
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
