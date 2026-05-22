# Contributing to strapi-plugin-mcp-suite

Thanks for considering a contribution! This document covers the practical bits: how to run the plugin locally, run tests, add a tool, and submit changes.

## Setup

You need a Strapi v5 project to test against. The fastest path:

```bash
# Create a fresh Strapi project (or use an existing one)
pnpm dlx create-strapi@latest test-strapi --quickstart --no-run

# Clone this plugin into it
cd test-strapi
git clone https://github.com/amilcarex/strapi-plugin-mcp-suite.git src/plugins/strapi-mcp

# Build the plugin
cd src/plugins/strapi-mcp
pnpm install
pnpm run build

# Enable the plugin
cd ../../..
# edit config/plugins.ts and add the 'strapi-mcp-suite' entry

# Run Strapi
pnpm run develop
```

Look for `[strapi-mcp] plugin loaded` in the boot log.

## Running tests

### Unit tests (Node built-in runner, no extra deps)

```bash
cd src/plugins/strapi-mcp
pnpm test
```

145+ tests covering the core modules. They run in ~200ms and don't need a running Strapi.

### Security regression tests (HTTP against running Strapi)

Strapi must be running locally. Then:

```bash
export STRAPI_MCP_TOKEN=<your-token>
bash src/plugins/strapi-mcp/scripts/smoke-test.sh
```

Windows:

```powershell
$env:STRAPI_MCP_TOKEN = "<your-token>"
pwsh src/plugins/strapi-mcp/scripts/security-test.ps1
```

Tests cover: path traversal, SSRF, GraphQL auth, rate limit, pagination cap. Manual instructions for token impersonation and backup location tests are printed at the end.

## Plugin architecture

```
src/plugins/strapi-mcp/
├── package.json
├── strapi-server.ts              ← entry point, re-exports server/
├── tsconfig.server.json          ← build config (outputs to dist/)
├── tsconfig.test.json            ← test build config (outputs to dist-tests/)
└── server/
    ├── index.ts                  ← composes everything
    ├── bootstrap.ts              ← runs on Strapi boot (logs, self-tests)
    ├── register.ts, destroy.ts
    ├── routes/index.ts           ← /api/strapi-mcp-suite/stream (GET + POST)
    ├── controllers/stream.ts     ← Koa ↔ MCP transport bridge
    ├── middlewares/rate-limit.ts ← 3-layer sliding window
    ├── policies/require-api-token.ts ← native Strapi API token auth
    ├── services/
    │   ├── mcp-server.ts         ← MCP Server factory, tools dispatcher
    │   ├── path-lock.ts          ← in-memory mutex per filesystem path
    │   ├── url-safety.ts         ← SSRF defense (IPv4/IPv6 blocklist + DNS + redirect chase)
    │   ├── schema-derivation/    ← runtime schema introspection
    │   ├── schema-authoring/     ← writer + validator for .json schemas
    │   ├── registry/             ← registerTool API for custom tools
    │   └── tools/                ← all tool definitions (one file per category)
    │       ├── content-ops.ts
    │       ├── layout-ops.ts
    │       ├── schema-authoring.ts
    │       ├── upload-tools.ts
    │       ├── graphql-tools.ts
    │       ├── health-tools.ts
    │       ├── registry-tools.ts
    │       └── types.ts          ← ToolDefinition interface
    └── __tests__/                ← unit tests (Node test runner)
```

## Adding a built-in tool

1. Decide its category and the file it belongs in (`tools/content-ops.ts`, `tools/upload-tools.ts`, etc.). Create a new category file if it doesn't fit existing ones.
2. Define the tool as a `ToolDefinition` (see `tools/types.ts`):

```ts
{
  name: "my_new_tool",                       // snake_case, unique
  description: "Does X when the user asks Y. Use it when...",  // ≥30 chars, clear for LLM
  inputSchema: {
    type: "object",
    properties: { foo: { type: "string" } },
    required: ["foo"],
    additionalProperties: false,             // mandatory
  },
  handler: async ({ strapi, auth, user }, args) => {
    // your logic
    return { result: "..." };
  },
}
```

3. Export the tool from the category file.
4. **Important**: add the tool name to `BUILTIN_TOOL_NAMES` in `services/registry/index.ts`. This prevents projects from accidentally registering a custom tool with the same name.
5. Categorize the new tool name in `services/tools/registry-tools.ts` so `__list_registered_tools` shows it correctly.
6. Write unit tests in `server/__tests__/`. Mock Strapi with `_helpers.ts`.

## Adding a custom tool from your project (not the plugin)

You don't need to fork the plugin. From your project's `src/index.ts` bootstrap:

```ts
strapi.plugin('strapi-mcp-suite').service('registry').registerTool({
  name: 'my_project_tool',
  description: '...',
  inputSchema: { ... },
  handler: async (ctx, args) => { ... },
  testCases: [ ... ],     // optional, runs in dev bootstrap
  tags: ['read'],
});
```

The registry validates the shape and runs `testCases` automatically in dev. See README for details.

## Code style

- TypeScript, target ES2019, CommonJS modules (Strapi's standard).
- `strict: false` (Strapi's standard) but `noImplicitThis: true`.
- Spanish in user-facing strings (error messages, hints) is fine — the audience is Spanish-speaking by default, but plain neutral Spanish (no voseo).
- Code comments in English or Spanish — be consistent within a file.
- No emoji in code unless explicitly requested.

## Pull requests

1. Open an issue first if it's a non-trivial change, so we can align on approach.
2. Branch from `main`. Name it `fix/short-desc`, `feat/short-desc`, `docs/...`, `security/...`.
3. Make sure unit tests pass: `pnpm test`.
4. If the change touches behavior visible from MCP clients, update the README and/or CHANGELOG.
5. If you're adding a security-relevant change, also update `scripts/security-test.ps1` and `.sh` with a regression case.

## Reporting security issues

**Don't open public issues for security vulnerabilities.** Report them privately through GitHub's built-in security workflow:

1. Go to https://github.com/amilcarex/strapi-plugin-mcp-suite/security
2. Click **"Report a vulnerability"** (Private vulnerability reporting)
3. Fill in the form with the details (impact, reproduction steps, suggested fix)

You'll receive an acknowledgment within 48-72 hours and we'll coordinate disclosure via a Security Advisory once a fix is ready. This keeps the report private until the fix is shipped, protecting users in the meantime.

If for some reason you can't use GitHub Security Advisories (no account, can't disclose to a public platform), open a regular issue with the title "SECURITY — please contact me privately" and we'll move the discussion to a private channel.

## License

By contributing, you agree your contributions are licensed under MIT (see `LICENSE`).
