"use strict";
/**
 * Helpers compartidos por todos los tests.
 *
 * Mock factory para Strapi v5: emula los campos que el plugin lee
 * (contentTypes, components, db, plugin, service, log).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMockStrapi = makeMockStrapi;
exports.captureLogs = captureLogs;
exports.settleAll = settleAll;
function makeMockStrapi(opts = {}) {
    var _a, _b, _c, _d, _e;
    const logs = [];
    const log = {
        info: (...a) => logs.push({ level: "info", args: a }),
        warn: (...a) => logs.push({ level: "warn", args: a }),
        error: (...a) => logs.push({ level: "error", args: a }),
    };
    const defaultPlugins = {};
    if (opts.contentManagerService) {
        defaultPlugins["content-manager"] = {
            service: (svc) => svc === "content-types" || svc === "components" ? opts.contentManagerService : null,
        };
    }
    if (opts.uploadService) {
        defaultPlugins["upload"] = { service: () => opts.uploadService };
    }
    if (opts.graphqlPlugin) {
        defaultPlugins["graphql"] = opts.graphqlPlugin;
    }
    return {
        contentTypes: (_a = opts.contentTypes) !== null && _a !== void 0 ? _a : {},
        components: (_b = opts.components) !== null && _b !== void 0 ? _b : {},
        log,
        db: {
            query: (_c = opts.dbQueryImpl) !== null && _c !== void 0 ? _c : ((uid) => ({
                findOne: async () => null,
                findMany: async () => [],
            })),
        },
        documents: (_d = opts.documentsImpl) !== null && _d !== void 0 ? _d : ((_uid) => ({
            findMany: async () => [],
            findOne: async () => null,
            create: async () => ({}),
            update: async () => ({}),
            delete: async () => ({}),
            publish: async () => ({}),
            unpublish: async () => ({}),
            count: async () => 0,
        })),
        plugin: (name) => { var _a; return (_a = defaultPlugins[name]) !== null && _a !== void 0 ? _a : null; },
        service: (uid) => {
            var _a;
            if (uid === "admin::api-token")
                return (_a = opts.apiTokenService) !== null && _a !== void 0 ? _a : null;
            return null;
        },
        config: {
            info: { strapi: (_e = opts.strapiVersion) !== null && _e !== void 0 ? _e : "5.46.0" },
        },
    };
}
/** Captura los logs en orden para que los tests puedan assertear sobre ellos. */
function captureLogs(strapi) {
    var _a;
    return (_a = strapi.log.__captured) !== null && _a !== void 0 ? _a : [];
}
/** Wrapper para esperar varias promesas en paralelo y devolver sus settle states. */
async function settleAll(promises) {
    return Promise.allSettled(promises);
}
