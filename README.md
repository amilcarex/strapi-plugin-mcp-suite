# strapi-plugin-mcp-suite

> **Model Context Protocol server for Strapi v5**
> Expose your Strapi instance to LLM clients (Claude, Cursor, any MCP-compatible) for generic content management, visual layout configuration, schema authoring, media uploads and GraphQL testing — with native Strapi API token auth, anti-impersonation and multi-layer rate limiting.

🇪🇸 [Leer en español](./README.es.md)

---

## TL;DR

Drop this plugin into any Strapi v5 project, create an API token, point your MCP client at `/api/strapi-mcp/stream`. Your LLM can now read/write entries, reorganize admin UI layouts, generate components and content-types (opt-in), upload media (opt-in) and execute GraphQL queries (opt-in) — all through native Strapi APIs (`strapi.documents()`, lifecycle hooks, validation, draft & publish).

The plugin ships with hardened defaults: path traversal blocking, SSRF protection (AWS IMDS / RFC1918 / DNS rebinding), token anti-impersonation, rate limiting in 3 layers (per-token / per-user / per-IP) and a fail-closed production mode for schema authoring.

---

## Features

### Built-in tools (31 total, organized by capability)

| Category | Tools | Notes |
|---|---|---|
| **Content ops** | `list_content_types`, `get_content_type_schema`, `find_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry` | Generic CRUD on any content-type. Delegates to `strapi.documents()`. Always available. |
| **Visual layout** | `get_visual_layout`, `set_field_layout`, `set_field_metadata`, `set_view_settings` | Modifies the Content Manager UI config (widths, labels, ordering). Stored in `strapi_core_store_settings`. **No restart required.** |
| **Schema authoring** | `list_existing_schemas`, `read_schema`, `validate_schema_proposal`, `create_component`, `create_content_type`, `add_field_to_schema`, `delete_field_from_schema` | Writes `.json` schemas and `.ts` stubs to filesystem. Requires Strapi restart for new schemas to load. **Gated by `SCHEMA_AUTHORING_ENABLED=true`.** Refused in production. |
| **Media / upload** | `list_media`, `get_media`, `upload_media_from_url`, `update_media_metadata`, `delete_media`, `link_media_to_entry` | URL-based uploads. Works with any Strapi provider (local, S3, Cloudinary, R2, etc.). **Gated by `UPLOAD_ENABLED=true`.** SSRF-protected. |
| **GraphQL** | `graphql_introspect`, `graphql_query`, `graphql_generate_query` | Test GraphQL queries, introspect the schema, generate queries from a content-type UID. Mutations require explicit `allow_mutations:true`. **Gated by `GRAPHQL_ENABLED=true`** and requires `@strapi/plugin-graphql` installed. |
| **Diagnostics** | `__health`, `__list_registered_tools` | Health ping (use after schema-authoring to confirm Strapi restarted) + registry inventory. Always available. |

### Extensibility

Custom tools registered from your project bootstrap appear alongside the built-ins:

```ts
strapi.plugin('strapi-mcp').service('registry').registerTool({
  name: 'my_custom_tool',
  description: '...',
  inputSchema: { ... },
  handler: async (ctx, args) => { ... },
  testCases: [ ... ],   // optional, run automatically in dev bootstrap
  tags: ['read'],
});
```

The registry validates structure (snake_case naming, JSON Schema validity, no built-in name collision) and optionally runs `testCases` to give you confidence before exposing the tool to the LLM.

---

## Requirements

- **Strapi**: 5.0.0+ (5.45+ recommended for full anti-impersonation)
- **Node.js**: 20+ (uses built-in `fetch`, `crypto.subtle`, etc.)
- **MCP client**: Claude Desktop, Claude Code CLI, or any MCP-compatible client supporting streamable HTTP transport

---

## Installation

Currently distributed via git only (npm publish coming soon):

```bash
# Clone the plugin into your Strapi project
cd <your-strapi-project>/src/plugins
git clone https://github.com/amilcarex/strapi-plugin-mcp-suite.git strapi-mcp

# Build the plugin's dist
cd strapi-mcp
npm install
npm run build
```

Then enable it in `config/plugins.ts`:

```ts
export default {
  'strapi-mcp': {
    enabled: true,
    resolve: './src/plugins/strapi-mcp',
  },
};
```

Restart Strapi. You should see:

```
[strapi-mcp] plugin loaded — endpoint /api/strapi-mcp/stream | strapi=5.46.0 | env=development | schema_authoring=disabled | upload=disabled | graphql=disabled
```

---

## Quick start

### 1. Create an API token

In the Strapi admin: **Settings → API Tokens → Create new API Token**.

- **Name**: include your email, e.g. `youremail@example.com - mcp client`. The plugin uses the email in the name (combined with `adminUserOwner`) for anti-impersonation and to attribute `createdBy` / `updatedBy` in entries created via MCP.
- **Token type**: `Full access` (recommended) or `Custom` with the content-types you want exposed.
- **Lifespan**: as your team requires.

Copy the token — it's shown only once.

### 2. Configure your MCP client

#### Claude Code (CLI)

Edit `~/.claude.json` or your client's config:

```json
{
  "mcpServers": {
    "strapi-local": {
      "url": "http://localhost:1337/api/strapi-mcp/stream",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

#### Claude Desktop (Windows / macOS)

Claude Desktop only supports stdio transport, so you need [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge. In `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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
        "AUTH_HEADER": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

On Windows, use `npx.cmd` (not `npx`). After editing, fully quit Claude Desktop (system tray → Quit) and reopen.

### 3. Try a first tool call

In Claude:

> *"List the content types in my Strapi instance and show me the fields of each."*

This invokes `list_content_types` and you should see your CTs (article, author, etc.) with their attributes.

---

## Configuration

All configuration is via environment variables. See `.env.example` in the repo root for the complete annotated list. Quick reference:

| Variable | Default | Purpose |
|---|---|---|
| `SCHEMA_AUTHORING_ENABLED` | `false` | Exposes the 7 schema-authoring tools (writes `.json` schemas to filesystem). Refused if `NODE_ENV` is production-ish. |
| `UPLOAD_ENABLED` | `false` | Exposes the 6 media library tools. Requires an upload provider configured. |
| `GRAPHQL_ENABLED` | `false` | Exposes the 3 GraphQL tools. Requires `@strapi/plugin-graphql` installed. |
| `MCP_RATE_LIMIT_PER_MIN` | `60` | Per-token rate limit (sliding window). |
| `MCP_RATE_LIMIT_PER_USER_PER_MIN` | `120` | Per-admin-user rate limit (sums all tokens of the same owner). Requires Strapi 5.45+. |
| `MCP_RATE_LIMIT_PER_IP_PER_MIN` | `300` | Per-origin-IP rate limit. Requires `proxy: true` in `config/server.ts` if behind a reverse proxy. |
| `MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window size (milliseconds). |
| `UPLOAD_URL_ALLOWED_HOSTS` | (empty) | Strict allowlist for `upload_media_from_url`. If set, only these hosts can be downloaded. |
| `UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES` | (empty) | Same as above but matches domain suffixes (e.g. `.amazonaws.com`). |
| `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` | (empty) | Additional hosts to block (extends the hardcoded blocklist). |
| `UPLOAD_URL_EXTRA_BLOCKED_CIDRS` | (empty) | Additional IPv4 CIDR ranges to block. |

---

## Security model

The plugin is designed assuming the LLM is **untrusted input** — prompt injection, poisoning, or jailbreak could turn it into an adversary. Defenses:

### Authentication & attribution

- **Native Strapi API tokens** — no custom auth scheme to break. Reuses Strapi's hashing and storage.
- **Anti-impersonation (Strapi 5.45+)** — if the token name contains an email, it must match the email of the `adminUserOwner` of the token. Prevents low-priv users from naming their token `ceo@company.com - ...` to attribute writes to the CEO.
- **Graceful degradation on Strapi <5.45** — `adminUserOwner` doesn't exist; the plugin doesn't attribute (no false trust) and logs a warning on boot suggesting upgrade.

### Path traversal (schema authoring)

- All UID segments validated against `^[a-z][a-z0-9-]*$` before being used in `path.join`.
- Defense in depth: `assertWithinAllowedRoot()` ensures the resolved absolute path is under `src/api/` or `src/components/`.
- `writeFiles` performs a final containment check before any disk write.
- Backups go to `.strapi-mcp-backups/` (gitignored by default), preserving relative paths.

### SSRF (`upload_media_from_url`)

- Protocol allowlist: only `http://` and `https://`. Blocked: `file://`, `gopher://`, `javascript:`, `data:`, etc.
- IPv4 blocklist: loopback, RFC1918, CGNAT, link-local (including AWS IMDS `169.254.169.254`), Alibaba metadata (`100.100.100.0/24`), reserved ranges.
- IPv6 blocklist: `::1`, `fc00::/7` (ULA), `fe80::/10` (link-local), multicast, IPv4-mapped variants.
- DNS rebinding defense: hostnames are resolved and **all returned IPs** validated.
- Redirect chasing: `fetch` uses `redirect: 'manual'` and re-validates each hop (max 3 redirects).
- Per-environment override via `UPLOAD_URL_ALLOWED_HOSTS` (strict mode) or `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` / `_CIDRS`.

### Rate limiting (3 layers)

| Layer | Default | Defends against |
|---|---|---|
| Per-token (SHA-256 of bearer) | 60 req/min | Leaked token abuse |
| Per-admin-user | 120 req/min | A user creating N tokens to bypass per-token |
| Per-IP | 300 req/min | Independent secondary layer; handles NAT'd teams |

Each layer is a sliding window. Any layer hitting its limit returns `429` with `Retry-After` and `details.layer` identifying which limit fired.

### Production guardrails

- `isProduction()` is **fail-closed**: if `NODE_ENV` is not explicitly `development`, `test` or `dev`, schema authoring is refused. Docker containers without `NODE_ENV` get safe defaults.
- Schema authoring tools are hidden from `tools/list` unless `SCHEMA_AUTHORING_ENABLED=true`. Even if enabled, writers refuse in production.
- GraphQL mutations require explicit `allow_mutations: true` per call.
- Destructive operations (`delete_*`) require `confirm: true`.

### What this plugin does NOT protect against

- **Compromise of the Strapi admin user that creates tokens** — out of scope; if the admin is compromised, the attacker can create tokens anyway.
- **Egress firewall bypass** — if your server can reach `169.254.169.254`, the plugin blocks but ideally your VPC also blocks. Defense in depth.
- **Distributed attacks across multiple instances** — rate limit is in-memory per instance. Use a CDN/proxy or Redis backend for cluster-wide limits.

---

## Extensibility: `registerTool`

Custom tools live in your project's `src/index.ts` bootstrap:

```ts
export default {
  register() {},
  bootstrap({ strapi }) {
    strapi.plugin('strapi-mcp').service('registry').registerTool({
      name: 'feature_article',
      description: 'Marks an article as featured (sets is_featured=true and featured_at=now). Useful when an editor wants to highlight content without opening the admin.',
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
        if (!current) throw new Error(`Article ${args.documentId} not found`);

        return strapi.documents(uid).update({
          documentId: args.documentId,
          data: args.unfeature
            ? { is_featured: false, featured_at: null }
            : { is_featured: true, featured_at: new Date().toISOString() },
        });
      },
      testCases: [
        { name: 'rejects unknown', args: { documentId: 'does-not-exist' }, expect: { errorMatches: /not found/ } },
      ],
      tags: ['write'],
    });
  },
};
```

The registry enforces:

- `name` is snake_case, 3-64 chars, doesn't collide with a built-in
- `description` is ≥30 chars (helps the LLM choose when to invoke)
- `inputSchema` is a valid JSON Schema with `additionalProperties: false`
- `required` references only fields present in `properties`
- `handler` is an async function
- `testCases` (optional) follow the expected shape

If validation fails, `registerTool` throws on boot with a detailed error message.

### Use `__list_registered_tools`

Call this tool from your MCP client to see what's registered and the results of the last self-test run for each custom tool. Useful for debugging.

---

## Testing

### Unit tests (Node built-in test runner)

```bash
cd src/plugins/strapi-mcp
npm test
```

145+ tests covering: URL safety (SSRF), schema validator (9 rules), path-lock (concurrency), writer (path traversal defenses), registry (tool definition validation), rate limiting (sliding window, multi-layer), schema derivation, content-ops handlers.

### Security smoke test (script against running Strapi)

```bash
export STRAPI_MCP_TOKEN=<your-token>
bash src/plugins/strapi-mcp/scripts/smoke-test.sh
```

Windows:

```powershell
$env:STRAPI_MCP_TOKEN = "<your-token>"
pwsh src/plugins/strapi-mcp/scripts/security-test.ps1
```

The security test exercises 18+ regression cases for C1 (path traversal), C3 (SSRF), H1 (GraphQL auth), M1 (find_entries cap, GraphQL query bombs), rate limit, plus manual instructions for C2 (token impersonation) and H3 (backups location).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Tool not appearing in client | Client cached `tools/list` from a previous session | Fully quit MCP client (system tray → Quit), reopen |
| `Tool "X" no encontrada` from new tool | Strapi runs the old plugin dist | Restart Strapi (`Ctrl+C` + `pnpm dev`); the plugin doesn't hot-reload |
| `401 Token name email mismatch` | Token name contains an email different from `adminUserOwner` email | Rename token to match the owner's email, or remove email from name |
| `URL_BLOCKED` on a legitimate URL | URL caught by SSRF blocklist | Add to `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` exception list, or switch to allowlist mode |
| `429 Too Many Requests` | Rate limit hit | Wait 60s, or raise `MCP_RATE_LIMIT_PER_MIN` in dev. Restart Strapi to wipe counters |
| Schema authoring fails with `SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION` even in dev | `NODE_ENV` not set | Explicitly set `NODE_ENV=development` in your `.env` |
| `Tool "graphql_query" no encontrada` | `GRAPHQL_ENABLED=false` or `@strapi/plugin-graphql` not installed | Enable + install the plugin |
| Behind a CDN/proxy, per-IP rate limit triggers immediately | All requests appear to come from the proxy IP | Set `proxy: true` in `config/server.ts` |

---

## Roadmap

- [ ] npm publish under `@<scope>/strapi-plugin-mcp-suite`
- [ ] Strapi marketplace submission
- [ ] Redis backend for rate limiting (multi-instance support)
- [ ] Token rotation hooks
- [ ] More i18n-specific tools (`clone_entry_to_locale`, `list_locales`)
- [ ] `delete_content_type` with multi-step confirmation

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE) — Amilcar Coronado, 2026.
