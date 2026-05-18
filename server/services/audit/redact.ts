/**
 * Recursive secret redactor for the MCP audit log.
 *
 * Walks the value tree and replaces any value whose KEY matches a secret-shaped
 * pattern with `'[REDACTED]'`. Key match is case-insensitive against:
 *   token | password | secret | api[_-]?key | authorization | bearer | access[_-]?key
 *
 * Why redact by key and not by value heuristic: a string like `"sk-abc123"` is
 * indistinguishable from a normal id without context, but a key named
 * `"password"` is unambiguous. We err on the side of redacting too little
 * rather than mangling normal data the operator needs to debug.
 *
 * Depth limit (10) protects against pathological structures (circular refs
 * passed as plain objects, deeply nested payloads from poorly-formed tool args).
 * Beyond the limit, the subtree is replaced with `'[TRUNCATED_DEPTH]'`.
 *
 * The function is pure and synchronous; safe to call on the hot path before
 * persisting to `op-log`.
 */

const SECRET_KEY_RE = /^(token|password|secret|api[_-]?key|authorization|bearer|access[_-]?key)$/i;
const MAX_DEPTH = 10;

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[TRUNCATED_DEPTH]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecrets(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}
