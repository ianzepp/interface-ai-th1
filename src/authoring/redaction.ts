/**
 * Best-effort scrubbing of secrets on their way into evidence.
 *
 * Redaction is keyed on field names, applied recursively to the event ledger and
 * the run manifest before they are written, and replaces the value rather than
 * dropping the key, so a reader can tell a credential existed and was withheld
 * instead of assuming the field was never present.
 *
 * LIMITS
 * - Key names only. A member's account number sitting in a free-text note, or a
 *   credential embedded in a URL, is not recognized here.
 * - Not applied to `README.md` text or to `trace.zip`; both are written without
 *   passing through this function.
 * - Not a substitute for not collecting secrets, and not a substitute for
 *   reviewing a run before its evidence is committed.
 * - Producer side only. This protects what this system writes; it says nothing
 *   about what a target application already logged.
 */

const SENSITIVE_KEY =
  /^(api[-_]?key|authorization|cookie|credentials?|password|secret|set-cookie|token)$/i;

export function redactKnownSecrets(value: unknown): unknown {
  return visit(value, new WeakSet());
}

function visit(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => visit(item, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : visit(child, seen);
  }
  return redacted;
}
