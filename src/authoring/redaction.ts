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
 * - Query-parameter matching covers the parameter names above, not tokens an
 *   application embeds elsewhere in page text.
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

/**
 * A token or session identifier carried as a URL query parameter.
 *
 * Applications put these in GET URLs (LedgerSMB's setup flow carries
 * `csrf_token`), and a recorded observation copies the URL verbatim, so a
 * key-name rule never sees them. Only the parameter value is replaced.
 */
const SENSITIVE_QUERY_PARAMETER =
    /([?&](?:csrf[-_]?token|token|password|api[-_]?key|[a-z]*sess(?:ion)?id[a-z0-9_]*)=)[^&#\s"']+/giu;

function visit(
    value: unknown,
    seen: WeakSet<object>,
    sensitiveValues: ReadonlySet<string>,
): unknown {
    if (typeof value === "string") {
        return sensitiveValues.has(value)
            ? "[REDACTED]"
            : value.replace(SENSITIVE_QUERY_PARAMETER, "$1[REDACTED]");
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
