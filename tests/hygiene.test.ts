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
            "Every one is a boundary read whose result is immediately narrowed rather than trusted: run manifests, event ledger lines, trace entries, external controller commands, the control-channel response envelope, and the session state file. The budget is a ceiling, not an endorsement: it was raised from six to eight to admit the control bridge, and a ninth call site should have to argue for itself the same way.",
    },
    {
        label: "console output",
        budget: 21,
        pattern: /console\.(log|info|warn|error|debug|trace|table|dir)\s*\(/,
        rationale:
            "Every one is operator-facing output in a process entry point: the capture pilots, the draft CLI, the replay runners, and the export-artifact CLI. Library modules under src/ print nothing. The budget includes the two output lines in the customer-with-contact replay entry point; a new call outside those entry points is the change this budget exists to catch.",
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
