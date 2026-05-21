# strapi-plugin-mcp-suite

> **Model Context Protocol server for Strapi v5**
> Expose your Strapi instance to LLM clients (Claude, Cursor, any MCP-compatible) for generic
> content management, visual layout configuration, schema authoring, media uploads and GraphQL
> testing — with native Strapi API token auth, multi-layer rate limiting and a forensic audit
> trail for every operation.

🇪🇸 [Leer en español](./README.es.md)

---

## TL;DR

Drop this plugin into any Strapi v5 project, create an API token, point your MCP client at
`/api/strapi-mcp/stream`. Your LLM can now read/write entries, reorganize admin UI layouts, generate
components and content-types (opt-in), upload media (opt-in) and execute GraphQL queries (opt-in) —
all through native Strapi APIs (`strapi.documents()`, lifecycle hooks, validation, draft & publish).

The plugin ships with hardened defaults: path traversal blocking, SSRF protection (AWS IMDS /
RFC1918 / DNS rebinding), rate limiting in 3 layers (per-token / per-user / per-IP), a fail-closed
production mode for schema authoring, and a forensic audit trail (token lifecycle + every operation)
with delete-permission enforcement on tokens.

---

## Features

### Built-in tools (33 total, organized by capability)

| Category | Tools | Notes |
|---|---|---|
| **Content ops** | `list_content_types`, `get_content_type_schema`, `find_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry` | Generic CRUD on any content-type. Delegates to `strapi.documents()`. Always available. |
| **Visual layout** | `get_visual_layout`, `set_field_layout`, `set_field_metadata`, `set_view_settings` | Modifies the Content Manager UI config (widths, labels, ordering). Stored in `strapi_core_store_settings`. **No restart required.** |
| **Schema authoring** | `list_existing_schemas`, `read_schema`, `validate_schema_proposal`, `create_component`, `create_content_type`, `add_field_to_schema`, `delete_field_from_schema` | Writes `.json` schemas and `.ts` stubs to filesystem. Requires Strapi restart for new schemas to load. **Gated by `SCHEMA_AUTHORING_ENABLED=true`.** Refused in production. |
| **Media / upload** | `list_media`, `get_media`, `upload_media_from_url`, `update_media_metadata`, `delete_media`, `link_media_to_entry` | URL-based uploads. Works with any Strapi provider (local, S3, Cloudinary, R2, etc.). **Gated by `UPLOAD_ENABLED=true`.** SSRF-protected. |
| **GraphQL** | `graphql_introspect`, `graphql_query`, `graphql_generate_query` | Test GraphQL queries, introspect the schema, generate queries from a content-type UID. Mutations require explicit `allow_mutations:true`. **Gated by `GRAPHQL_ENABLED=true`** and requires `@strapi/plugin-graphql` installed. |
| **Diagnostics** | `__health`, `__list_registered_tools` | Health ping (use after schema-authoring to confirm Strapi restarted) + registry inventory. Always available. |
| **Audit** | `__audit_token_creators`, `__audit_log_query` | Read-only views over the forensic audit tables (who created each token, every tool invocation with redacted args). **Requires super-admin.** Always exposed but always denies non-super-admin callers. |

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

The registry validates structure (snake_case naming, JSON Schema validity, no built-in name
collision) and optionally runs `testCases` to give you confidence before exposing the tool to the
LLM.

---

## Requirements

- **Strapi**: 5.0.0+ (5.45+ recommended for full anti-impersonation)
- **Node.js**: 20+ (uses built-in `fetch`, `crypto.subtle`, etc.)
- **MCP client**: Claude Desktop, Claude Code CLI, or any MCP-compatible client supporting
  streamable HTTP transport

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

- **Name**: include your email, e.g. `youremail@example.com - mcp client`. The plugin uses the email
  in the name (combined with `adminUserOwner`) for anti-impersonation and to attribute `createdBy` /
  `updatedBy` in entries created via MCP.
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

Claude Desktop only supports stdio transport, so you need
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge. In
`%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application
Support/Claude/claude_desktop_config.json` (macOS):

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

On Windows, use `npx.cmd` (not `npx`). After editing, fully quit Claude Desktop (system tray → Quit)
and reopen.

### 3. Try a first tool call

In Claude:

> *"List the content types in my Strapi instance and show me the fields of each."*

This invokes `list_content_types` and you should see your CTs (article, author, etc.) with their
attributes.

---

## Configuration

All configuration is via environment variables. See `.env.example` in the repo root for the complete
annotated list. Quick reference:

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
| `MCP_AUDIT_RETENTION_DAYS` | `90` | `op-log` rows older than this are deleted. `0` disables the age pass. |
| `MCP_AUDIT_MAX_ROWS` | `100000` | Cap on `op-log` rows. Oldest are trimmed first. `0` disables the cap. |
| `MCP_AUDIT_CLEANUP_INTERVAL_HOURS` | `24` | How often the cleanup job runs. Minimum `1`. |

---

## Security model

The plugin is designed assuming the LLM is **untrusted input** — prompt injection, poisoning, or
jailbreak could turn it into an adversary. Defenses:

### Authentication & granular permissions

- **Native Strapi API tokens** — no custom auth scheme to break. Reuses Strapi's hashing and
  storage.
- **Granular permission enforcement** — Custom tokens must have `plugin::strapi-mcp.stream.handle`
  explicitly marked. Tokens of type `Custom` without the MCP permission marked are rejected with
  `401 Custom token missing MCP permission`. `Full Access` and `Read Only` tokens pass by design
  (broader scope).
- **Best-effort attribution** — if the token has `adminUserOwner` populated (only happens for
  `kind='admin'` tokens with the experimental `features.future.adminTokens` flag), the plugin
  attributes `createdBy`/`updatedBy` on entries. For standard `content-api` tokens, attribution is
  null (see [Known limitations](#known-limitations)).

### Path traversal (schema authoring)

- All UID segments validated against `^[a-z][a-z0-9-]*$` before being used in `path.join`.
- Defense in depth: `assertWithinAllowedRoot()` ensures the resolved absolute path is under
  `src/api/` or `src/components/`.
- `writeFiles` performs a final containment check before any disk write.
- Backups go to `.strapi-mcp-backups/` (gitignored by default), preserving relative paths.

### SSRF (`upload_media_from_url`)

- Protocol allowlist: only `http://` and `https://`. Blocked: `file://`, `gopher://`, `javascript:`,
  `data:`, etc.
- IPv4 blocklist: loopback, RFC1918, CGNAT, link-local (including AWS IMDS `169.254.169.254`),
  Alibaba metadata (`100.100.100.0/24`), reserved ranges.
- IPv6 blocklist: `::1`, `fc00::/7` (ULA), `fe80::/10` (link-local), multicast, IPv4-mapped
  variants.
- DNS rebinding defense: hostnames are resolved and **all returned IPs** validated.
- Redirect chasing: `fetch` uses `redirect: 'manual'` and re-validates each hop (max 3 redirects).
- Per-environment override via `UPLOAD_URL_ALLOWED_HOSTS` (strict mode) or
  `UPLOAD_URL_EXTRA_BLOCKED_HOSTS` / `_CIDRS`.

### Rate limiting (3 layers)

| Layer | Default | Defends against |
|---|---|---|
| Per-token (SHA-256 of bearer) | 60 req/min | Leaked token abuse |
| Per-admin-user | 120 req/min | A user creating N tokens to bypass per-token |
| Per-IP | 300 req/min | Independent secondary layer; handles NAT'd teams |

Each layer is a sliding window. Any layer hitting its limit returns `429` with `Retry-After` and
`details.layer` identifying which limit fired.

### Production guardrails

- `isProduction()` is **fail-closed**: if `NODE_ENV` is not explicitly `development`, `test` or
  `dev`, schema authoring is refused. Docker containers without `NODE_ENV` get safe defaults.
- Schema authoring tools are hidden from `tools/list` unless `SCHEMA_AUTHORING_ENABLED=true`. Even
  if enabled, writers refuse in production.
- GraphQL mutations require explicit `allow_mutations: true` per call.
- Destructive operations (`delete_*`) require `confirm: true`.

### Audit trail (v0.4.0)

The plugin maintains two internal tables (hidden from Content Manager and Content-Type Builder, not
exposed via REST/GraphQL):

- **`mcp_token_audits`** — one row per API token. Captures `creator_id`, `creator_email`,
  `created_at_real`, and on deletion `deleter_id`, `deleter_email`, `deleted_at`. Tokens that
  existed before the plugin was installed are backfilled with `creator_email='unknown'` and
  `is_legacy=true`.
- **`mcp_op_logs`** — one row per `tools/call` over the MCP endpoint. Captures: `tool_name`,
  `status` (ok/error), `duration_ms`, `token_id`, `admin_user_id`, `admin_email`, `ip`,
  `user_agent`, `args_redacted` (args with secret-shaped keys replaced by `[REDACTED]`),
  `result_summary` (small extraction — `documentId`, `count`, `uid` — **never** the full payload),
  and `error_message` for failures.

**Delete-permission enforcement on `admin::api-token`:** a `beforeDelete` lifecycle hook blocks
deletion unless the caller is the original creator OR a super-admin. Legacy tokens require
super-admin. The deletion itself is recorded by `afterDelete`, so even authorized deletions leave a
trace.

**Retention:** `op-log` is bounded by both an age window (`MCP_AUDIT_RETENTION_DAYS`, default 90)
and a row cap (`MCP_AUDIT_MAX_ROWS`, default 100k). A cleanup job runs every
`MCP_AUDIT_CLEANUP_INTERVAL_HOURS` (default 24) in batches of 1000. Setting either limit to `0`
disables that pass — useful for tests, not recommended in production.

**Querying the audit:**

```jsonc
// Tool: __audit_token_creators
// Args: { include_deleted?: boolean = true, limit?: number (cap 500) }
// Returns: { count, tokens: [{token_id, token_name, token_type, creator_id, creator_email, created_at, deleter_id?, deleter_email?, deleted_at?, is_legacy}] }

// Tool: __audit_log_query
// Args: { token_id?, admin_user_id?, tool_name?, status?, since? (ISO), until? (ISO), limit?, include_payloads?: boolean = false }
// Returns: { count, filters, include_payloads, rows: [...] }
```

**Both tools require a super-admin caller.** Since standard `content-api` tokens have no admin user
resolved (see [Known limitations](#known-limitations)), invoking these tools in practice requires:
1. Strapi 5.45+ with `features.future.adminTokens: true` in `config/admin.ts`.
2. A token created from a super-admin session (so `adminUserOwner` populates with that user).

If your setup doesn't meet those conditions, you can still query the tables directly via SQL — the
data is captured regardless of whether the introspection tools are usable. Example:

```sql
SELECT tool_name, status, duration_ms, admin_email, ip, ts
FROM mcp_op_logs
WHERE ts > datetime('now', '-1 day')
ORDER BY ts DESC
LIMIT 100;
```

**What the audit does NOT do:** it does not *prevent* impersonation — that's structurally impossible
in standard Strapi 5.x (see Known limitations). It provides **forensic evidence** so an incident can
be reconstructed after the fact, and it raises the cost of "delete the evidence then deny" since the
delete itself is logged.

### What this plugin does NOT protect against

- **Compromise of the Strapi admin user that creates tokens** — out of scope; if the admin is
  compromised, the attacker can create tokens anyway. The audit will record the creation under that
  user, which helps post-incident.
- **Egress firewall bypass** — if your server can reach `169.254.169.254`, the plugin blocks but
  ideally your VPC also blocks. Defense in depth.
- **Distributed attacks across multiple instances** — rate limit is in-memory per instance. Use a
  CDN/proxy or Redis backend for cluster-wide limits.

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

Call this tool from your MCP client to see what's registered and the results of the last self-test
run for each custom tool. Useful for debugging.

---

## Testing

### Unit tests (Node built-in test runner)

```bash
cd src/plugins/strapi-mcp
npm test
```

145+ tests covering: URL safety (SSRF), schema validator (9 rules), path-lock (concurrency), writer
(path traversal defenses), registry (tool definition validation), rate limiting (sliding window,
multi-layer), schema derivation, content-ops handlers.

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

The security test exercises 18+ regression cases for C1 (path traversal), C3 (SSRF), H1 (GraphQL
auth), M1 (find_entries cap, GraphQL query bombs), rate limit, plus manual instructions for C2
(token impersonation) and H3 (backups location).

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
| `403 [strapi-mcp audit] Delete bloqueado` when deleting an API token | Caller is not the original creator and not super-admin | Log in as the creator or as a super-admin. If the token is legacy (created before v0.4.0), only super-admin can delete it. |
| `__audit_token_creators` returns `AUDIT_REQUIRES_SUPER_ADMIN` | Token has no admin user resolved (standard content-api tokens) | Activate `features.future.adminTokens: true` in `config/admin.ts` and create the audit-query token from a super-admin session; or query the `mcp_token_audits` / `mcp_op_logs` tables directly via SQL. |

---

## Deep population on reads (v0.5.0)

`find_entries` and `get_entry` accept two extra args to materialize a recursive populate tree
without you having to hand-craft it:

```jsonc
{
  "uid": "api::page.page",
  "populate_deep": true,
  "populate_depth": 4   // default 4, hard cap 6
}
```

When `populate_deep: true`, the plugin walks the live schema and builds a populate object that
expands every relation, component, dynamiczone and media field, recursing up to `populate_depth`
levels. Cycles are protected by a `visited` Set — bidirectional relations don't spin forever.

**Trade-offs:**
- Queries become larger and slower. Use only when you genuinely need the full context (e.g.
  rendering a page with all its dynzone sections expanded).
- The `pageSize` cap of 200 still applies, so worst-case is ~200 entries × the branching at each
  depth level.
- `populate` (the explicit object) is ignored when `populate_deep: true`. The response carries a
  `warning` field if you accidentally pass both.

System models (`admin::user`, `plugin::users-permissions.*`) are treated as shallow — large trees,
rarely useful from an MCP client.

## Schema strategies on writes (v0.5.0)

Strapi's Content-Type Builder UI doesn't allow editing a component that nests another component more
than 1 level deep. Before v0.5.0, the validator caught proposals exceeding this and returned an
error. Now it returns **strategies** — concrete alternatives the LLM can pick from.

When `create_component` receives a proposal triggering `NESTED_COMPONENT_DEPTH_EXCEEDED`, the
response shape is:

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

The three strategies:

| Strategy | What it does | When it's unavailable |
|---|---|---|
| `flat` | Inlines the nested component's attributes into the parent with a `${attrName}_` prefix. One file, no manual wiring. | Parent attr is `repeatable: true`, nested component doesn't exist, or prefixed names would collide. |
| `modular` | Writes the parent without the nested ref. Returns `wiring_instructions` with the JSON snippet the user must paste into the parent's schema manually. Maximum reusability. | Always available. |
| `dynamiczone` | Converts the offending attribute to a `dynamiczone` (resets Strapi's depth counter). | Not applicable when the proposal is a component (dynzones only live in content-types). |
| `as-proposed` (escape hatch) | Writes the schema EXACTLY as proposed, preserving the depth. The CTB UI rejects opening this component for editing, but Strapi's backend (DB, REST, GraphQL, lifecycle, populate) handles deeper nesting fine. | Always available — for users who know the limitation and prefer JSON-only editing. |

To materialize, re-call `create_component` with `strategy: 'flat' | 'modular' | 'dynamiczone' |
'as-proposed'`. The plugin applies the strategy, re-validates, and writes.

For a pure dry-run analysis without committing, use **`propose_schema_strategy`** — same input, no
disk writes, returns the same strategy list.

### Batch field additions: `add_fields_to_schema`

The singular `add_field_to_schema` triggers a Strapi restart per call (~12s downtime each). When
adding 2+ fields to the same schema, use the new **`add_fields_to_schema`** (plural) tool: it reads
the schema once, merges all fields, validates, and writes once → **one restart total**.

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

Atomic: if any field collides (within the batch or against existing attributes), the entire
operation aborts without writing. No partial states.

**Note**: Strategy support currently lives in `create_component` only. `create_content_type` and
`add_field_to_schema` will get the same fork in a future release.

### Full schema mutation in one restart: `modify_schema` (v0.6.0)

`modify_schema` is the most powerful schema tool — it combines **remove + add + update** into one
atomic write → **a single Strapi restart** instead of N:

```jsonc
{
  "uid": "molecules.feature-item",
  "remove": ["legacy_field"],
  "update": [{ "field_name": "count", "field": { "type": "biginteger" } }],
  "add":    [{ "field_name": "slug",  "field": { "type": "uid", "targetField": "title" } }]
}
```

- `remove[]` — field names to delete (refuses if a relation in another schema depends on them via
  `inversedBy`/`mappedBy`)
- `update[]` — replace a field's full definition. The way to change a field's `type` (e.g. `text →
  string`) without orchestrating delete-then-add.
- `add[]` — new fields (collision-checked)

Applied in order `remove → update → add`, validated as a whole, written once. Any failure aborts
everything — no partial states. Cross-list conflicts (a name in both `remove` and `add`, duplicates,
etc.) are caught before the filesystem is touched.

### Proactive atomization: `suggest_reusable_atoms` (v0.6.0)

Read-only analysis tool. Walks every component and content-type, counts repeated `(fieldName, type)`
patterns, and flags scalar fields worth promoting to reusable atom components — the classic case of
`title: string` copy-pasted into 8 sections.

```jsonc
{ "scope": "all", "min_occurrences": 3 }
```

For each strong candidate it returns the `used_in` list, a **starter atom schema** (with built-in
enrichment for known names — `title → atoms.heading` with tag/align, `icon → atoms.icon` with
size/color), and an `execution_plan` of concrete `create_component` + `modify_schema` calls you can
run after review. It also surfaces depth warnings (when a consumer is itself nested) and a
data-migration note. Never writes.

## Known limitations

### Schema-authoring chains can hang Claude Desktop via mcp-remote

When you call `add_field_to_schema` (or any schema-authoring tool), Strapi restarts in dev mode and
the MCP endpoint is unreachable for ~10-15s. Two compounding issues make this fragile when chaining
multiple operations from Claude Desktop:

1. **The LLM frequently ignores `restart_info.estimated_downtime_seconds`.** Observed in live
   testing: Claude received `estimated_downtime_seconds: 12` and called `__health` just 2 seconds
   later, hitting Strapi mid-restart. The plugin can only emit hints in the tool response — the
   protocol has no mechanism to block the next call for N seconds.
2. **The `mcp-remote` bridge gives up after 2 reconnection attempts.** Claude Desktop uses
   [mcp-remote](https://www.npmjs.com/package/mcp-remote) as an stdio↔HTTP bridge. When the endpoint
   returns `ECONNREFUSED` during the restart window, mcp-remote tries twice and then throws `Maximum
   reconnection attempts (2) exceeded`. Even when Strapi comes back, the session stays dead until
   Claude Desktop is fully restarted.

**Workarounds:**

- **Prefer batch operations.** Use `add_fields_to_schema` (plural) to apply N fields in one restart
  instead of N restarts. Same logic applies to `create_content_type` with all attributes defined up
  front. Each restart is one chance to lose the session — minimize the count.
- **Restart Claude Desktop completely** (system tray → Quit, NOT just close the window) if a chain
  fails mid-way. Reopening clears the dead bridge.
- **For projects with slow boot** (TypeScript types + many plugins + WSL/VMs), `restart_info` may
  underestimate. After a schema operation, wait ~25s manually before any next MCP interaction.
- **Consider Claude Code instead of Claude Desktop** for heavy schema-authoring sessions. Claude
  Code talks to the MCP server over HTTP directly (no stdio bridge) and handles `ECONNREFUSED` more
  gracefully.

This is a Claude Desktop + mcp-remote compatibility issue, not a plugin bug — the endpoint behaves
identically to any other HTTP service during restart. The audit log shows the operation succeeded
server-side even when the client sees a hung session.

### Anti-impersonation via `adminUserOwner` is not implemented

An earlier security audit identified a scenario: if a user with permission to create API tokens
names their token `"ceo@company.com - mcp"`, all writes via that token would be attributed to the
CEO via the email-in-token-name convention. The initial fix in 0.3.0 tried to mitigate this by
verifying the token's `adminUserOwner` field against the email in the name.

**Investigation in 0.3.1 revealed the mitigation is not feasible** in standard Strapi 5.x. The
`adminUserOwner` field is only populated for tokens of `kind='admin'` (a feature gated behind
`features.future.adminTokens: true` in `config/admin.ts` — experimental, not enabled by default).
Standard `content-api` tokens (the ones created from `Settings → API Tokens`) have `adminUserOwner`
forced to `null` by Strapi's admin service ([see
source](https://github.com/strapi/strapi/blob/main/packages/core/admin/server/src/services/api-token.ts)).

The check was removed in 0.3.1 because keeping it would generate false confidence — for the vast
majority of users, the policy would degrade to "no attribution" anyway without rejecting impostor
tokens.

**Workarounds if you need strict attribution per user:**

1. **Activate the experimental flag** in `config/admin.ts`:
   ```ts
   features: {
     future: { adminTokens: true }
   }
   ```
   Then create tokens via the `/admin/admin-tokens` REST endpoint (not the UI). Those tokens have `adminUserOwner` populated and the plugin attributes correctly.

2. **Enforce token naming convention via process**: have a policy where developers MUST include
   their own email in tokens they create. Audit token names periodically against admin user roster.
   This is process-based, not technical.

3. **Wait for Strapi to stabilize the feature**: when `adminTokens` graduates from "future" to a
   stable API, the plugin can rely on it for all installations.

### Other known limitations

- Rate limit is in-memory per instance. Multi-instance setups behind a load balancer don't share
  counters. Use a CDN/proxy rate limit or Redis backend (planned for future release).
- Schema authoring requires Strapi restart to take effect. The plugin tells the LLM to wait via
  `restart_info`, but cannot eliminate the restart itself (Strapi loads schemas in boot).
- GraphQL tools depend on `@strapi/plugin-graphql` being installed and `GRAPHQL_ENABLED=true`. If
  absent, tools are not exposed.

## Roadmap

- [x] npm publish: [strapi-plugin-mcp-suite](https://www.npmjs.com/package/strapi-plugin-mcp-suite)
- [x] Forensic audit trail (token lifecycle + operations) — v0.4.0
- [x] Deep populate on reads + progressive schema strategies on writes — v0.5.0
- [ ] Strapi marketplace approval
- [ ] Redis backend for rate limiting (multi-instance support)
- [ ] Admin UI panel for browsing the audit log
- [ ] Token rotation hooks
- [ ] More i18n-specific tools (`clone_entry_to_locale`, `list_locales`)
- [ ] `delete_content_type` with multi-step confirmation
- [ ] Re-implement anti-impersonation when Strapi stabilizes `adminTokens` future flag

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE) — Amilcar Coronado, 2026.
