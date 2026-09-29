import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

/**
 * The production-source ratchet.
 *
 * Production code and test code serve different quality bars. Several patterns
 * below are normal and correct inside a dedicated test file and are smells inside
 * `src/`: swallowing a parse result, printing to the console, or asserting a type
 * the compiler cannot prove. This suite is the floor that keeps those from
 * spreading while a reviewer is not looking.
 *
 * The discipline is monotonic. Each budget starts at the count that was present
 * when the ratchet landed and may only be lowered. A non-zero budget is therefore
 * a recorded exception, not a target: it names patterns that exist today, and
 * every one of them has to justify itself in the `rationale` beside it. Raising a
 * budget requires changing this file, which is exactly the review the ratchet is
 * meant to force.
 *
 * WHERE THE ZEROES COME FROM
 * Several categories are already zero because the type-aware ESLint configuration
 * rejects them. They are still counted here on purpose: this suite is the floor
 * under the linter, so a rule being dropped, disabled, or mis-scoped cannot
 * silently remove the protection. A zero-budget category is cheap to keep and
 * expensive to lose.
 *
 * WHAT THIS DOES NOT COVER
 * This is a budget over text, not a semantic analysis. A pattern is counted where
 * it appears, so a comment that quotes a banned pattern counts as a hit — which is
 * why the rationales below avoid quoting their own categories verbatim.
 */

const PRODUCTION_SOURCE_DIRECTORY = "src";
const SOURCE_EXTENSION = ".ts";
const TEST_FILE_SUFFIXES = [".test.ts", "_test.ts", ".spec.ts"] as const;

/** A production file's text, held both whole and split for located reporting. */
interface SourceFile {
    filePath: string;
    source: string;
    lines: readonly string[];
}

/** One counted pattern and the budget its current count is frozen at. */
interface BannedPattern {
    label: string;
    budget: number;
    pattern: RegExp;
    rationale: string;
}

const BANNED_PATTERNS: readonly BannedPattern[] = [
    {
        label: "any-type annotation",
        budget: 0,
        pattern: /:\s*any\b/,
        rationale:
            "An untyped escape hatch erases the contract at exactly the boundary a reviewer needs to trust.",
    },
    {
        label: "double assertion",
        budget: 0,
        pattern: /\bas\s+unknown\s+as\b/,
        rationale:
            "Doubly asserting through unknown defeats the compiler twice and hides the real type relationship.",
    },
    {
        label: "compiler suppression",
        budget: 0,
        pattern: /@ts-[a-z-]/,
        rationale:
            "A suppression silences the check for the file rather than fixing the type it disagrees with.",
    },
    {
        label: "floating void dispatch",
        budget: 0,
        pattern: /^\s*void\s+\S/,
        rationale:
            "Discarding a promise with void hides a rejection. Await it or route it to an explicit handler.",
    },
    {
        label: "unvalidated parse",
        budget: 8,
        pattern: /JSON\.parse\s*\(/,
        rationale:
            "Every one is a boundary read whose result is narrowed before use: draft-artifact reads manifests, ledger lines, and trace entries through one helper; codex-run reads host event-stream lines; discovery-session-cli reads the launcher-sealed producer record; run-recorder reads its own ledger lines; interactive-playwright-session reads controller commands; evidence-promotion reads a run manifest; session-state reads the session state file; and session-control reads the control-channel response envelope. A ninth call site should have to argue for itself.",
    },
    {
        label: "console output",
        budget: 0,
        pattern: /console\.(log|info|warn|error|debug|trace|table|dir)\s*\(/,
        rationale:
            "Entry points write through print in src/common/cli.ts, so every CLI fails and reports the same way. Library modules under src/ print nothing.",
    },
    {
        label: "direct stdout write",
        budget: 2,
        pattern: /process\.stdout\.write\s*\(/,
        rationale:
            "One is print itself in src/common/cli.ts. The other is codex-run passing the host's raw event-stream bytes through unchanged, which a line-oriented print cannot do.",
    },
    {
        label: "local error-message helper",
        budget: 0,
        pattern: /^function describeError\b/,
        rationale:
            "describeError lives once in src/common/errors.ts. Ten modules once carried their own copy; a helper with a different job needs a name that says so.",
    },
    {
        label: "raw credential environment read",
        budget: 0,
        pattern: /process\.env\.[A-Z_]*(PASSWORD|TOKEN|SECRET|API_KEY)\b/,
        rationale:
            "Credentials are read through requireEnv in src/common/env.ts, which rejects a missing or blank value with one message instead of seven hand-written ones.",
    },
];

/**
 * Test-boundary hygiene: no test bodies, no test runner, in production source.
 *
 * The hygiene rules scope banned patterns to production files, and that scoping
 * is only meaningful if tests cannot live in production files. Without this check,
 * a suite could be moved inline to make a budget pass.
 */
const INLINE_TEST_BLOCK = /^\s*(?:describe|it|test)\s*\(/m;
const TEST_RUNNER_IMPORT = /from\s+"node:test"/;

const productionFiles = collectProductionFiles(PRODUCTION_SOURCE_DIRECTORY);

test("scans the production source tree", () => {
    assert.ok(
        productionFiles.length > 0,
        `expected production files under ${PRODUCTION_SOURCE_DIRECTORY}`,
    );
});

for (const banned of BANNED_PATTERNS) {
    test(`${banned.label} budget`, () => {
        const hits = findHits(productionFiles, banned.pattern);

        assert.ok(
            hits.length <= banned.budget,
            `${banned.label} budget exceeded (${String(hits.length)}/${String(banned.budget)}).\n${banned.rationale}\n${formatHits(hits)}`,
        );
    });
}

/**
 * Every production module above a trivial size opens with a file charter.
 *
 * Several authors placed the charter after the imports, or wrote none; the
 * house style is one `/** ... *\/` block as the first thing in the file. Tiny
 * data modules (a profile, a detector list) may skip it.
 */
const CHARTER_EXEMPT_MAX_LINES = 15;

test("production modules open with a file charter", () => {
    const missing = productionFiles
        .filter(
            (file) =>
                file.lines.length > CHARTER_EXEMPT_MAX_LINES &&
                !file.source.trimStart().startsWith("/**"),
        )
        .map((file) => relocatable(file.filePath));

    assert.deepEqual(
        missing,
        [],
        "Open each module with a /** ... */ charter before its imports.",
    );
});

test("production source contains no inline tests", () => {
    const offending = productionFiles
        .filter(
            (file) =>
                INLINE_TEST_BLOCK.test(file.source) ||
                TEST_RUNNER_IMPORT.test(file.source),
        )
        .map((file) => relocatable(file.filePath));

    assert.deepEqual(
        offending,
        [],
        "Test bodies and test-runner imports belong in a dedicated test file under tests/, not in src/.",
    );
});

/**
 * Read every production source file below `directory`.
 *
 * Test files are excluded by name because that exclusion *is* the boundary: a
 * pattern banned here is banned because of where it appears, not what it does.
 */
function collectProductionFiles(directory: string): SourceFile[] {
    const files: SourceFile[] = [];

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectProductionFiles(entryPath));
            continue;
        }
        if (!entry.name.endsWith(SOURCE_EXTENSION)) continue;
        if (TEST_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)))
            continue;

        const source = readFileSync(entryPath, "utf8");
        files.push({
            filePath: entryPath,
            source,
            lines: source.split("\n"),
        });
    }

    return files;
}

/** Locate every line matching `pattern`, as `path:line` for the failure message. */
function findHits(
    files: readonly SourceFile[],
    pattern: RegExp,
): readonly string[] {
    const hits: string[] = [];

    for (const file of files) {
        file.lines.forEach((line, index) => {
            if (pattern.test(line)) {
                hits.push(`${relocatable(file.filePath)}:${String(index + 1)}`);
            }
        });
    }

    return hits;
}

/** Report repository-relative paths so a failure message survives a moved checkout. */
function relocatable(filePath: string): string {
    return relative(process.cwd(), filePath);
}

/** Cap the listing so one runaway pattern cannot bury the assertion message. */
function formatHits(hits: readonly string[]): string {
    const shown = hits.slice(0, 20).join("\n");
    return hits.length > 20
        ? `${shown}\n... and ${String(hits.length - 20)} more`
        : shown;
}
