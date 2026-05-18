/**
 * Extracts a small, safe summary from a tool's result for the audit log.
 *
 * Persisting the full result is a bad idea: `find_entries` can return hundreds
 * of records (DB bloat + leak surface), and arbitrary tool output may be huge.
 * Instead we pluck a handful of well-known top-level fields that describe
 * "what happened" without leaking the payload itself.
 *
 * Fields extracted (when present at the top level):
 *   - documentId / id / uid
 *   - count / total           (from `result.count` or `result.meta.pagination.total`)
 *   - op                      (any explicit `op` field like 'created', 'deleted', etc.)
 *   - error                   (any explicit `error` field)
 *
 * Arrays at the top level are summarized as `{ count: array.length }`.
 *
 * If nothing matches, returns `null` — meaning "no summary worth persisting".
 * The audit row will still capture the status (ok/error) and the tool name.
 */

const SAFE_KEYS = ["documentId", "id", "uid", "op"] as const;

export function summarizeResult(toolName: string, result: unknown): Record<string, unknown> | null {
  if (result === null || result === undefined) {
    return null;
  }

  if (Array.isArray(result)) {
    return { count: result.length, tool: toolName };
  }

  if (typeof result !== "object") {
    return null;
  }

  const r = result as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  for (const key of SAFE_KEYS) {
    if (key in r && (typeof r[key] === "string" || typeof r[key] === "number")) {
      summary[key] = r[key];
    }
  }

  if (typeof r.count === "number") {
    summary.count = r.count;
  } else if (Array.isArray(r.data)) {
    summary.count = r.data.length;
  } else {
    const meta = r.meta as Record<string, unknown> | undefined;
    const pag = meta?.pagination as Record<string, unknown> | undefined;
    if (pag && typeof pag.total === "number") {
      summary.count = pag.total;
    }
  }

  if (typeof r.error === "string") {
    summary.error = r.error;
  }

  // Tag the tool name so the audit reader sees context immediately.
  summary.tool = toolName;

  return Object.keys(summary).length > 1 ? summary : null;
}
