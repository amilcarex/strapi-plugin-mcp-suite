import type { Core } from "@strapi/strapi";
import type { ToolDefinition } from "../tools/types";

/**
 * Runner de testCases de tools custom.
 *
 * Solo se ejecuta en bootstrap cuando `NODE_ENV !== 'production'`. Cada testCase
 * se interpreta así:
 *
 *   - `expect.ok === true`         → el handler resolvió sin throw
 *   - `expect.shapeIncludes: [...]` → las keys listadas están en el resultado top-level
 *   - `expect.errorMatches: RegExp` → el handler tiró, y el message matchea el regex
 *
 * Si una tool falla self-tests, NO se desregistra — solo se loguea warning para
 * que el dev se entere. La filosofía: opt-in, no bloqueante.
 */

export type TestCaseResult = {
  name: string;
  ok: boolean;
  reason?: string;
  durationMs: number;
};

export type ToolTestSummary = {
  toolName: string;
  results: TestCaseResult[];
  passed: number;
  failed: number;
  testedAt: string;
};

export async function runTestCasesFor(
  strapi: Core.Strapi,
  tool: ToolDefinition
): Promise<ToolTestSummary | null> {
  const testCases = (tool as any).testCases as
    | Array<{
        name: string;
        args: any;
        expect: { ok?: boolean; shapeIncludes?: string[]; errorMatches?: RegExp };
      }>
    | undefined;

  if (!Array.isArray(testCases) || testCases.length === 0) return null;

  const results: TestCaseResult[] = [];
  for (const tc of testCases) {
    const started = Date.now();
    try {
      const result = await tool.handler({ strapi }, tc.args ?? {});
      const duration = Date.now() - started;

      // expectativa de error con éxito real → fail
      if (tc.expect.errorMatches) {
        results.push({
          name: tc.name,
          ok: false,
          reason: `Se esperaba error matching ${tc.expect.errorMatches}, pero handler resolvió.`,
          durationMs: duration,
        });
        continue;
      }

      // expectativa de ok:true (default si no hay otras)
      if (tc.expect.ok === false) {
        results.push({
          name: tc.name,
          ok: false,
          reason: "Se esperaba ok:false (que tire error), pero handler resolvió.",
          durationMs: duration,
        });
        continue;
      }

      // expectativa de shapeIncludes
      if (tc.expect.shapeIncludes) {
        if (!result || typeof result !== "object") {
          results.push({
            name: tc.name,
            ok: false,
            reason: `Result no es objeto (got ${typeof result}), no puede tener shapeIncludes.`,
            durationMs: duration,
          });
          continue;
        }
        const keys = Object.keys(result);
        const missing = tc.expect.shapeIncludes.filter((k) => !keys.includes(k));
        if (missing.length > 0) {
          results.push({
            name: tc.name,
            ok: false,
            reason: `Result no incluye keys: ${missing.join(", ")}. Keys presentes: ${keys.join(", ")}.`,
            durationMs: duration,
          });
          continue;
        }
      }

      results.push({ name: tc.name, ok: true, durationMs: duration });
    } catch (err) {
      const duration = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);

      // ¿Se esperaba un error?
      if (tc.expect.errorMatches) {
        const regex =
          tc.expect.errorMatches instanceof RegExp
            ? tc.expect.errorMatches
            : new RegExp(String(tc.expect.errorMatches));
        if (regex.test(message)) {
          results.push({ name: tc.name, ok: true, durationMs: duration });
        } else {
          results.push({
            name: tc.name,
            ok: false,
            reason: `Handler tiró pero el mensaje no matchea ${regex}: "${message}".`,
            durationMs: duration,
          });
        }
        continue;
      }

      if (tc.expect.ok === false) {
        results.push({ name: tc.name, ok: true, durationMs: duration });
        continue;
      }

      results.push({
        name: tc.name,
        ok: false,
        reason: `Handler tiró inesperadamente: "${message}".`,
        durationMs: duration,
      });
    }
  }

  return {
    toolName: tool.name,
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    testedAt: new Date().toISOString(),
  };
}

export function formatSummary(summary: ToolTestSummary): string {
  if (summary.failed === 0) {
    return `[strapi-mcp registry] ${summary.toolName}: ${summary.results.length} test(s) — ✓ ${summary.passed} passed`;
  }
  const failed = summary.results.filter((r) => !r.ok);
  const details = failed.map((r) => `  ✗ ${r.name}: ${r.reason ?? "unknown"}`).join("\n");
  return `[strapi-mcp registry] ${summary.toolName}: ${summary.results.length} test(s) — ✗ ${summary.failed} failed, ${summary.passed} passed\n${details}`;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
