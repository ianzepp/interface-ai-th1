/**
 * The secret scan, as a rule set instead of a judgment call.
 *
 * The delivery spec for VS-11 already carries a hand-written grep for the fixture
 * credential literals and for credential-bearing URL userinfo. That check is
 * correct, and it is the kind that rots: it lives inside a document, it covers one
 * pattern class, and nothing runs it. This module is that check generalised into
 * rules a program can run on every commit.
 *
 * A rule answers one question: did a value reach a file it must not reach. The
 * patterns are curated and specific rather than entropy-based, because a heuristic
 * that fires on every long string is one people learn to ignore. A rule that
 * expects its pattern to appear somewhere names that path here, so every curated
 * exception is visible in one place instead of implicit at each call site.
 *
 * INVARIANTS
 * - A finding never carries a usable value. Excerpts are redacted to a short
 *   prefix and a length on the way out, for every rule.
 * - A finding reports a location, not a verdict about whether the value still
 *   works. Reporting a credential is not using it.
 * - Paths are repository-relative with forward slashes on every platform.
 *
 * WHAT THIS DOES NOT COVER
 * - Binary artifacts. Their bytes are counted and reported, never scanned, so a
 *   clean result never means the trace archives were inspected.
 * - Screenshot pixels. Nothing here reads an image.
 * - Git history. Reachability over committed objects is a separate pass.
 */

export type SecretSeverity = "blocking" | "warning" | "note";

/** Whether a file would travel with a clone, or exists only on this machine. */
export type ScanScope = "committable" | "local";

export interface SecretFinding {
    rule: string;
    severity: SecretSeverity;
    scope: ScanScope;
    filePath: string;
    line: number;
    /** The offending line, with the matched value redacted. */
    excerpt: string;
    detail: string;
}

export interface ScanCandidate {
    filePath: string;
    scope: ScanScope;
    text: string;
}

export interface ScanRules {
    /** Values that are credentials by declaration, even though they are synthetic. */
    fixtureValues: readonly string[];
    /** Where a fixture value is expected: the fixture configuration, and docs naming it. */
    fixtureValuePaths: readonly string[];
    /** The defining source of the rules themselves, which necessarily quotes every pattern value. */
    patternDefinitionPaths: readonly string[];
    /** Operator-specific tokens that must not spread past the files that record them as findings. */
    personalTokens: readonly string[];
    /** Where a personal identifier is already a recorded finding rather than news. */
    personalIdentifierPaths: readonly string[];
}

/** A run directory's readable artifacts: the files the recorder writes and Git may carry. */
const RUN_ARTIFACT_PATH = /^(?:runs|evidence\/runs)\//u;

const HOME_PATH = /\/Users\/[A-Za-z0-9._-]+\//u;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/u;

/**
 * One credential pattern and the group holding its secret.
 *
 * Each of these is specific enough to be wrong only if someone deliberately
 * writes that shape. The generic `key: value` case is handled separately, because
 * it is the one that needs placeholder filtering to stay quiet.
 */
interface CredentialShape {
    rule: string;
    pattern: RegExp;
    detail: string;
}

const CREDENTIAL_SHAPES: readonly CredentialShape[] = [
    {
        rule: "provider-key",
        pattern:
            /\b((?:AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-(?:live|test)-[A-Za-z0-9]{16,}|xai-[A-Za-z0-9]{20,})\b/gu,
        detail: "A provider-issued key is usable by anyone who reads the file it is in.",
    },
    {
        rule: "private-key-material",
        pattern: /-----BEGIN ([A-Z ]*PRIVATE KEY)-----/gu,
        detail: "Private key material in a repository compromises every token signed with it.",
    },
    {
        rule: "credential-bearing-url",
        pattern:
            /\b(?:postgres|postgresql|mysql|mariadb|mongodb|redis|amqp):\/\/[^\s:@/]+:([^\s@/]{4,})@/gu,
        detail: "A URL with inline userinfo is a credential inside an ordinary-looking string.",
    },
    {
        rule: "authorization-header",
        pattern:
            /\bauthorization\s*[:=]\s*["']?(?:basic|bearer)\s+([A-Za-z0-9._~+/=-]{12,})/giu,
        detail: "A captured authorization header grants the session it was issued for.",
    },
    {
        rule: "session-cookie",
        pattern:
            /\b((?:dolsessid|phpsessid|jsessionid|laravel_session|ci_session|connect\.sid)[A-Za-z0-9_]*=[A-Za-z0-9%._-]{16,})/giu,
        detail: "A session identifier lets a reader act as the session that produced it.",
    },
    {
        rule: "csrf-token",
        // The value class is deliberately permissive: a real csrf token contains
        // punctuation that a tidy character class excludes, and an under-matching
        // rule silently reports a clean file. Placeholders are filtered after the
        // match instead, where `{{input.password}}` and `[REDACTED]` are cheap to
        // recognise.
        pattern: /\bcsrf[-_]?token\s*[:=]\s*["']?([^\s"'<>]{8,})/giu,
        detail: "A csrf token in a persisted artifact is a token, which the assignment names explicitly.",
    },
];

/**
 * A `key: value` assignment whose value may be a literal secret.
 *
 * The key must *end* with the credential word, so `databasePassword` and
 * `MARIADB_ROOT_PASSWORD` count while `SecretSeverity` — a type name that merely
 * starts with one — does not. A trailing `hash`, `salt`, or `digest` is admitted,
 * because those are credential material too.
 *
 * LIMIT: a key that puts words after the credential word for other reasons, such
 * as `passwordFieldName`, is not matched. That is the deliberate cost of not
 * firing on ordinary identifiers.
 */
const CREDENTIAL_ASSIGNMENT =
    /\b[\w-]*(?:password|passwd|secret|auth[-_]?token|access[-_]?token|refresh[-_]?token|api[-_]?key)(?:[-_]?(?:hash|salt|digest))?\s*[:=]\s*(?:"([^"\n]{8,})"|'([^'\n]{8,})'|([A-Za-z0-9!@#$%^&*_+./=-]{8,}))/giu;

/**
 * Values that read like a secret to a pattern and are obviously not one.
 *
 * This is the difference between a gate people keep and a gate people disable.
 * A type declaration, an interpolated input, an environment reference, and a
 * redaction marker all sit in the same syntactic position as a literal password.
 */
const PLACEHOLDER_VALUE =
    /^(?:string|number|boolean|object|unknown|password|passwd|secret|token|api[_-]?key|\[REDACTED\]|<[^<>]*>|\{\{[^}]*\}\}|\$\{[^}]*\}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|[A-Z][A-Z0-9_]{2,}|[A-Za-z_$][\w$]*(?:\.[\w$]+)+)$/u;

export const DEFAULT_RULES: ScanRules = {
    fixtureValues: ["interface-ai-local", "interface-ai-root-local"],
    fixtureValuePaths: [
        // The fixtures' own credential declarations. Synthetic, loopback-only, required.
        "targets/dolibarr/compose.yaml",
        "targets/ledgersmb/compose.yaml",
        // Documents that name the literal as a pattern to scan for.
        "assignment-proof.md",
        "SECURITY.md",
        "docs/goals/capture-time-sensitive-data-guarantee.md",
    ],
    patternDefinitionPaths: ["src/audit/secret-scan.ts"],
    personalTokens: ["burgus", "pharos", "ianzepp"],
    personalIdentifierPaths: ["AGENTS.md", "SECURITY.md"],
};

/**
 * Scan candidates for values that must not have reached them.
 *
 * Every rule runs on every line, because a line that trips two rules is two
 * findings: one value can be both a declared fixture credential and a value
 * sitting in a run artifact, and the second is the one that matters.
 */
export function scanSecrets(
    candidates: readonly ScanCandidate[],
    rules: ScanRules = DEFAULT_RULES,
): readonly SecretFinding[] {
    const findings: SecretFinding[] = [];

    for (const candidate of candidates) {
        if (rules.patternDefinitionPaths.includes(candidate.filePath)) continue;
        const lines = candidate.text.split("\n");

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (line === undefined) continue;
            findings.push(...scanLine(candidate, line, index + 1, rules));
        }
    }
    return dedupe(findings);
}

/**
 * Which expected paths still carry the pattern they are recorded for.
 *
 * A ledger of exceptions is only honest if it fails in both directions: a path
 * that stops carrying the value must not stay recorded as if it did. This is how
 * the test reads that, so the check stays in one place.
 */
export function ledgerPresence(
    candidates: readonly ScanCandidate[],
    rules: ScanRules = DEFAULT_RULES,
): readonly {
    filePath: string;
    reason: "fixture-value" | "personal-identifier";
    present: boolean;
}[] {
    const byPath = new Map(
        candidates.map((item) => [item.filePath, item.text]),
    );
    const rows: {
        filePath: string;
        reason: "fixture-value" | "personal-identifier";
        present: boolean;
    }[] = [];

    for (const filePath of rules.fixtureValuePaths) {
        const text = byPath.get(filePath) ?? "";
        rows.push({
            filePath,
            reason: "fixture-value",
            present: rules.fixtureValues.some((value) => text.includes(value)),
        });
    }
    for (const filePath of rules.personalIdentifierPaths) {
        const text = byPath.get(filePath) ?? "";
        rows.push({
            filePath,
            reason: "personal-identifier",
            present:
                HOME_PATH.test(text) ||
                EMAIL.test(text) ||
                rules.personalTokens.some((token) => text.includes(token)),
        });
    }
    return rows;
}

/** Redact a value to a prefix and its length, so a finding is never usable. */
export function redactValue(value: string): string {
    return `${value.slice(0, 4)}…(len ${String(value.length)})`;
}

function scanLine(
    candidate: ScanCandidate,
    line: string,
    lineNumber: number,
    rules: ScanRules,
): readonly SecretFinding[] {
    const findings: SecretFinding[] = [];
    const add = (
        rule: string,
        severity: SecretSeverity,
        value: string,
        detail: string,
    ): void => {
        findings.push({
            rule,
            severity,
            scope: candidate.scope,
            filePath: candidate.filePath,
            line: lineNumber,
            excerpt: excerptFor(line, value),
            detail,
        });
    };

    for (const value of rules.fixtureValues) {
        if (!line.includes(value)) continue;
        if (RUN_ARTIFACT_PATH.test(candidate.filePath)) {
            add(
                "fixture-value-in-run-artifact",
                "blocking",
                value,
                "A declared credential value reached a run artifact. Run artifacts are the surface evidence is promoted from, so a run carrying one is not promotable.",
            );
            continue;
        }
        if (rules.fixtureValuePaths.includes(candidate.filePath)) continue;
        add(
            "fixture-value-outside-fixture-config",
            // A local note discussing the literal is not news; a committable file
            // carrying it is.
            candidate.scope === "committable" ? "blocking" : "warning",
            value,
            "A fixture credential belongs in the fixture configuration and the documents that name it, nowhere else.",
        );
    }

    for (const shape of CREDENTIAL_SHAPES) {
        for (const match of line.matchAll(shape.pattern)) {
            const value = match[1] ?? match[0];
            if (isPlaceholder(value)) continue;
            add(shape.rule, "blocking", value, shape.detail);
        }
    }

    for (const assignment of line.matchAll(CREDENTIAL_ASSIGNMENT)) {
        const quoted = assignment[1] ?? assignment[2];
        const bare = assignment[3];
        const value = quoted ?? bare;
        if (value === undefined) continue;
        if (isPlaceholder(value)) continue;
        if (rules.fixtureValues.includes(value)) continue;
        // A bare value that is a call or a member access is a reference, not a literal.
        if (bare !== undefined && isReference(line, assignment, bare)) continue;
        add(
            "credential-assignment",
            "blocking",
            value,
            "A literal value under a credential-named key is a persisted secret.",
        );
    }

    if (
        !rules.personalIdentifierPaths.includes(candidate.filePath) &&
        candidate.scope === "committable"
    ) {
        const home = HOME_PATH.exec(line);
        if (home !== null) {
            add(
                "personal-identifier",
                "warning",
                home[0],
                "An absolute home path identifies the operator's machine and account.",
            );
        }
    }

    return findings;
}

/**
 * Whether a bare assignment value is a reference rather than a literal.
 *
 * `requireFixturePassword()` and `process.env.X` occupy the same position as a
 * literal password and are not one. The character after the match decides the
 * first case — it sits outside the match, because the value pattern stops at the
 * parenthesis — and a dot inside the value decides the second.
 */
function isReference(
    line: string,
    match: RegExpMatchArray,
    value: string,
): boolean {
    const end = (match.index ?? 0) + match[0].length;
    if (line.slice(end).startsWith("(")) return true;
    return value.includes(".") && !/[/!@#$%^&*+=-]/u.test(value);
}

function isPlaceholder(value: string): boolean {
    return PLACEHOLDER_VALUE.test(value);
}

function excerptFor(line: string, value: string): string {
    const redacted = line.replace(value, redactValue(value)).trim();
    return redacted.length > 160 ? `${redacted.slice(0, 157)}...` : redacted;
}

function dedupe(findings: readonly SecretFinding[]): readonly SecretFinding[] {
    const seen = new Set<string>();
    return findings.filter((finding) => {
        const key = `${finding.rule}|${finding.filePath}|${String(finding.line)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
