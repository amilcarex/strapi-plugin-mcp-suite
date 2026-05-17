"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
exports.default = ({ strapi }) => {
    var _a, _b, _c, _d;
    const authoring = process.env.SCHEMA_AUTHORING_ENABLED === "true";
    const upload = process.env.UPLOAD_ENABLED === "true";
    const graphql = process.env.GRAPHQL_ENABLED === "true";
    const env = (_a = process.env.NODE_ENV) !== null && _a !== void 0 ? _a : "development";
    const flagStatus = (label, on) => `${label}=${on ? "ENABLED" : "disabled"}`;
    // Detección de versión Strapi para warnings de compatibilidad.
    const strapiVersion = (_d = (_c = (_b = strapi.config) === null || _b === void 0 ? void 0 : _b.info) === null || _c === void 0 ? void 0 : _c.strapi) !== null && _d !== void 0 ? _d : "unknown";
    strapi.log.info(`[strapi-mcp] plugin loaded — endpoint /api/strapi-mcp/stream | strapi=${strapiVersion} | env=${env} | ${flagStatus("schema_authoring", authoring)} | ${flagStatus("upload", upload)} | ${flagStatus("graphql", graphql)}`);
    // Warning para versiones <5.45: el campo `adminUserOwner` en api-tokens no
    // existe, por lo que el plugin no puede aplicar anti-impersonation y degrada
    // a "no atribuir createdBy/updatedBy". Auth sigue funcionando pero los
    // entries creados via MCP quedan sin owner. Recomendar upgrade.
    const versionParts = strapiVersion.split(".").map((n) => parseInt(n, 10));
    const isOldVersion = versionParts.length >= 2 &&
        !isNaN(versionParts[0]) &&
        !isNaN(versionParts[1]) &&
        (versionParts[0] < 5 || (versionParts[0] === 5 && versionParts[1] < 45));
    if (isOldVersion) {
        strapi.log.warn(`[strapi-mcp] Strapi ${strapiVersion} es anterior a 5.45.0. El campo 'adminUserOwner' en api-tokens no existe, por lo que:\n` +
            `  - createdBy/updatedBy NO se autopueblan (atribución por usuario deshabilitada).\n` +
            `  - El check anti-impersonation de C2 no se aplica (no hay forma de verificar el dueño).\n` +
            `  Las tools del MCP funcionan normal, pero recomendamos upgrade a >=5.45.0 para tener atribución y seguridad completa.`);
    }
    // Si schema-authoring está habilitado, chequear que .strapi-mcp-backups/
    // esté en el .gitignore para evitar que se committeen accidentalmente.
    if (authoring) {
        const gitignorePath = path.join(process.cwd(), ".gitignore");
        fs.readFile(gitignorePath, "utf8")
            .then((content) => {
            if (!/\.strapi-mcp-backups\/?/.test(content)) {
                strapi.log.warn(`[strapi-mcp] schema_authoring=ENABLED pero ".strapi-mcp-backups/" no está en .gitignore. Los backups de schemas modificados pueden terminar committeados. Agregá la línea: .strapi-mcp-backups/`);
            }
        })
            .catch(() => {
            // .gitignore no existe — proyecto no usa git, no warneamos
        });
    }
    // Self-tests del registry de tools custom.
    //
    // Timing: el bootstrap del plugin corre ANTES del bootstrap del proyecto
    // consumidor (src/index.ts), donde el dev típicamente llama a registerTool.
    // Por eso schedulamos los self-tests via setImmediate — al momento de fire,
    // el event loop ya procesó el bootstrap del proyecto y las tools custom
    // están registradas.
    //
    // En producción, runSelfTests es no-op (skip silencioso). Cero overhead.
    setImmediate(async () => {
        try {
            const registry = strapi.plugin("strapi-mcp").service("registry");
            if (registry === null || registry === void 0 ? void 0 : registry.runSelfTests) {
                const summary = await registry.runSelfTests();
                if (summary.tested > 0) {
                    strapi.log.info(`[strapi-mcp registry] Self-tests: ${summary.tested}/${summary.total} tool(s) con testCases — ${summary.failures} con fallas`);
                }
            }
        }
        catch (err) {
            strapi.log.error(`[strapi-mcp registry] runSelfTests falló: ${String(err)}`);
        }
    });
};
