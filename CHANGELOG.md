# Changelog

All notable changes to `strapi-plugin-mcp` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Log noise cleanup: 401/403/429 from the auth policy and rate-limit middleware should log as a single-line `warn`, not `error` with a stack trace. Deferred from 0.6.0 — the fix touches the security-critical `require-api-token` policy and wasn't worth the regression risk for a cosmetic gain.
- Redis backend for multi-instance rate limiting
- `delete_content_type` with multi-step confirmation
- i18n-specific tools
- Admin UI panel for browsing the audit log
- Extend `strategy` resolution to `create_content_type` and `add_field_to_schema`
- Investigate the `pnpm publish` 404 bug (granular token) so npm isn't the only working publish path

## [0.6.0] - 2026-05-21

### Added

- **`modify_schema` — batch schema mutation in a single restart.** New tool that combines `remove[]` (delete fields), `add[]` (new fields) and `update[]` (replace a field's definition — e.g. change its `type`) into ONE atomic read-modify-write. Replaces chaining `delete_field_from_schema` + `add_fields_to_schema` (which is N restarts). Applies `remove → update → add`, validates the full result, writes once. Any failure (missing field, collision, relation blocker, validation error) aborts the whole operation without writing. Cross-list conflict detection runs before the filesystem is touched (a field can't be in `remove` and `add`, etc.).
- **`suggest_reusable_atoms` — proactive atomization analysis (read-only).** Walks every component and content-type, counts repeated `(fieldName, type)` patterns, and flags scalar fields worth promoting to reusable atom components (e.g. `title: string` copy-pasted across 8 sections). For each strong candidate it returns: occurrence count, `used_in` list, a starter atom schema (with built-in enrichment for known names like `title → atoms.heading`, `icon → atoms.icon`), an `execution_plan` of concrete `create_component` + `modify_schema` calls, depth warnings when a consumer is itself nested, and a data-migration note. Never writes — pure analysis. Closes the gap where the LLM defaults to "add another loose field" instead of "extract a reusable atom".
- **Audit log: `destructive` flag.** The `op-log` content-type gains a `destructive: boolean` column. The logger sets it `true` for `delete_entry`, `delete_field_from_schema` and `delete_media`. Lets a super-admin filter the forensic log for high-risk operations: `SELECT * FROM mcp_op_logs WHERE destructive = 1`. `modify_schema` is intentionally NOT flagged destructive — it can remove fields but only when `remove[]` is passed explicitly.
- **24 new unit tests** (modify_schema conflict detection + fs-backed ops, suggest_reusable_atoms detection/tiers/plan/depth-warnings, destructive-flag logging). Total: **299/299 passing**.

### Changed

- **Hardened descriptions on the 3 destructive tools** (`delete_field_from_schema`, `delete_entry`, `delete_media`). Each now opens with `⚠️ DESTRUCTIVA` and an explicit instruction: use the tool only when the user named the target explicitly; do NOT delete things to "fix" unrelated problems autonomously. Triggered by a live-testing observation where the LLM deleted a user-added field to resolve an unrelated depth violation without asking.
- Internal `version` field in `createMcpServer` bumped to `0.6.0`.

### Documentation

- README (EN + ES): new sections for `modify_schema` and `suggest_reusable_atoms`.

### Notes

- The `confirm: true` requirement planned for `delete_field_from_schema` in the old 0.5.1 roadmap turned out to already exist (the field was always `required`). The real fix for autonomous deletions is the hardened descriptions + the `destructive` audit flag — `confirm` doesn't help because the LLM can set it itself. This release combines what was scoped as 0.5.1 + 0.5.2 into one.

## [0.5.0] - 2026-05-18

### Added

- **Deep populate on reads (opt-in).** `find_entries` and `get_entry` accept `populate_deep: true` and `populate_depth: N` (default `4`, hard cap `6`). When enabled, the plugin auto-generates the full populate tree from the live schema — relations, components, dynamiczones, media — with a `visited` Set guarding against cyclic relations. Eliminates the need for the LLM to hand-craft the populate object for deeply nested content. Algorithm ported from the inline `populate-deep` pattern in the Alegra repo.
  - Backward compatible: `populate_deep` defaults to `false`. Existing calls passing `populate` keep their current behavior.
  - If both `populate_deep: true` and `populate` are passed, `populate` is ignored and the response carries a `warning` field explaining why.
- **Progressive schema strategies on writes.** When `create_component` receives a proposal that would exceed Strapi's UI depth limit (1 level of component nesting → `NESTED_COMPONENT_DEPTH_EXCEEDED`), the response now includes a `strategies` array instead of just an error. Each strategy describes a concrete way to materialize the LLM's intent:
  - **`flat`** — auto-inlines the nested component's attributes into the parent with a `${attr}_` prefix. Refused when the parent attribute is `repeatable: true` (semantically wrong to flatten 1:N) or when the prefixed names would collide with existing attributes.
  - **`modular`** — keeps the components separate. The parent is written without the offending nested reference; the LLM gets `wiring_instructions` with the exact JSON snippet the user must paste into the parent CT/component schema by hand. Always available.
  - **`dynamiczone`** — marked unavailable for component proposals (dynzones only live in content-types) with an explanation pointing the user to the right escape hatch.
  - **`as-proposed`** (escape hatch) — writes the component EXACTLY as proposed, preserving the depth chain. The CTB UI will refuse to open the resulting component for editing, but Strapi's backend (DB, REST, GraphQL, lifecycle, populate) handles deeper nesting fine. For users who know the constraint and prefer JSON-only editing for that schema. Bypasses the warning-confirmation gate (the strategy choice itself is the confirmation).
  Re-call `create_component` with `strategy: 'flat' | 'modular' | 'dynamiczone' | 'as-proposed'` to materialize the chosen option. Validation is re-run on the materialized schema before writing.
- **New tool `propose_schema_strategy`** — read-only dry-run of the strategies pipeline. Accepts a proposed component schema, returns the violations and (if applicable) the strategies. Never writes. Useful for the LLM to explore options before committing.
- **New tool `add_fields_to_schema`** (batch) — adds N attributes to an existing schema in a single read-modify-write cycle → a single Strapi restart instead of N. Atomic: if any field collides (within the batch or against existing attributes) the entire operation aborts without writing. Reduces the friction of adding multiple fields sequentially (which was previously ~N×12s of restart overhead with brittle inter-call coordination). The singular `add_field_to_schema` is now documented as "single-field convenience"; the batch is preferred when adding 2+ fields.
- **50 new unit tests** (3 files): `deep-populate.test.ts` (19 cases for walker correctness, cycle protection, dynzone syntax), `strategies.test.ts` (13 cases for flatten + propose + as-proposed), `tools-schema-authoring.test.ts` (11 integration cases for create_component strategy fork + propose_schema_strategy + add_fields_to_schema pre-flight), plus extension of `tools-content-ops.test.ts` (7 cases for populate_deep integration). Total: **267/267 passing**.

### Changed

- `__health` reports the correct plugin version (was hardcoded to 0.2.0).
- `restart_info.retry_strategy` and `next_action_for_llm` updated to mention the mcp-remote reconnection cap (Claude Desktop bridge) and to point users at `add_fields_to_schema` batch as a way to minimize restart cycles.
- `find_entries.inputSchema` and `get_entry.inputSchema` gain `populate_deep` (boolean) and `populate_depth` (integer 1-6).
- `create_component.inputSchema` gains optional `strategy: 'flat' | 'modular' | 'dynamiczone' | 'as-proposed'`.
- `add_field_to_schema` description updated: "⚠️ Si necesitas agregar VARIOS campos, usá `add_fields_to_schema` (plural, batch) que aplica N campos en un solo restart."
- Internal `version` field in `createMcpServer` bumped to `0.5.0` (cosmetic).

### Documentation

- New README section "Deep population on reads" (EN + ES) explaining when to use `populate_deep`, the depth cap, and the trade-offs.
- New README section "Schema strategies on writes" (EN + ES) explaining the three strategies, when each applies, and the two-call flow (propose → choose → materialize).
- `.env.example` unchanged — both features are per-call, no env vars added.

### Notes

- Strategies are currently scoped to `create_component`. `create_content_type` and `add_field_to_schema` will get strategy support in a future release (the validator currently only flags depth violations for component proposals).
- The deep-populate walker treats system models (`admin::user`, `plugin::users-permissions.*`) as shallow (`populate: true`) — those trees are large and rarely useful to fetch in full from an MCP.
- The depth cap of `6` is heuristic. Combined with the existing `pageSize` cap of `200`, the worst-case query is bounded to ~200 entries × 6 branching levels. If you hit timeouts in production, raise the cap conservatively or restrict via `filters`.

## [0.4.0] - 2026-05-18

### Security

- **Added: forensic audit trail.** Two new internal content-types (`plugin::strapi-mcp.token-audit`, `plugin::strapi-mcp.op-log`) record:
  - **Token lifecycle** — who created each API token, when, and (if deleted) who deleted it. Captured via lifecycle hooks on `admin::api-token` (`afterCreate`, `afterDelete`). Pre-existing tokens are backfilled at boot with `creator=unknown, is_legacy=true`.
  - **Tool invocations** — every `tools/call` over the MCP endpoint writes a row with: token id, admin user (if attributable), tool name, args (with secret-shaped keys like `token`/`password`/`apiKey` redacted), result summary (small extraction: `documentId`/`count`/`uid`), status (ok/error), error message, duration, IP, user-agent. Full payloads are NEVER persisted.
- **Added: delete-permission enforcement on `admin::api-token`.** A `beforeDelete` lifecycle hook blocks token deletion unless the caller is (a) the original creator recorded in `token-audit`, OR (b) a super-admin. Legacy tokens (no recorded creator) require super-admin. Returns `403 ForbiddenError` with `details.reason: MCP_AUDIT_DELETE_FORBIDDEN`.
- **Added: bounded retention for `op-log`.** Default 90 days OR 100k rows (configurable via `MCP_AUDIT_RETENTION_DAYS`, `MCP_AUDIT_MAX_ROWS`). Cleanup runs every `MCP_AUDIT_CLEANUP_INTERVAL_HOURS` (default 24) in batches of 1000. Setting either limit to `0` disables that pass (useful for tests).

### Added

- **2 new tools (super-admin only):**
  - `__audit_token_creators` — list who created each token, plus deletion info if applicable. Useful for spotting legacy tokens that need attention.
  - `__audit_log_query` — filterable view of `op-log` (by token_id, admin_user_id, tool_name, status, ts range). By default omits `args_redacted` and `result_summary` (`include_payloads: true` to include them). Cap 500 rows.
- **Audit hidden from Content Manager and Content-Type Builder** via `pluginOptions.visible: false` — the two tables are operator-only.
- **40 new unit tests** covering: redactor (depth limit, key matching, nested), summarizer, lifecycle hooks (create/delete-permission/post-delete), backfill (idempotency, error isolation), cleanup (age + cap passes, env var off-switch), logger (failure isolation), audit tools (super-admin gating, filter building).
- 3 new env vars: `MCP_AUDIT_RETENTION_DAYS`, `MCP_AUDIT_MAX_ROWS`, `MCP_AUDIT_CLEANUP_INTERVAL_HOURS`.

### Changed

- `mcp-server.ts` wraps every tool invocation in audit instrumentation (start timestamp → handler → log either result_summary or error_message). Logging failures are swallowed; they never break the tool itself.
- `controllers/stream.ts` propagates request IP and user-agent into the MCP context for the audit row.
- Internal `version` field in `createMcpServer` bumped to `0.4.0`.

### Documentation

- New README section "Audit trail" (EN + ES) explaining: the two tables, the delete-permission rule, the retention model, when super-admin attribution actually works (Strapi 5.45+ with `features.future.adminTokens: true`), and the trade-offs vs. the abandoned anti-impersonation attempt.
- `.env.example` expanded with the 3 new env vars + commentary on tuning.

### Notes

The audit system does NOT prevent impersonation — that's structurally impossible in standard Strapi 5.x (see 0.3.1 entry). What it gives you is **forensic evidence**: if an incident happens, you can trace which token did what, when, and who created that token. Combined with the delete-permission rule, it raises the cost of post-incident cleanup ("delete the evidence then deny") — the deletion attempt is itself recorded by the `afterDelete` hook.

## [0.3.1] - 2026-05-18

### Security

- **Added: granular permission enforcement for Custom API tokens.** The policy `require-api-token` now verifies that Custom tokens have the action `plugin::strapi-mcp.stream.handle` explicitly marked. Tokens of type `Custom` without the MCP permission marked are rejected with `401 Custom token missing MCP permission`. `Full Access` and `Read Only` tokens continue to pass (their scope is broader by design). This closes the gap where any valid token could use the endpoint regardless of its declared permissions.

### Removed (with explanation)

- **Removed: anti-impersonation check via `adminUserOwner` field.** Investigation revealed that Strapi 5.x forces `adminUserOwner: null` for all `content-api` tokens (the ones users create from `Settings → API Tokens`) — see [@strapi/admin's api-token service line 541](https://github.com/strapi/strapi/blob/main/packages/core/admin/server/src/services/api-token.ts). The field is only populated for tokens of `kind='admin'`, which require enabling the experimental feature flag `features.future.adminTokens: true` in `config/admin.ts`. Since the check could not actually protect against the C2 impersonation scenario for the vast majority of users, it was generating false confidence. Removed entirely. See README's "Known limitations" section for details and how to enable strict attribution if you control your deployment.

### Documentation

- Added `Known limitations` section to README (EN + ES) covering: (1) why C2 anti-impersonation cannot be implemented reliably in Strapi 5.x standard, (2) workaround using `kind='admin'` tokens behind feature flag.
- CHANGELOG entry detailing the security audit finding that led to removal.

## [0.3.0] - 2026-05-17

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
