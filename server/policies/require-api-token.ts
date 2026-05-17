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

  // ── Atribución por usuario, ANTI-IMPERSONATION ──────────────────────────────
  //
  // Solo resolvemos el admin user cuando se cumplen LAS DOS condiciones:
  //   1. El token tiene `adminUserOwner` poblado (Strapi v5.45+ lo registra
  //      automáticamente al crear el token bajo la sesión de un admin).
  //   2. Si el `name` del token contiene un email, ese email DEBE coincidir
  //      con el email del `adminUserOwner`. Si no coincide, ignoramos el name
  //      (anti-suplantación: un admin no puede nombrar su token con el email
  //      de otro y atribuirle a otro las escrituras).
  //
  // Si las condiciones no se cumplen, NO atribuimos: el token sigue siendo
  // válido para auth, pero `ctx.state.user` queda sin setear y los entries
  // creados quedan sin `createdBy`/`updatedBy`.
  //
  // CROSS-VERSION COMPAT: en Strapi <5.45 el campo `adminUserOwner` no existe
  // en el schema de admin::api-token. El populate retorna undefined (o tira
  // en versiones muy viejas que no toleran populates de relaciones inexistentes).
  // En ese caso el plugin degrada a modo "no atribución" — auth válida pero
  // los entries quedan sin createdBy/updatedBy. El bootstrap loguea un warning
  // recomendando upgrade para tener anti-impersonation funcional.
  let resolvedAdminUser: any = null;
  const tokenName: string = (apiToken as any).name ?? "";
  const emailMatch = tokenName.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);

  // Recargar el token con adminUserOwner populated (el service no lo trae).
  // Protegido con try/catch para versiones Strapi <5.45 donde el campo no existe.
  let owner: any = null;
  try {
    const tokenWithOwner = await strapi.db.query("admin::api-token").findOne({
      where: { id: apiToken.id },
      populate: { adminUserOwner: { populate: { roles: true } } },
    });
    owner = (tokenWithOwner as any)?.adminUserOwner ?? null;
  } catch (err) {
    // En Strapi <5.45 el populate de un campo inexistente puede tirar.
    // Lo tratamos como "sin owner verificable" → no atribuir. Auth sigue OK.
    owner = null;
  }

  if (owner && emailMatch) {
    const emailFromName = emailMatch[0].toLowerCase();
    const ownerEmail = (owner.email ?? "").toLowerCase();

    if (emailFromName !== ownerEmail) {
      return rejectWith(
        "Token name email mismatch",
        `El email en el name del token ("${emailFromName}") no coincide con el del admin user dueño ("${ownerEmail}"). Por seguridad anti-suplantación, no se atribuye y se rechaza la request. Renombra el token con el email correcto, o quítale el email del name.`
      );
    }

    if (owner.isActive === false || owner.blocked === true) {
      return rejectWith(
        "API token owner is inactive or blocked",
        `El admin user dueño del token (${ownerEmail}) está desactivado o bloqueado. Pídele a un admin que lo reactive, o usa otro token.`
      );
    }

    resolvedAdminUser = owner;
  } else if (owner && !emailMatch) {
    // Token con dueño legítimo pero sin email en el name: atribución permitida
    // sin requerir match. Esto preserva tokens "de servicio" creados por un admin.
    if (owner.isActive === false || owner.blocked === true) {
      return rejectWith(
        "API token owner is inactive or blocked",
        `El admin user dueño del token está desactivado o bloqueado.`
      );
    }
    resolvedAdminUser = owner;
  }
  // Token sin adminUserOwner (legacy o de servicio): no atribuye. Auth válida igual.

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
