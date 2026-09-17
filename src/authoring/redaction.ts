/**
 * Best-effort scrubbing of secrets on their way into evidence.
 *
 * Redaction is keyed on field names, applied recursively to the event ledger and
 * the run manifest before they are written, and replaces the value rather than
 * dropping the key, so a reader can tell a credential existed and was withheld
 * instead of assuming the field was never present.
 *
 * LIMITS
 * - Exact-value matching only protects values declared by the session launcher.
 * - Trace archives and screenshots need their separate capture boundary.
 * - Not a substitute for not collecting secrets, and not a substitute for
 *   reviewing a run before its evidence is committed.
 * - Producer side only. This protects what this system writes; it says nothing
 *   about what a target application already logged.
 */

const SENSITIVE_KEY =
    /^(api[-_]?key|authorization|cookie|credentials?|password|secret|set-cookie|token)$/i;

export function redactKnownSecrets(
    value: unknown,
    sensitiveInputValues: readonly string[] = [],
): unknown {
    return visit(value, new WeakSet(), new Set(sensitiveInputValues));
}

export function containsSensitiveValue(
    value: unknown,
    sensitiveInputValues: readonly string[],
): boolean {
    return contains(value, new WeakSet(), new Set(sensitiveInputValues));
}

function visit(
    value: unknown,
    seen: WeakSet<object>,
    sensitiveValues: ReadonlySet<string>,
): unknown {
    if (typeof value === "string" && sensitiveValues.has(value)) {
        return "[REDACTED]";
    }
    if (value === null || typeof value !== "object") {
        return value;
    }

    if (seen.has(value)) {
        return "[CIRCULAR]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => visit(item, seen, sensitiveValues));
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        redacted[key] = SENSITIVE_KEY.test(key)
            ? "[REDACTED]"
            : visit(child, seen, sensitiveValues);
    }
    return redacted;
}

function contains(
    value: unknown,
    seen: WeakSet<object>,
    sensitiveValues: ReadonlySet<string>,
): boolean {
    if (typeof value === "string") return sensitiveValues.has(value);
    if (value === null || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some((child) =>
        contains(child, seen, sensitiveValues),
    );
}
