# strapi-plugin-mcp-suite

> **Servidor Model Context Protocol para Strapi v5**
> Expone tu instancia de Strapi a clientes LLM (Claude, Cursor, cualquier cliente MCP) para gestión genérica de contenido, configuración visual del admin, creación de schemas, uploads de media y testing de GraphQL — con autenticación por API tokens nativos de Strapi, defensa anti-impersonation y rate limiting en múltiples capas.

🇬🇧 [Read in English](./README.md)

---

## TL;DR

Pegá este plugin en cualquier proyecto Strapi v5, crea un API token, conecta tu cliente MCP a `/api/strapi-mcp/stream`. El LLM puede ahora leer y escribir entries, reorganizar layouts del admin, generar components y content-types (opt-in), subir media (opt-in) y ejecutar queries GraphQL (opt-in) — todo a través de las APIs nativas de Strapi (`strapi.documents()`, lifecycle hooks, validación, draft & publish).

El plugin viene con defaults endurecidos: bloqueo de path traversal, protección SSRF (AWS IMDS / RFC1918 / DNS rebinding), anti-impersonation de tokens, rate limiting en 3 capas (per-token / per-user / per-IP) y un modo fail-closed en producción para schema authoring.

---

## Features

### Tools built-in (31 en total, agrupadas por capacidad)

| Categoría | Tools | Notas |
|---|---|---|
| **Content ops** | `list_content_types`, `get_content_type_schema`, `find_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry` | CRUD genérico sobre cualquier content-type. Delega a `strapi.documents()`. Siempre disponibles. |
| **Visual layout** | `get_visual_layout`, `set_field_layout`, `set_field_metadata`, `set_view_settings` | Modifica la config del Content Manager (widths, labels, orden). Guardado en `strapi_core_store_settings`. **No requiere reinicio.** |
| **Schema authoring** | `list_existing_schemas`, `read_schema`, `validate_schema_proposal`, `create_component`, `create_content_type`, `add_field_to_schema`, `delete_field_from_schema` | Escribe schemas `.json` y stubs `.ts` al filesystem. Requiere reinicio de Strapi para que los schemas nuevos se carguen. **Gated por `SCHEMA_AUTHORING_ENABLED=true`.** Rechazado en producción. |
| **Media / upload** | `list_media`, `get_media`, `upload_media_from_url`, `update_media_metadata`, `delete_media`, `link_media_to_entry` | Uploads basados en URL. Funciona con cualquier provider de Strapi (local, S3, Cloudinary, R2, etc.). **Gated por `UPLOAD_ENABLED=true`.** Con protección SSRF. |
| **GraphQL** | `graphql_introspect`, `graphql_query`, `graphql_generate_query` | Testea queries GraphQL, introspecciona el schema, genera queries desde un UID de content-type. Mutations requieren `allow_mutations:true` explícito. **Gated por `GRAPHQL_ENABLED=true`** y requiere `@strapi/plugin-graphql` instalado. |
| **Diagnostics** | `__health`, `__list_registered_tools` | Ping de salud (úsalo después de schema-authoring para confirmar que Strapi reinició) + inventario del registry. Siempre disponibles. |

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

---

## Modelo de seguridad

El plugin está diseñado asumiendo que el LLM es **input no confiable** — prompt injection, poisoning, o jailbreak podrían convertirlo en adversario. Defensas:

### Autenticación y atribución

- **API tokens nativos de Strapi** — sin esquema de auth custom que pueda romperse. Reusa el hashing y storage de Strapi.
- **Anti-impersonation (Strapi 5.45+)** — si el name del token contiene un email, debe coincidir con el email del `adminUserOwner` del token. Previene que users con bajos privilegios nombren su token `ceo@empresa.com - ...` para atribuir escrituras al CEO.
- **Degradación elegante en Strapi <5.45** — `adminUserOwner` no existe; el plugin no atribuye (sin falsa confianza) y loguea un warning al boot sugiriendo upgrade.

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

### Lo que este plugin NO protege

- **Compromiso del admin user que crea tokens** — fuera de scope; si el admin está comprometido, el atacante puede crear tokens igual.
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

---

## Roadmap

- [ ] Publicar en npm como `@<scope>/strapi-plugin-mcp-suite`
- [ ] Submission al marketplace de Strapi
- [ ] Backend Redis para rate limiting (soporte multi-instancia)
- [ ] Hooks de rotación de tokens
- [ ] Más tools específicas de i18n (`clone_entry_to_locale`, `list_locales`)
- [ ] `delete_content_type` con confirmación multi-paso

---

## Contributing

Mira [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Licencia

[MIT](./LICENSE) — Amilcar Coronado, 2026.
