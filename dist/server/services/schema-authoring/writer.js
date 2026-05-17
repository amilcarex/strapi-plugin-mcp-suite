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
exports.BACKUPS_ROOT = exports.API_ROOT = exports.COMPONENTS_ROOT = void 0;
exports.buildRestartInfo = buildRestartInfo;
exports.safeSegment = safeSegment;
exports.assertWithinAllowedRoot = assertWithinAllowedRoot;
exports.backupPathFor = backupPathFor;
exports.pathsForComponent = pathsForComponent;
exports.pathsForContentType = pathsForContentType;
exports.controllerStub = controllerStub;
exports.routerStub = routerStub;
exports.serviceStub = serviceStub;
exports.writeFiles = writeFiles;
exports.readJson = readJson;
exports.isProduction = isProduction;
exports.productionRefusal = productionRefusal;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
// Ventana conservadora: dev mode típicamente reinicia en 5-15s. 12s cubre la mayoría
// de proyectos pequeños/medianos. Proyectos grandes con muchos plugins pueden tardar más.
const ESTIMATED_DOWNTIME_SECONDS = 12;
function buildRestartInfo() {
    return {
        estimated_downtime_seconds: ESTIMATED_DOWNTIME_SECONDS,
        estimated_ready_at: new Date(Date.now() + ESTIMATED_DOWNTIME_SECONDS * 1000).toISOString(),
        what_happens: "Strapi (dev mode) detectará el cambio en src/api o src/components, recompilará TypeScript y reiniciará. El endpoint MCP estará inaccesible durante ese tiempo. En producción NO recarga — requiere redeploy.",
        next_action_for_llm: `Espera al menos ${ESTIMATED_DOWNTIME_SECONDS} segundos antes de hacer otra operación. Si necesitas hacer múltiples cambios de schema, agrupalos en una sola call (ej: usa create_content_type con todos los attributes definidos, no llames add_field_to_schema repetidamente).`,
        verify_ready_with_tool: "__health",
        retry_strategy: "Si la próxima llamada falla con ECONNREFUSED, timeout, o error de red, NO es un bug del plugin — es que Strapi todavía está reiniciando. Llama a __health cada 2-3 segundos hasta que responda; si después de 30s sigue fallando, hay un problema real (revisa logs de Strapi).",
    };
}
function projectRoot() {
    // strapi's cwd es la raíz del proyecto en dev mode.
    return process.cwd();
}
/**
 * Valida que un segmento de UID/category/name sea seguro para usar como
 * fragmento de path en filesystem: kebab-case puro, sin `..`, `/`, `\` ni `\0`.
 *
 * Defensa contra path traversal — debe llamarse ANTES de cualquier path.join.
 */
const SAFE_SEGMENT = /^[a-z][a-z0-9-]*$/;
function safeSegment(value, label) {
    if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
        const err = new Error(`INVALID_PATH_SEGMENT`);
        err.details = {
            reason: `${label}="${String(value)}" no es kebab-case válido (^[a-z][a-z0-9-]*$). Path traversal blocked.`,
        };
        throw err;
    }
    return value;
}
/**
 * Containment check — verifica que un path absoluto resuelto cae dentro de un
 * directorio permitido. Defensa final contra cualquier path traversal que se
 * cuele por las validaciones de segmentos.
 */
function assertWithinAllowedRoot(absolutePath, allowedRoot) {
    const resolvedPath = path.resolve(absolutePath);
    const resolvedRoot = path.resolve(allowedRoot);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSep)) {
        const err = new Error("PATH_ESCAPE_DETECTED");
        err.details = {
            reason: `Resolved path "${resolvedPath}" escapes allowed root "${resolvedRoot}". This is a path traversal attempt and was blocked.`,
        };
        throw err;
    }
}
const COMPONENTS_ROOT = () => path.join(projectRoot(), "src", "components");
exports.COMPONENTS_ROOT = COMPONENTS_ROOT;
const API_ROOT = () => path.join(projectRoot(), "src", "api");
exports.API_ROOT = API_ROOT;
/**
 * Directorio donde se depositan los backups (.bak.{timestamp}) cuando un
 * writer sobrescribe un schema.json existente. Aislado del código de la app
 * y agregable al .gitignore para que no se committeen.
 */
const BACKUPS_ROOT = () => path.join(projectRoot(), ".strapi-mcp-backups");
exports.BACKUPS_ROOT = BACKUPS_ROOT;
/**
 * Computa el path destino de un backup preservando la jerarquía relativa
 * al projectRoot. Ej: src/components/sections/hero.json → .strapi-mcp-backups/src/components/sections/hero.json.bak.<ts>
 *
 * Si el path original no está bajo projectRoot (no debería pasar si los
 * helpers respetaron containment), retorna null para abortar el backup.
 */
function backupPathFor(originalAbsPath, timestamp) {
    const root = projectRoot();
    const resolved = path.resolve(originalAbsPath);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        return null;
    }
    const relative = path.relative(root, resolved);
    return path.join((0, exports.BACKUPS_ROOT)(), `${relative}.bak.${timestamp}`);
}
function pathsForComponent(category, name) {
    // Defensa contra path traversal: validar cada segmento antes de path.join.
    safeSegment(category, "component category");
    safeSegment(name, "component name");
    const filePath = path.join((0, exports.COMPONENTS_ROOT)(), category, `${name}.json`);
    // Defensa redundante: containment check sobre el path resultante.
    assertWithinAllowedRoot(filePath, (0, exports.COMPONENTS_ROOT)());
    return [{ path: filePath, content: "" }];
}
function pathsForContentType(singularName) {
    safeSegment(singularName, "content-type singular name");
    const base = path.join((0, exports.API_ROOT)(), singularName);
    const paths = {
        schema: path.join(base, "content-types", singularName, "schema.json"),
        controller: path.join(base, "controllers", `${singularName}.ts`),
        router: path.join(base, "routes", `${singularName}.ts`),
        service: path.join(base, "services", `${singularName}.ts`),
    };
    for (const p of Object.values(paths)) {
        assertWithinAllowedRoot(p, (0, exports.API_ROOT)());
    }
    return paths;
}
function controllerStub(singularName) {
    return `/**
 * ${singularName} controller — auto-generated by strapi-mcp.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::${singularName}.${singularName}');
`;
}
function routerStub(singularName) {
    return `/**
 * ${singularName} router — auto-generated by strapi-mcp.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::${singularName}.${singularName}');
`;
}
function serviceStub(singularName) {
    return `/**
 * ${singularName} service — auto-generated by strapi-mcp.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::${singularName}.${singularName}');
`;
}
async function fileExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function writeFiles(files, opts) {
    // Defense-in-depth: si algún caller llega acá con un path fuera de src/api
    // o src/components, abortar antes de escribir nada. (pathsForComponent y
    // pathsForContentType ya validan, pero este check protege contra futuros
    // callers que no usen esos helpers.)
    const componentsRoot = (0, exports.COMPONENTS_ROOT)();
    const apiRoot = (0, exports.API_ROOT)();
    for (const file of files) {
        const resolved = path.resolve(file.path);
        const inComponents = resolved.startsWith(componentsRoot + path.sep) || resolved === componentsRoot;
        const inApi = resolved.startsWith(apiRoot + path.sep) || resolved === apiRoot;
        if (!inComponents && !inApi) {
            const err = new Error("WRITE_PATH_OUT_OF_BOUNDS");
            err.details = {
                reason: `writeFiles refusing to write to "${resolved}" — not under src/api or src/components. Probable path traversal attempt.`,
            };
            throw err;
        }
    }
    const written = [];
    const backed_up = [];
    for (const file of files) {
        await fs.mkdir(path.dirname(file.path), { recursive: true });
        if (opts.backup && (await fileExists(file.path))) {
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            // Backups en .strapi-mcp-backups/<relative>.bak.<ts> en vez de junto al
            // archivo original. Mantiene src/api y src/components limpios de .bak.*,
            // y la carpeta se puede agregar a .gitignore para no committearlos.
            const backupPath = backupPathFor(file.path, ts);
            if (backupPath) {
                await fs.mkdir(path.dirname(backupPath), { recursive: true });
                await fs.copyFile(file.path, backupPath);
                backed_up.push(backupPath);
            }
        }
        await fs.writeFile(file.path, file.content, "utf8");
        written.push(file.path);
    }
    return {
        written,
        backed_up,
        restart_required: true,
        restart_info: buildRestartInfo(),
    };
}
async function readJson(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
}
/**
 * Devuelve true si el ambiente NO es claramente seguro para schema authoring.
 *
 * Fail-closed: si NODE_ENV no está definido o tiene un valor desconocido, lo
 * tratamos como producción. Esto cubre el caso común de containers Docker que
 * no setean NODE_ENV — sin este check, el plugin permitiría schema authoring
 * (escritura al filesystem) en deploys remotos por accidente.
 *
 * Solo "development" y "test" son tratados como ambientes seguros.
 */
const SAFE_NON_PROD_ENVS = new Set(["development", "test", "dev"]);
function isProduction() {
    var _a;
    const env = ((_a = process.env.NODE_ENV) !== null && _a !== void 0 ? _a : "").toLowerCase().trim();
    return !SAFE_NON_PROD_ENVS.has(env);
}
function productionRefusal() {
    var _a;
    const err = new Error("SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION");
    const envSeen = (_a = process.env.NODE_ENV) !== null && _a !== void 0 ? _a : "(undefined)";
    err.details = {
        reason: `Schema authoring (create/update/delete de content-types y components) está deshabilitado fuera de ambientes "development"/"test". Detecté NODE_ENV="${envSeen}", lo tratamos como producción (fail-closed por defecto). ` +
            "Strapi v5 carga schemas en boot — los cambios en filesystem en prod no se reflejan sin redeploy. Haz los cambios en dev y despliega. " +
            "Si estás en dev pero NODE_ENV no está seteado (ej: en un container), exportá NODE_ENV=development.",
    };
    throw err;
}
