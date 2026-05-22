import type { Core } from "@strapi/strapi";

/**
 * Policy: requiere un API token de Strapi válido en el header Authorization.
 *
 * Validación:
 *  1. Header `Authorization: Bearer <token>` presente.
 *  2. El token hashea (HMAC-SHA512 con admin.apiToken.salt) a un registro
 *     existente en `strapi_api_tokens`.
 *  3. El token no está expirado.
 *  4. Si el `name` del token contiene un email, el admin user dueño existe y
 *     no está desactivado/bloqueado. En tal caso, se adjunta a `ctx.state.user`
 *     para que Strapi autopueble `createdBy`/`updatedBy` en operaciones.
 *
 * Por qué lanzamos un Error vanilla (no `throw errors.UnauthorizedError`):
 * en rutas type:"content-api", Strapi v5 aplica un error formatter que sobrescribe
 * el message/details de los errores estándar. Un Error vanilla con `status: 401`
 * + `expose: true` se serializa preservando el motivo exacto del rechazo.
 *
 * Setup desde el admin de Strapi:
 *   Settings → API Tokens → Create new API Token
 *   - Type: Full access (recomendado)
 *   - Name: <email-del-user> - <propósito>  (ej: amilcar@example.com - claude code)
 *   - Lifespan: lo que el equipo decida
 */

function rejectWith(message: string, reason: string): never {
  const err = new Error(message) as any;
  err.status = 401;
  err.statusCode = 401;
  err.expose = true;
  err.name = "UnauthorizedError";
  err.details = { reason };
  throw err;
}

export default async (
  policyContext: any,
  _config: unknown,
  { strapi }: { strapi: Core.Strapi }
): Promise<boolean> => {
  const ctx = policyContext;
  const authHeader: string | undefined =
    ctx.request?.headers?.authorization ?? ctx.request?.header?.authorization;

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return rejectWith(
      "Missing Authorization header",
      "Header 'Authorization: Bearer <token>' faltante o malformado. Pega tu API token de Strapi."
    );
  }

  const token = authHeader.slice("bearer ".length).trim();
  if (!token) {
    return rejectWith(
      "Empty bearer token",
      "Header 'Authorization: Bearer <token>' presente pero el token está vacío."
    );
  }

  const apiTokenService = strapi.service("admin::api-token") as any;
  if (!apiTokenService || typeof apiTokenService.hash !== "function") {
    return rejectWith(
      "Internal: api-token service unavailable",
      "El service 'admin::api-token' no está disponible o no expone hash(). Strapi puede haber cambiado su API interna — verificá la versión instalada (mínimo soportado: 5.0.0)."
    );
  }
  const accessKeyHash = apiTokenService.hash(token);

  // Cross-version compat: getByAccessKey existe en 5.x reciente; en versiones
  // anteriores era getBy({accessKey}). Si ninguna existe (API cambió mucho),
  // fallback final a db.query.
  let apiToken: any = null;
  try {
    if (typeof apiTokenService.getByAccessKey === "function") {
      apiToken = await apiTokenService.getByAccessKey(accessKeyHash);
    } else if (typeof apiTokenService.getBy === "function") {
      apiToken = await apiTokenService.getBy({ accessKey: accessKeyHash });
    } else {
      // Último recurso: query directa.
      apiToken = await strapi.db.query("admin::api-token").findOne({
        where: { accessKey: accessKeyHash },
      });
    }
  } catch (err) {
    return rejectWith(
      "Internal: api-token lookup failed",
      `Error consultando el token en la DB: ${(err as Error).message}. Verificá la versión de Strapi.`
    );
  }

  if (!apiToken) {
    return rejectWith(
      "Invalid API token",
      "El API token enviado no existe en strapi_api_tokens. Probablemente fue eliminado o nunca se creó. Crea uno nuevo en Settings → API Tokens."
    );
  }

  if (apiToken.expiresAt && apiToken.expiresAt < Date.now()) {
    return rejectWith(
      "API token expired",
      `El token "${apiToken.name}" expiró el ${new Date(apiToken.expiresAt).toISOString()}. Crea uno nuevo en Settings → API Tokens.`
    );
  }

  // ── Enforcement granular del permiso del plugin ─────────────────────────────
  //
  // Tipos de tokens en Strapi:
  //   - "full-access": tiene acceso a TODO sin restricción → pasa siempre
  //   - "read-only": tiene acceso a lecturas de toda la app → pasa (defensiva)
  //   - "custom": solo tiene los permisos explícitamente marcados → debe tener
  //     el permiso `plugin::strapi-mcp-suite.stream.handle` (o el que Strapi haya
  //     registrado para la ruta del MCP)
  //
  // Esto cierra el gap "alguien crea un token Custom marcando solo permisos
  // sobre Articles, ese token NO debería poder usar el endpoint MCP".
  // Sin este check, cualquier token válido pasaba — independientemente de
  // los permisos marcados.
  if (apiToken.type === "custom") {
    const tokenWithPermissions = await strapi.db.query("admin::api-token").findOne({
      where: { id: apiToken.id },
      populate: { permissions: true },
    });
    const actions: string[] = ((tokenWithPermissions as any)?.permissions ?? [])
      .map((p: any) => p.action)
      .filter(Boolean);

    // Strapi registra la ruta como acción del plugin con el patrón
    // `plugin::<plugin-name>.<controller>.<action>`. Para este plugin:
    // `plugin::strapi-mcp-suite.stream.handle`. Si Strapi renombra los plugin names
    // (ej: el dev configura el plugin con otro key), también aceptamos cualquier
    // acción que matchee el patrón `plugin::*.stream.handle` para defensiva.
    const hasMcpPermission = actions.some((action) =>
      action === "plugin::strapi-mcp-suite.stream.handle" ||
      /^plugin::[\w-]+\.stream\.handle$/.test(action)
    );

    if (!hasMcpPermission) {
      return rejectWith(
        "Custom token missing MCP permission",
        `El token "${apiToken.name}" es de tipo "custom" pero no tiene marcado el permiso del MCP. Para usarlo, edita el token en Settings → API Tokens → busca la sección "Strapi-mcp" (o como Strapi llame al plugin) y marca la acción "handle" bajo STREAM. Alternativa: cambia el token a type "Full access" o "Read-only".`
      );
    }
  }

  // ── Atribución por usuario (best-effort) ──────────────────────────────────
  //
  // Si el token tiene `adminUserOwner` populated, lo atribuimos a ctx.state.user
  // para que Strapi autopueble createdBy/updatedBy en operaciones via
  // strapi.documents(). Es best-effort: en Strapi 5.x con tokens content-api
  // estándar (los que se crean desde Settings → API Tokens), adminUserOwner
  // NUNCA está populated — el método create() del admin lo fuerza a null
  // (ver @strapi/admin/dist/server/server/src/services/api-token.js:541).
  //
  // Solo los tokens kind='admin' tienen el owner populated, pero esos requieren
  // activar la feature experimental `features.future.adminTokens: true` en
  // config/admin.ts — no es algo que la mayoría de usuarios tenga.
  //
  // KNOWN LIMITATION: anti-impersonation basado en el email del token name
  // (la idea: rechazar si el email del name no coincide con el adminUserOwner)
  // NO es viable en Strapi 5.x estándar porque el owner casi nunca está
  // populated. El plugin NO intenta ese check porque generaría falsa sensación
  // de seguridad. Ver README sección "Known limitations" para detalles y
  // cómo activar la future flag si necesitás atribución estricta.
  let resolvedAdminUser: any = null;
  let owner: any = null;
  try {
    const tokenWithOwner = await strapi.db.query("admin::api-token").findOne({
      where: { id: apiToken.id },
      populate: { adminUserOwner: { populate: { roles: true } } },
    });
    owner = (tokenWithOwner as any)?.adminUserOwner ?? null;
  } catch (err) {
    // En Strapi <5.45 el populate de un campo inexistente puede tirar.
    // Degradamos silenciosamente a "sin atribución".
    owner = null;
  }

  if (owner) {
    if (owner.isActive === false || owner.blocked === true) {
      return rejectWith(
        "API token owner is inactive or blocked",
        `El admin user dueño del token está desactivado o bloqueado. Pide a un admin que lo reactive, o usa otro token.`
      );
    }
    resolvedAdminUser = owner;
  }
  // Sin owner: no atribuye, auth sigue válida. Caso default en Strapi 5.x
  // con tokens content-api. Los entries creados via MCP quedan sin
  // createdBy/updatedBy. Aceptable trade-off documentado.

  ctx.state = ctx.state ?? {};
  ctx.state.auth = {
    strategy: { name: "api-token" },
    credentials: apiToken,
  };
  if (resolvedAdminUser) {
    ctx.state.user = resolvedAdminUser;
  }

  return true;
};
