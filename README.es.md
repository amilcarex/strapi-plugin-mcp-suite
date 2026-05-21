# strapi-plugin-mcp-suite

> **Servidor Model Context Protocol para Strapi v5**
> Expone tu instancia de Strapi a clientes LLM (Claude, Cursor, cualquier cliente MCP) para gestión genérica de contenido, configuración visual del admin, creación de schemas, uploads de media y testing de GraphQL — con autenticación por API tokens nativos de Strapi, rate limiting en múltiples capas y un audit trail forense de cada operación.

🇬🇧 [Read in English](./README.md)

---

## TL;DR

Pegá este plugin en cualquier proyecto Strapi v5, crea un API token, conecta tu cliente MCP a `/api/strapi-mcp/stream`. El LLM puede ahora leer y escribir entries, reorganizar layouts del admin, generar components y content-types (opt-in), subir media (opt-in) y ejecutar queries GraphQL (opt-in) — todo a través de las APIs nativas de Strapi (`strapi.documents()`, lifecycle hooks, validación, draft & publish).

El plugin viene con defaults endurecidos: bloqueo de path traversal, protección SSRF (AWS IMDS / RFC1918 / DNS rebinding), rate limiting en 3 capas (per-token / per-user / per-IP), modo fail-closed en producción para schema authoring, y un audit trail forense (lifecycle de tokens + cada operación) con enforcement de permisos para eliminar tokens.

---

## Features

### Tools built-in (33 en total, agrupadas por capacidad)

| Categoría | Tools | Notas |
|---|---|---|
| **Content ops** | `list_content_types`, `get_content_type_schema`, `find_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry` | CRUD genérico sobre cualquier content-type. Delega a `strapi.documents()`. Siempre disponibles. |
| **Visual layout** | `get_visual_layout`, `set_field_layout`, `set_field_metadata`, `set_view_settings` | Modifica la config del Content Manager (widths, labels, orden). Guardado en `strapi_core_store_settings`. **No requiere reinicio.** |
| **Schema authoring** | `list_existing_schemas`, `read_schema`, `validate_schema_proposal`, `create_component`, `create_content_type`, `add_field_to_schema`, `delete_field_from_schema` | Escribe schemas `.json` y stubs `.ts` al filesystem. Requiere reinicio de Strapi para que los schemas nuevos se carguen. **Gated por `SCHEMA_AUTHORING_ENABLED=true`.** Rechazado en producción. |
| **Media / upload** | `list_media`, `get_media`, `upload_media_from_url`, `update_media_metadata`, `delete_media`, `link_media_to_entry` | Uploads basados en URL. Funciona con cualquier provider de Strapi (local, S3, Cloudinary, R2, etc.). **Gated por `UPLOAD_ENABLED=true`.** Con protección SSRF. |
| **GraphQL** | `graphql_introspect`, `graphql_query`, `graphql_generate_query` | Testea queries GraphQL, introspecciona el schema, genera queries desde un UID de content-type. Mutations requieren `allow_mutations:true` explícito. **Gated por `GRAPHQL_ENABLED=true`** y requiere `@strapi/plugin-graphql` instalado. |
| **Diagnostics** | `__health`, `__list_registered_tools` | Ping de salud (úsalo después de schema-authoring para confirmar que Strapi reinició) + inventario del registry. Siempre disponibles. |
| **Audit** | `__audit_token_creators`, `__audit_log_query` | Vistas read-only sobre las tablas de auditoría forense (quién creó cada token, cada invocación de tool con args redactados). **Requiere super-admin.** Siempre expuestas pero rechazan a callers que no sean super-admin. |

### Extensibilidad

Las tools custom registradas desde el bootstrap del proyecto aparecen junto a las built-in:

```ts
strapi.plugin('strapi-mcp').service('registry').registerTool({
  name: 'my_custom_tool',
  description: '...',
  inputSchema: { ... },
  handler: async (ctx, args) => { ... },
  testCases: [ ... ],   // opcional, corren automáticamente en bootstrap dev
  tags: ['read'],
});
```

El registry valida la estructura (naming snake_case, JSON Schema válido, sin colisiones con built-ins) y opcionalmente corre `testCases` para darte confianza antes de exponer la tool al LLM.

---

## Requisitos

- **Strapi**: 5.0.0+ (5.45+ recomendado para anti-impersonation completa)
- **Node.js**: 20+ (usa `fetch` built-in, `crypto.subtle`, etc.)
- **Cliente MCP**: Claude Desktop, Claude Code CLI, o cualquier cliente MCP compatible con transport HTTP streamable

---

## Instalación

Por ahora se distribuye solo via git (npm publish próximamente):

```bash
# Clona el plugin a tu proyecto Strapi
cd <tu-proyecto-strapi>/src/plugins
git clone https://github.com/amilcarex/strapi-plugin-mcp-suite.git strapi-mcp

# Compila el dist del plugin
cd strapi-mcp
npm install
npm run build
```

Después habilitalo en `config/plugins.ts`:

```ts
export default {
  'strapi-mcp': {
    enabled: true,
    resolve: './src/plugins/strapi-mcp',
  },
};
```

Reinicia Strapi. Deberías ver:

```
[strapi-mcp] plugin loaded — endpoint /api/strapi-mcp/stream | strapi=5.46.0 | env=development | schema_authoring=disabled | upload=disabled | graphql=disabled
```

---

## Quick start

### 1. Crea un API token

En el admin de Strapi: **Settings → API Tokens → Create new API Token**.

- **Name**: incluye tu email, ej. `tuemail@ejemplo.com - mcp client`. El plugin usa el email en el name (combinado con `adminUserOwner`) para anti-impersonation y para atribuir `createdBy` / `updatedBy` en entries creados via MCP.
- **Token type**: `Full access` (recomendado) o `Custom` con los content-types que querés exponer.
- **Lifespan**: lo que tu equipo necesite.

Copia el token — se muestra una sola vez.

### 2. Configura tu cliente MCP

#### Claude Code (CLI)

Edita `~/.claude.json` o el config de tu cliente:

```json
{
  "mcpServers": {
    "strapi-local": {
      "url": "http://localhost:1337/api/strapi-mcp/stream",
      "headers": {
        "Authorization": "Bearer TU_TOKEN_AQUI"
      }
    }
  }
}
```

#### Claude Desktop (Windows / macOS)

Claude Desktop solo soporta transport stdio, así que necesitás [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) como bridge. En `%APPDATA%\Claude\claude_desktop_config.json` (Windows) o `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "strapi-local": {
      "command": "npx.cmd",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:1337/api/strapi-mcp/stream",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer TU_TOKEN_AQUI"
      }
    }
  }
}
```

En Windows, usa `npx.cmd` (no `npx`). Después de editar, cierra Claude Desktop por completo (bandeja del sistema → Quit) y vuelve a abrirlo.

### 3. Prueba una primera llamada

En Claude:

> *"Listame los content-types de mi instancia Strapi y mostrame los campos de cada uno."*

Esto invoca `list_content_types` y deberías ver tus CTs (article, author, etc.) con sus atributos.

---

## Configuración

Toda la configuración es via variables de entorno. Mira `.env.example` en la raíz del repo para la lista completa anotada. Referencia rápida:

| Variable | Default | Propósito |
|---|---|---|
| `SCHEMA_AUTHORING_ENABLED` | `false` | Expone las 7 tools de schema-authoring (escriben schemas `.json` al filesystem). Rechazado si `NODE_ENV` es production-ish. |
| `UPLOAD_ENABLED` | `false` | Expone las 6 tools del media library. Requiere un upload provider configurado. |
| `GRAPHQL_ENABLED` | `false` | Expone las 3 tools de GraphQL. Requiere `@strapi/plugin-graphql` instalado. |
| `MCP_RATE_LIMIT_PER_MIN` | `60` | Rate limit per-token (sliding window). |
| `MCP_RATE_LIMIT_PER_USER_PER_MIN` | `120` | Rate limit per-admin-user (suma todos los tokens del mismo owner). Requiere Strapi 5.45+. |
| `MCP_RATE_LIMIT_PER_IP_PER_MIN` | `300` | Rate limit per-IP de origen. Requiere `proxy: true` en `config/server.ts` si está detrás de un reverse proxy. |
| `MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Tamaño de la ventana deslizante (milisegundos). |
| `UPLOAD_URL_ALLOWED_HOSTS` | (vacío) | Allowlist estricta para `upload_media_from_url`. Si está seteada, solo estos hosts se pueden descargar. |
| `UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES` | (vacío) | Igual que el anterior pero matchea por sufijo de dominio (ej. `.amazonaws.com`). |
| `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` | (vacío) | Hosts adicionales a bloquear (extiende la blocklist hardcoded). |
| `UPLOAD_URL_EXTRA_BLOCKED_CIDRS` | (vacío) | Rangos IPv4 CIDR adicionales a bloquear. |
| `MCP_AUDIT_RETENTION_DAYS` | `90` | Filas de `op-log` más viejas que esto se eliminan. `0` desactiva la limpieza por edad. |
| `MCP_AUDIT_MAX_ROWS` | `100000` | Cap de filas en `op-log`. Las más viejas se trim primero. `0` desactiva el cap. |
| `MCP_AUDIT_CLEANUP_INTERVAL_HOURS` | `24` | Cada cuánto corre el cleanup job. Mínimo `1`. |

---

## Modelo de seguridad

El plugin está diseñado asumiendo que el LLM es **input no confiable** — prompt injection, poisoning, o jailbreak podrían convertirlo en adversario. Defensas:

### Autenticación y permisos granulares

- **API tokens nativos de Strapi** — sin esquema de auth custom que pueda romperse. Reusa el hashing y storage de Strapi.
- **Enforcement granular de permisos** — los tokens Custom deben tener `plugin::strapi-mcp.stream.handle` marcado explícitamente. Tokens tipo `Custom` sin el permiso del MCP marcado se rechazan con `401 Custom token missing MCP permission`. Los `Full Access` y `Read Only` pasan por diseño (scope más amplio).
- **Atribución best-effort** — si el token tiene `adminUserOwner` populated (solo ocurre para tokens `kind='admin'` con la flag experimental `features.future.adminTokens`), el plugin atribuye `createdBy`/`updatedBy` en los entries. Para tokens `content-api` estándar, la atribución queda null (ver [Limitaciones conocidas](#limitaciones-conocidas)).

### Path traversal (schema authoring)

- Todos los segmentos UID se validan contra `^[a-z][a-z0-9-]*$` antes de usarse en `path.join`.
- Defensa en profundidad: `assertWithinAllowedRoot()` asegura que el path absoluto resuelto está bajo `src/api/` o `src/components/`.
- `writeFiles` hace un containment check final antes de escribir.
- Los backups van a `.strapi-mcp-backups/` (gitignored por default), preservando paths relativos.

### SSRF (`upload_media_from_url`)

- Allowlist de protocolos: solo `http://` y `https://`. Bloqueados: `file://`, `gopher://`, `javascript:`, `data:`, etc.
- Blocklist IPv4: loopback, RFC1918, CGNAT, link-local (incluyendo AWS IMDS `169.254.169.254`), metadata Alibaba (`100.100.100.0/24`), rangos reservados.
- Blocklist IPv6: `::1`, `fc00::/7` (ULA), `fe80::/10` (link-local), multicast, variantes IPv4-mapped.
- Defensa anti DNS rebinding: los hostnames se resuelven y **todas las IPs devueltas** se validan.
- Manejo de redirects: `fetch` usa `redirect: 'manual'` y re-valida cada hop (max 3 redirects).
- Override por entorno via `UPLOAD_URL_ALLOWED_HOSTS` (modo strict) o `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` / `_CIDRS`.

### Rate limiting (3 capas)

| Capa | Default | Defiende contra |
|---|---|---|
| Per-token (SHA-256 del bearer) | 60 req/min | Abuse de token leakeado |
| Per-admin-user | 120 req/min | Un user creando N tokens para bypass del per-token |
| Per-IP | 300 req/min | Capa secundaria independiente; maneja equipos detrás de NAT |

Cada capa es una ventana deslizante. Cualquier capa que alcance su límite devuelve `429` con `Retry-After` y `details.layer` identificando cuál disparó.

### Salvaguardas en producción

- `isProduction()` es **fail-closed**: si `NODE_ENV` no es explícitamente `development`, `test` o `dev`, schema authoring se rechaza. Containers Docker sin `NODE_ENV` obtienen defaults seguros.
- Las tools de schema authoring están ocultas del `tools/list` salvo que `SCHEMA_AUTHORING_ENABLED=true`. Incluso habilitadas, los writers se rechazan en producción.
- GraphQL mutations requieren `allow_mutations: true` explícito por llamada.
- Operaciones destructivas (`delete_*`) requieren `confirm: true`.

### Audit trail (v0.4.0)

El plugin mantiene dos tablas internas (ocultas del Content Manager y del Content-Type Builder, no expuestas vía REST/GraphQL):

- **`mcp_token_audits`** — una fila por API token. Captura `creator_id`, `creator_email`, `created_at_real`, y al eliminarse `deleter_id`, `deleter_email`, `deleted_at`. Los tokens que ya existían antes de instalar el plugin se backfillean con `creator_email='unknown'` y `is_legacy=true`.
- **`mcp_op_logs`** — una fila por `tools/call` sobre el endpoint MCP. Captura: `tool_name`, `status` (ok/error), `duration_ms`, `token_id`, `admin_user_id`, `admin_email`, `ip`, `user_agent`, `args_redacted` (args con keys tipo `token`/`password`/`apiKey` reemplazadas por `[REDACTED]`), `result_summary` (extracción pequeña — `documentId`, `count`, `uid` — **nunca** el payload completo), y `error_message` en fallas.

**Enforcement de permisos al eliminar `admin::api-token`:** un lifecycle hook `beforeDelete` bloquea la eliminación a menos que el caller sea el creador original O un super-admin. Los tokens legacy requieren super-admin. La eliminación misma queda registrada por `afterDelete`, así que incluso las eliminaciones autorizadas dejan trail.

**Retención:** `op-log` está acotado por una ventana de edad (`MCP_AUDIT_RETENTION_DAYS`, default 90) y un cap de filas (`MCP_AUDIT_MAX_ROWS`, default 100k). Un cleanup job corre cada `MCP_AUDIT_CLEANUP_INTERVAL_HOURS` (default 24) en lotes de 1000. Setear cualquiera de los dos límites a `0` desactiva esa pasada — útil para tests, no recomendado en producción.

**Consultar el audit:**

```jsonc
// Tool: __audit_token_creators
// Args: { include_deleted?: boolean = true, limit?: number (cap 500) }
// Returns: { count, tokens: [{token_id, token_name, token_type, creator_id, creator_email, created_at, deleter_id?, deleter_email?, deleted_at?, is_legacy}] }

// Tool: __audit_log_query
// Args: { token_id?, admin_user_id?, tool_name?, status?, since? (ISO), until? (ISO), limit?, include_payloads?: boolean = false }
// Returns: { count, filters, include_payloads, rows: [...] }
```

**Ambas tools requieren un caller super-admin.** Como los tokens `content-api` estándar no resuelven admin user (ver [Limitaciones conocidas](#limitaciones-conocidas)), invocar estas tools en la práctica requiere:
1. Strapi 5.45+ con `features.future.adminTokens: true` en `config/admin.ts`.
2. Un token creado desde la sesión de un super-admin (para que `adminUserOwner` se popule con ese user).

Si tu setup no cumple esas condiciones, podés consultar las tablas directamente via SQL — los datos se capturan independientemente de si las tools de introspección funcionan. Ejemplo:

```sql
SELECT tool_name, status, duration_ms, admin_email, ip, ts
FROM mcp_op_logs
WHERE ts > datetime('now', '-1 day')
ORDER BY ts DESC
LIMIT 100;
```

**Lo que el audit NO hace:** no *previene* impersonación — eso es estructuralmente imposible en Strapi 5.x estándar (ver Limitaciones conocidas). Aporta **evidencia forense** para reconstruir un incidente post-mortem, y eleva el costo de "borro la evidencia y niego" porque la eliminación misma queda logueada.

### Lo que este plugin NO protege

- **Compromiso del admin user que crea tokens** — fuera de scope; si el admin está comprometido, el atacante puede crear tokens igual. El audit registrará la creación bajo ese user, lo que ayuda en post-incidente.
- **Bypass del egress firewall** — si tu server puede llegar a `169.254.169.254`, el plugin bloquea pero idealmente tu VPC también bloquea. Defensa en profundidad.
- **Ataques distribuidos en múltiples instancias** — el rate limit es in-memory por instancia. Usa CDN/proxy o backend Redis para límites a nivel cluster.

---

## Extensibilidad: `registerTool`

Las tools custom viven en el bootstrap de tu proyecto `src/index.ts`:

```ts
export default {
  register() {},
  bootstrap({ strapi }) {
    strapi.plugin('strapi-mcp').service('registry').registerTool({
      name: 'feature_article',
      description: 'Marca un artículo como destacado (setea is_featured=true y featured_at=now). Útil cuando un editor quiere destacar contenido sin abrir el admin.',
      inputSchema: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          unfeature: { type: 'boolean', default: false },
        },
        required: ['documentId'],
        additionalProperties: false,
      },
      handler: async ({ strapi }, args) => {
        const uid = 'api::article.article';
        const current = await strapi.documents(uid).findOne({ documentId: args.documentId });
        if (!current) throw new Error(`Article ${args.documentId} no encontrado`);

        return strapi.documents(uid).update({
          documentId: args.documentId,
          data: args.unfeature
            ? { is_featured: false, featured_at: null }
            : { is_featured: true, featured_at: new Date().toISOString() },
        });
      },
      testCases: [
        { name: 'rechaza inexistente', args: { documentId: 'no-existe' }, expect: { errorMatches: /no encontrado/ } },
      ],
      tags: ['write'],
    });
  },
};
```

El registry valida:

- `name` es snake_case, 3-64 chars, sin colisión con built-ins
- `description` es ≥30 chars (ayuda al LLM a elegir cuándo invocarla)
- `inputSchema` es JSON Schema válido con `additionalProperties: false`
- `required` referencia solo campos presentes en `properties`
- `handler` es una function async
- `testCases` (opcional) sigue el shape esperado

Si la validación falla, `registerTool` tira en boot con mensaje de error detallado.

### Usa `__list_registered_tools`

Llama esta tool desde tu cliente MCP para ver qué tools están registradas y los resultados del último self-test para cada tool custom. Útil para debugging.

---

## Testing

### Unit tests (Node built-in test runner)

```bash
cd src/plugins/strapi-mcp
npm test
```

145+ tests cubriendo: URL safety (SSRF), schema validator (9 reglas), path-lock (concurrencia), writer (defensas de path traversal), registry (validación de tool definitions), rate limiting (sliding window, multi-capa), schema derivation, handlers de content-ops.

### Security smoke test (script contra Strapi corriendo)

```bash
export STRAPI_MCP_TOKEN=<tu-token>
bash src/plugins/strapi-mcp/scripts/smoke-test.sh
```

Windows:

```powershell
$env:STRAPI_MCP_TOKEN = "<tu-token>"
pwsh src/plugins/strapi-mcp/scripts/security-test.ps1
```

El test de seguridad ejercita 18+ casos de regresión para C1 (path traversal), C3 (SSRF), H1 (GraphQL auth), M1 (find_entries cap, GraphQL query bombs), rate limit, más instrucciones manuales para C2 (token impersonation) y H3 (backups location).

---

## Troubleshooting

| Síntoma | Causa | Fix |
|---|---|---|
| Tool no aparece en el cliente | El cliente cacheó `tools/list` de una sesión anterior | Cierra el cliente MCP por completo (bandeja → Quit), reabrí |
| `Tool "X" no encontrada` con tool nueva | Strapi corre el dist viejo del plugin | Reinicia Strapi (`Ctrl+C` + `pnpm dev`); el plugin no hace hot-reload |
| `401 Token name email mismatch` | El name del token contiene un email distinto al del `adminUserOwner` | Renombra el token para que coincida con el email del owner, o quita el email del name |
| `URL_BLOCKED` en una URL legítima | URL atrapada por la blocklist SSRF | Agregalo a `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` como excepción, o cambia a modo allowlist |
| `429 Too Many Requests` | Rate limit alcanzado | Espera 60s, o sube `MCP_RATE_LIMIT_PER_MIN` en dev. Reiniciar Strapi limpia los contadores |
| Schema authoring falla con `SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION` incluso en dev | `NODE_ENV` no seteado | Setea explícitamente `NODE_ENV=development` en tu `.env` |
| `Tool "graphql_query" no encontrada` | `GRAPHQL_ENABLED=false` o `@strapi/plugin-graphql` no instalado | Habilita + instala el plugin |
| Detrás de un CDN/proxy, el rate limit per-IP dispara enseguida | Todas las requests parecen venir de la IP del proxy | Setea `proxy: true` en `config/server.ts` |
| `403 [strapi-mcp audit] Delete bloqueado` al eliminar un API token | El caller no es el creador original ni super-admin | Logueate como el creador o como super-admin. Si el token es legacy (creado antes de v0.4.0), solo super-admin puede eliminarlo. |
| `__audit_token_creators` devuelve `AUDIT_REQUIRES_SUPER_ADMIN` | El token no tiene admin user resuelto (tokens content-api estándar) | Activá `features.future.adminTokens: true` en `config/admin.ts` y creá el token de consulta desde una sesión super-admin; o consultá las tablas `mcp_token_audits` / `mcp_op_logs` directamente via SQL. |

---

## Populate profundo en lecturas (v0.5.0)

`find_entries` y `get_entry` aceptan dos parámetros adicionales para materializar un tree de populate recursivo sin necesidad de armarlo a mano:

```jsonc
{
  "uid": "api::page.page",
  "populate_deep": true,
  "populate_depth": 4   // default 4, tope duro 6
}
```

Con `populate_deep: true`, el plugin recorre el schema vivo y construye un objeto populate que expande cada relación, component, dynamiczone y media, recursionando hasta `populate_depth` niveles. Los ciclos se protegen con un Set `visited` — las relaciones bidireccionales no entran en loop infinito.

**Trade-offs:**
- Las queries quedan más grandes y lentas. Úsalo solo cuando realmente necesites el contexto completo (ej. renderizar una página con todas sus secciones de dynzone expandidas).
- El cap de `pageSize` de 200 sigue aplicando, así que el peor caso es ~200 entries × el branching en cada nivel de profundidad.
- Si pasas `populate_deep: true` y `populate` a la vez, `populate` se ignora y la respuesta incluye un `warning` aclarándolo.

Los modelos del sistema (`admin::user`, `plugin::users-permissions.*`) se tratan como shallow — son árboles grandes y raramente útiles desde un cliente MCP.

## Strategies de schema en escritura (v0.5.0)

El Content-Type Builder de Strapi no permite editar un component que anida otro component más allá de 1 nivel. Antes de v0.5.0, el validador atrapaba propuestas que excedían eso y devolvía un error. Ahora devuelve **strategies** — alternativas concretas que el LLM puede elegir.

Cuando `create_component` recibe una propuesta que dispara `NESTED_COMPONENT_DEPTH_EXCEEDED`, la respuesta es:

```jsonc
{
  "success": false,
  "validation": { ... },
  "strategies": [
    { "name": "flat", "available": true, "schema": { ... }, "trade_offs": [...] },
    { "name": "modular", "available": true, "schema": { ... }, "wiring_instructions": "...", "trade_offs": [...] },
    { "name": "dynamiczone", "available": false, "unavailable_reason": "..." }
  ],
  "hint": "Elige una estrategia (flat | modular | dynamiczone) y vuelve a llamar con `strategy: '<nombre>'`."
}
```

Las tres strategies:

| Strategy | Qué hace | Cuándo NO está disponible |
|---|---|---|
| `flat` | Inlinea los atributos del component nested dentro del padre con prefijo `${attrName}_`. Un solo archivo, sin wiring manual. | El atributo padre es `repeatable: true`, el nested no existe, o los nombres prefijados chocan con atributos existentes. |
| `modular` | Escribe el padre sin la referencia nested. Devuelve `wiring_instructions` con el snippet JSON que el usuario debe pegar manualmente en el schema del padre. Máxima reutilización. | Siempre disponible. |
| `dynamiczone` | Convierte el atributo en `dynamiczone` (resetea el contador de profundidad de Strapi). | No aplica cuando la propuesta es un component (los dynzones solo viven en content-types). |
| `as-proposed` (escape hatch) | Escribe el schema EXACTAMENTE como lo propusiste, preservando la profundidad. El CTB UI no va a poder abrir este component para editar, pero el backend de Strapi (DB, REST, GraphQL, lifecycle, populate) maneja anidamiento más profundo sin problemas. | Siempre disponible — para usuarios que conocen la limitación y prefieren editar via JSON. |

Para materializar, vuelves a llamar a `create_component` con `strategy: 'flat' | 'modular' | 'dynamiczone' | 'as-proposed'`. El plugin aplica la estrategia, re-valida y escribe.

Para un dry-run puro sin escribir nada, usa **`propose_schema_strategy`** — mismo input, sin tocar disco, devuelve la misma lista de strategies.

### Agregar varios campos en batch: `add_fields_to_schema`

El singular `add_field_to_schema` dispara un restart de Strapi por llamada (~12s de downtime cada vez). Cuando agregas 2+ campos al mismo schema, usá la nueva tool **`add_fields_to_schema`** (plural): lee el schema una vez, mergea todos los fields, valida y escribe una vez → **un solo restart en total**.

```jsonc
{
  "uid": "api::page.page",
  "fields": [
    { "field_name": "subtitle", "field": { "type": "string" } },
    { "field_name": "slug",     "field": { "type": "uid", "targetField": "subtitle" } },
    { "field_name": "cover",    "field": { "type": "media" } }
  ]
}
```

Atómica: si CUALQUIER field colisiona (dentro del batch o contra los atributos existentes), toda la operación aborta sin escribir nada. Sin estados parciales.

**Nota**: Por ahora el soporte de strategies vive solo en `create_component`. `create_content_type` y `add_field_to_schema` van a sumar el mismo fork en una release futura.

## Limitaciones conocidas

### Cadenas de schema-authoring pueden colgar Claude Desktop vía mcp-remote

Cuando llamas a `add_field_to_schema` (o cualquier tool de schema-authoring), Strapi reinicia en dev mode y el endpoint MCP queda inaccesible durante ~10-15s. Dos issues compuestos hacen esto frágil al encadenar varias operaciones desde Claude Desktop:

1. **El LLM frecuentemente ignora `restart_info.estimated_downtime_seconds`.** Observado en testing en vivo: Claude recibió `estimated_downtime_seconds: 12` y llamó a `__health` solo 2 segundos después, pegando contra Strapi en pleno restart. El plugin solo puede emitir hints en el tool response — el protocolo MCP no tiene mecanismo para bloquear la siguiente llamada por N segundos.
2. **El bridge `mcp-remote` se rinde tras 2 intentos de reconexión.** Claude Desktop usa [mcp-remote](https://www.npmjs.com/package/mcp-remote) como bridge stdio↔HTTP. Cuando el endpoint devuelve `ECONNREFUSED` durante el restart, mcp-remote reintenta 2 veces y tira `Maximum reconnection attempts (2) exceeded`. Aunque Strapi vuelva, la sesión queda muerta hasta que reinicies Claude Desktop completo.

**Workarounds:**

- **Preferí operaciones batch.** Usá `add_fields_to_schema` (plural) para aplicar N campos en un restart en vez de N restarts. La misma lógica vale para `create_content_type` con todos los atributos definidos de entrada. Cada restart es una oportunidad de perder la sesión — minimizá el conteo.
- **Reiniciá Claude Desktop completo** (system tray → Quit, NO solo cerrar la ventana) si una cadena falla a mitad. Reabrirlo limpia el bridge muerto.
- **Para proyectos con boot lento** (TypeScript types + muchos plugins + WSL/VMs), `restart_info` puede subestimar. Después de una op de schema, esperá ~25s manualmente antes de cualquier siguiente interacción MCP.
- **Considerá Claude Code en vez de Claude Desktop** para sesiones intensivas de schema-authoring. Claude Code habla al servidor MCP directamente vía HTTP (sin bridge stdio) y maneja `ECONNREFUSED` con más gracia.

Esto es un issue de compatibilidad Claude Desktop + mcp-remote, no un bug del plugin — el endpoint se comporta igual que cualquier otro servicio HTTP durante un restart. El audit log muestra que la operación se completó server-side aunque el cliente vea sesión colgada.

### Anti-impersonation vía `adminUserOwner` no está implementado

Un security audit temprano identificó un escenario: si un usuario con permiso para crear API tokens nombra su token `"ceo@empresa.com - mcp"`, todas las escrituras vía ese token quedarían atribuidas al CEO via la convención email-en-token-name. El fix inicial en 0.3.0 intentó mitigar esto verificando el campo `adminUserOwner` del token contra el email en el name.

**La investigación en 0.3.1 reveló que la mitigación no es viable** en Strapi 5.x estándar. El campo `adminUserOwner` solo se popula para tokens `kind='admin'` (una feature detrás de `features.future.adminTokens: true` en `config/admin.ts` — experimental, no habilitada por default). Los tokens `content-api` estándar (los creados desde `Settings → API Tokens`) tienen `adminUserOwner` forzado a `null` por el admin service de Strapi ([ver source](https://github.com/strapi/strapi/blob/main/packages/core/admin/server/src/services/api-token.ts)).

El check se removió en 0.3.1 porque mantenerlo generaría falsa confianza — para la mayoría de usuarios, la policy degradaría a "sin atribución" igual sin rechazar tokens impostores.

**Workarounds si necesitás atribución estricta por usuario:**

1. **Activar la flag experimental** en `config/admin.ts`:
   ```ts
   features: {
     future: { adminTokens: true }
   }
   ```
   Después crear los tokens via el endpoint REST `/admin/admin-tokens` (no la UI). Esos tokens sí tienen `adminUserOwner` populated y el plugin atribuye correctamente.

2. **Enforce convención de naming via proceso**: tener una policy donde los devs DEBEN incluir su propio email en los tokens que crean. Auditar nombres periódicamente. Esto es process-based, no técnico.

3. **Esperar a que Strapi estabilice la feature**: cuando `adminTokens` graduate de "future" a API estable, el plugin va a poder usarlo para todas las instalaciones.

### Otras limitaciones conocidas

- Rate limit es in-memory por instancia. Setups multi-instancia detrás de un load balancer no comparten contadores. Usá rate limit a nivel CDN/proxy o backend Redis (planeado para release futuro).
- Schema authoring requiere reinicio de Strapi para tomar efecto. El plugin le avisa al LLM via `restart_info`, pero no puede eliminar el reinicio en sí (Strapi carga schemas en boot).
- Las tools de GraphQL dependen de `@strapi/plugin-graphql` instalado y `GRAPHQL_ENABLED=true`. Si no, las tools no se exponen.

## Roadmap

- [x] Publicar en npm: [strapi-plugin-mcp-suite](https://www.npmjs.com/package/strapi-plugin-mcp-suite)
- [x] Audit trail forense (lifecycle de tokens + operaciones) — v0.4.0
- [x] Deep populate en lecturas + strategies progresivas de schema en escritura — v0.5.0
- [ ] Aprobación del marketplace de Strapi
- [ ] Backend Redis para rate limiting (soporte multi-instancia)
- [ ] Panel admin UI para navegar el audit log
- [ ] Hooks de rotación de tokens
- [ ] Más tools específicas de i18n (`clone_entry_to_locale`, `list_locales`)
- [ ] `delete_content_type` con confirmación multi-paso
- [ ] Re-implementar anti-impersonation cuando Strapi estabilice la flag `adminTokens`

---

## Contributing

Mira [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Licencia

[MIT](./LICENSE) — Amilcar Coronado, 2026.
