import * as fs from "fs/promises";
import * as path from "path";

/**
 * Orchestración de escritura al filesystem para schemas Strapi.
 *
 * Strapi v5 requiere CT en estructura:
 *   src/api/{name}/content-types/{name}/schema.json
 *   src/api/{name}/controllers/{name}.ts
 *   src/api/{name}/routes/{name}.ts
 *   src/api/{name}/services/{name}.ts
 *
 * Components en:
 *   src/components/{category}/{kebab-name}.json
 *
 * Todas las operaciones usan paths absolutos derivados del cwd de Strapi para
 * que funcionen tanto en dev como con cwd custom.
 */

export type FileToWrite = {
  path: string;
  content: string;
};

export type RestartInfo = {
  estimated_downtime_seconds: number;
  estimated_ready_at: string;
  what_happens: string;
  next_action_for_llm: string;
  verify_ready_with_tool: string;
  retry_strategy: string;
};

export type WriteResult = {
  written: string[];
  backed_up: string[];
  restart_required: true;
  restart_info: RestartInfo;
};

// Ventana conservadora: dev mode típicamente reinicia en 5-15s. 12s cubre la mayoría
// de proyectos pequeños/medianos. Proyectos grandes con muchos plugins pueden tardar más.
const ESTIMATED_DOWNTIME_SECONDS = 12;

export function buildRestartInfo(): RestartInfo {
  return {
    estimated_downtime_seconds: ESTIMATED_DOWNTIME_SECONDS,
    estimated_ready_at: new Date(Date.now() + ESTIMATED_DOWNTIME_SECONDS * 1000).toISOString(),
    what_happens:
      "Strapi (dev mode) detectará el cambio en src/api o src/components, recompilará TypeScript y reiniciará. El endpoint MCP estará inaccesible durante ese tiempo. En producción NO recarga — requiere redeploy.",
    next_action_for_llm: `🛑 STOP. NO llames NINGUNA otra tool de este servidor MCP durante los próximos ${ESTIMATED_DOWNTIME_SECONDS} segundos. Strapi está reiniciando. Si llamas antes, vas a recibir ECONNREFUSED y el bridge mcp-remote (Claude Desktop) puede colgarse permanentemente forzando reiniciar el cliente. Espera ${ESTIMATED_DOWNTIME_SECONDS}s COMPLETOS, después llama __health para confirmar que volvió. Si tenés que hacer múltiples modificaciones, agrupalas en UNA call: usa create_content_type con todos los attributes, o add_fields_to_schema (batch) en lugar de add_field_to_schema repetidamente.`,
    verify_ready_with_tool: "__health",
    retry_strategy:
      "Si la próxima llamada falla con ECONNREFUSED, timeout, o error de red, NO es un bug del plugin — es que Strapi todavía está reiniciando. Llama a __health cada 2-3 segundos hasta que responda; si después de 30s sigue fallando, hay un problema real (revisa logs de Strapi). KNOWN ISSUE: el bridge mcp-remote (usado por Claude Desktop) se rinde tras 2 reconexiones fallidas; si tu sesión queda muerta, reinicia Claude Desktop completo.",
  };
}

function projectRoot(): string {
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
export function safeSegment(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    const err = new Error(`INVALID_PATH_SEGMENT`) as any;
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
export function assertWithinAllowedRoot(absolutePath: string, allowedRoot: string): void {
  const resolvedPath = path.resolve(absolutePath);
  const resolvedRoot = path.resolve(allowedRoot);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSep)) {
    const err = new Error("PATH_ESCAPE_DETECTED") as any;
    err.details = {
      reason: `Resolved path "${resolvedPath}" escapes allowed root "${resolvedRoot}". This is a path traversal attempt and was blocked.`,
    };
    throw err;
  }
}

export const COMPONENTS_ROOT = () => path.join(projectRoot(), "src", "components");
export const API_ROOT = () => path.join(projectRoot(), "src", "api");

/**
 * Directorio donde se depositan los backups (.bak.{timestamp}) cuando un
 * writer sobrescribe un schema.json existente. Aislado del código de la app
 * y agregable al .gitignore para que no se committeen.
 */
export const BACKUPS_ROOT = () => path.join(projectRoot(), ".strapi-mcp-backups");

/**
 * Computa el path destino de un backup preservando la jerarquía relativa
 * al projectRoot. Ej: src/components/sections/hero.json → .strapi-mcp-backups/src/components/sections/hero.json.bak.<ts>
 *
 * Si el path original no está bajo projectRoot (no debería pasar si los
 * helpers respetaron containment), retorna null para abortar el backup.
 */
export function backupPathFor(originalAbsPath: string, timestamp: string): string | null {
  const root = projectRoot();
  const resolved = path.resolve(originalAbsPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  const relative = path.relative(root, resolved);
  return path.join(BACKUPS_ROOT(), `${relative}.bak.${timestamp}`);
}

export function pathsForComponent(category: string, name: string): FileToWrite[] {
  // Defensa contra path traversal: validar cada segmento antes de path.join.
  safeSegment(category, "component category");
  safeSegment(name, "component name");
  const filePath = path.join(COMPONENTS_ROOT(), category, `${name}.json`);
  // Defensa redundante: containment check sobre el path resultante.
  assertWithinAllowedRoot(filePath, COMPONENTS_ROOT());
  return [{ path: filePath, content: "" }];
}

export function pathsForContentType(singularName: string): {
  schema: string;
  controller: string;
  router: string;
  service: string;
} {
  safeSegment(singularName, "content-type singular name");
  const base = path.join(API_ROOT(), singularName);
  const paths = {
    schema: path.join(base, "content-types", singularName, "schema.json"),
    controller: path.join(base, "controllers", `${singularName}.ts`),
    router: path.join(base, "routes", `${singularName}.ts`),
    service: path.join(base, "services", `${singularName}.ts`),
  };
  for (const p of Object.values(paths)) {
    assertWithinAllowedRoot(p, API_ROOT());
  }
  return paths;
}

export function controllerStub(singularName: string): string {
  return `/**
 * ${singularName} controller — auto-generated by strapi-mcp.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::${singularName}.${singularName}');
`;
}

export function routerStub(singularName: string): string {
  return `/**
 * ${singularName} router — auto-generated by strapi-mcp.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::${singularName}.${singularName}');
`;
}

export function serviceStub(singularName: string): string {
  return `/**
 * ${singularName} service — auto-generated by strapi-mcp.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::${singularName}.${singularName}');
`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function writeFiles(
  files: FileToWrite[],
  opts: { backup: boolean }
): Promise<WriteResult> {
  // Defense-in-depth: si algún caller llega acá con un path fuera de src/api
  // o src/components, abortar antes de escribir nada. (pathsForComponent y
  // pathsForContentType ya validan, pero este check protege contra futuros
  // callers que no usen esos helpers.)
  const componentsRoot = COMPONENTS_ROOT();
  const apiRoot = API_ROOT();
  for (const file of files) {
    const resolved = path.resolve(file.path);
    const inComponents = resolved.startsWith(componentsRoot + path.sep) || resolved === componentsRoot;
    const inApi = resolved.startsWith(apiRoot + path.sep) || resolved === apiRoot;
    if (!inComponents && !inApi) {
      const err = new Error("WRITE_PATH_OUT_OF_BOUNDS") as any;
      err.details = {
        reason: `writeFiles refusing to write to "${resolved}" — not under src/api or src/components. Probable path traversal attempt.`,
      };
      throw err;
    }
  }

  const written: string[] = [];
  const backed_up: string[] = [];

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

export async function readJson(filePath: string): Promise<any> {
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
export function isProduction(): boolean {
  const env = (process.env.NODE_ENV ?? "").toLowerCase().trim();
  return !SAFE_NON_PROD_ENVS.has(env);
}

export function productionRefusal() {
  const err = new Error("SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION") as any;
  const envSeen = process.env.NODE_ENV ?? "(undefined)";
  err.details = {
    reason:
      `Schema authoring (create/update/delete de content-types y components) está deshabilitado fuera de ambientes "development"/"test". Detecté NODE_ENV="${envSeen}", lo tratamos como producción (fail-closed por defecto). ` +
      "Strapi v5 carga schemas en boot — los cambios en filesystem en prod no se reflejan sin redeploy. Haz los cambios en dev y despliega. " +
      "Si estás en dev pero NODE_ENV no está seteado (ej: en un container), exportá NODE_ENV=development.",
  };
  throw err;
}
