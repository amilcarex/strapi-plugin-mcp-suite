# Changelog

All notable changes to `strapi-plugin-mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- npm publish
- Strapi marketplace submission
- Redis backend for multi-instance rate limiting
- `delete_content_type` with multi-step confirmation
- i18n-specific tools

## [0.3.0] - 2026-05-17

### Security
- **Critical: Path traversal in schema authoring tools fixed.** `add_field_to_schema` and `delete_field_from_schema` were vulnerable to filesystem writes outside `src/api/` and `src/components/` if the LLM passed a malicious UID (e.g. `../../etc/passwd`). Now every UID segment is validated against `^[a-z][a-z0-9-]*$` before any `path.join`, and `writeFiles` performs a final containment check.
- **Critical: Token impersonation via name parsing fixed.** Previous behavior parsed the email from the token name and looked up the admin user by email — allowing any user with token-creation permission to name their token with another admin's email and attribute writes to them. Now requires the email to match the `adminUserOwner` of the token (Strapi 5.45+ field). Tokens with mismatched email are rejected with `401 Token name email mismatch`. On Strapi <5.45, attribution gracefully degrades (no false trust).
- **Critical: SSRF in `upload_media_from_url` fixed.** Previously `fetch()` was called with no URL validation, allowing exfiltration of AWS IMDS / GCP / Alibaba metadata credentials by uploading them as media files. Added protocol allowlist (http/https only), IPv4/IPv6 range blocklist (RFC1918, loopback, link-local, metadata endpoints), DNS rebinding defense, and manual redirect chasing with re-validation per hop. Configurable via `UPLOAD_URL_ALLOWED_HOSTS`, `UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES`, `UPLOAD_URL_EXTRA_BLOCKED_HOSTS`, `UPLOAD_URL_EXTRA_BLOCKED_CIDRS`.
- **High: GraphQL auth context fixed.** `graphql_query` was passing an empty `auth: {}` context to resolvers, bypassing per-content-type permission checks. Now plumbs `ctx.state.auth` and `ctx.state.user` through `createMcpServer` to the handler.
- **High: Race condition in schema authoring fixed.** Concurrent `add_field_to_schema` / `delete_field_from_schema` on the same file caused lost writes. Added per-path mutex (`acquirePathLock`) that serializes read-modify-write.
- **High: Backups location hardened.** `.bak.{timestamp}` files now go to `.strapi-mcp-backups/` (gitignored by default) preserving relative paths, instead of beside the original. Added `.gitignore` warning on boot if the entry is missing.
- **Medium: Rate limiting added (3 layers).** Per-token (60/min default), per-admin-user (120/min), per-IP (300/min). Sliding window, in-memory. Configurable via env vars. Returns `429` with `Retry-After` header.
- **Medium: GraphQL query bombs mitigated.** `graphql_query` now rejects queries exceeding 16KB, depth 10, or 50 aliases.
- **Medium: `find_entries` page size capped at 200.** Prevents memory exhaustion via massive paginated queries.
- **Medium: `isProduction()` now fail-closed.** Treats undefined / unknown `NODE_ENV` as production. Docker containers without explicit `NODE_ENV` no longer enable schema authoring by default.

### Added
- New env vars: `MCP_RATE_LIMIT_PER_MIN`, `MCP_RATE_LIMIT_PER_USER_PER_MIN`, `MCP_RATE_LIMIT_PER_IP_PER_MIN`, `MCP_RATE_LIMIT_WINDOW_MS`, `UPLOAD_URL_ALLOWED_HOSTS`, `UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES`, `UPLOAD_URL_EXTRA_BLOCKED_HOSTS`, `UPLOAD_URL_EXTRA_BLOCKED_CIDRS`.
- `restart_info` structured response in schema-authoring tools: includes `estimated_downtime_seconds`, `next_action_for_llm`, `retry_strategy` — tells the LLM how to wait for Strapi to come back after a schema change.
- `__health` tool: lightweight ping returning plugin/Strapi version, uptime, flags. Use after schema authoring to confirm Strapi is ready.
- 145 unit tests using Node's built-in test runner (no external test framework dep).
- Security regression test script (`scripts/security-test.ps1` + `.sh`) covering all critical and high findings.

### Changed
- `peerDependencies."@strapi/strapi"` extended to `>=5.0.0` (was `^5.0.0`). Full feature set requires 5.45+; older versions gracefully degrade.
- Tone neutralized in user-facing strings (removed Argentinian voseo, e.g. `pegá` → `pega`, `elegí` → `elige`).

### Documentation
- New README.md (English) and README.es.md (Spanish, in progress).
- Expanded `.env.example` with extensive comments and use cases for each env var.

## [0.2.0] - 2026-05-15

### Added
- **Visual layout tools**: `get_visual_layout`, `set_field_layout`, `set_field_metadata`, `set_view_settings`. Modify the Content Manager UI (widths, labels, ordering) without restarting Strapi.
- **Extensible registry**: `strapi.plugin('strapi-mcp').service('registry').registerTool({...})` allows projects to register custom tools alongside built-ins. Validates structure with ajv. Self-tests via opt-in `testCases` run automatically in dev bootstrap.
- **Tool gating**: `SCHEMA_AUTHORING_ENABLED=true` env var hides the 7 schema-authoring tools from `tools/list` by default. Opt-in for development.
- **`__list_registered_tools` introspection tool**: lists built-in and custom tools with categorization and last self-test results.
- **Upload tools (opt-in)**: 6 tools for media library management. `upload_media_from_url` downloads from URLs, others wrap the upload service.
- **GraphQL tools (opt-in)**: `graphql_introspect`, `graphql_query`, `graphql_generate_query` for testing and generating GraphQL queries against the project.

## [0.1.0] - 2026-05-14

### Added
- Initial release.
- Generic content-ops tools (CRUD on any content-type via `strapi.documents()`).
- Schema-authoring tools (create/edit content-types and components from filesystem writes).
- Schema validator with 8 rules (nesting depth, reserved names, missing props, unknown references, circular refs, etc.).
- Native Strapi API token authentication.
- Streamable HTTP transport (stateless) via MCP SDK.
- Single endpoint `/api/strapi-mcp/stream`.
