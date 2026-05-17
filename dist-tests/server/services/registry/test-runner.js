"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTestCasesFor = runTestCasesFor;
exports.formatSummary = formatSummary;
exports.isProduction = isProduction;
async function runTestCasesFor(strapi, tool) {
    var _a;
    const testCases = tool.testCases;
    if (!Array.isArray(testCases) || testCases.length === 0)
        return null;
    const results = [];
    for (const tc of testCases) {
        const started = Date.now();
        try {
            const result = await tool.handler({ strapi }, (_a = tc.args) !== null && _a !== void 0 ? _a : {});
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
        }
        catch (err) {
            const duration = Date.now() - started;
            const message = err instanceof Error ? err.message : String(err);
            // ¿Se esperaba un error?
            if (tc.expect.errorMatches) {
                const regex = tc.expect.errorMatches instanceof RegExp
                    ? tc.expect.errorMatches
                    : new RegExp(String(tc.expect.errorMatches));
                if (regex.test(message)) {
                    results.push({ name: tc.name, ok: true, durationMs: duration });
                }
                else {
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
function formatSummary(summary) {
    if (summary.failed === 0) {
        return `[strapi-mcp registry] ${summary.toolName}: ${summary.results.length} test(s) — ✓ ${summary.passed} passed`;
    }
    const failed = summary.results.filter((r) => !r.ok);
    const details = failed.map((r) => { var _a; return `  ✗ ${r.name}: ${(_a = r.reason) !== null && _a !== void 0 ? _a : "unknown"}`; }).join("\n");
    return `[strapi-mcp registry] ${summary.toolName}: ${summary.results.length} test(s) — ✗ ${summary.failed} failed, ${summary.passed} passed\n${details}`;
}
function isProduction() {
    return process.env.NODE_ENV === "production";
}
