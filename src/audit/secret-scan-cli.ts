import process from "node:process";

import { parseFlags } from "../authoring/flag-args.js";
import {
    collectScanCandidates,
    collectStagedCandidates,
    type SecretScanCatalog,
} from "./secret-scan-catalog.js";
import {
    DEFAULT_RULES,
    scanSecrets,
    type SecretFinding,
    type SecretSeverity,
} from "./secret-scan.js";

/**
 * Run the secret scan over this repository.
 *
 * This exists so the check does not depend on someone remembering to run an LLM
 * over the tree before a release. It answers one question — did a credential value
 * reach a file — for a curated set of patterns in the places those values
 * actually show up, and it answers it the same way every time.
 *
 * Gating is deliberately asymmetric. A blocking finding in a file Git would carry
 * fails the command, because that file ships. A blocking finding in an ignored
 * file is reported and does not fail, because every local capture corpus contains
 * them (session cookies in traces, credentials typed into a pilot's ledger) and
 * making that fatal would make the command useless on the machine where the work
 * happens. `--all` closes that gap when the question is about this disk rather
 * than about what ships.
 *
 * Exit status is 1 when a gated finding exists, so this works as a gate as well as
 * a report.
 *
 * COVERAGE
 * Binary files are counted, never scanned. Screenshots and trace archives are
 * therefore outside this command by construction; the capture path is where those
 * are protected.
 */

const flags = parseFlags(process.argv.slice(2));

if (flags.has("help")) {
    printUsage();
} else {
    try {
        await main();
    } catch (error) {
        process.stderr.write(`error: ${describeError(error)}\n`);
        process.exitCode = 1;
    }
}

async function main(): Promise<void> {
    const root = flags.get("root") ?? process.cwd();
    const includeLocal = flags.has("all");
    const staged = flags.has("staged");
    if (staged && includeLocal) {
        throw new Error(
            "--staged scans the index; --all widens to ignored files",
        );
    }
    const catalog = staged
        ? await collectStagedCandidates(root)
        : await collectScanCandidates(root);
    const findings = scanSecrets(catalog.candidates, DEFAULT_RULES);
    const gated = findings.filter(
        (finding) =>
            finding.severity === "blocking" &&
            (includeLocal || finding.scope === "committable"),
    );

    if (flags.has("json")) {
        print(
            JSON.stringify(
                {
                    root,
                    surface: staged ? "index" : "working-tree",
                    scanned: countBy(catalog.candidates, (item) => item.scope),
                    skippedBinary: catalog.skippedBinary.length,
                    skippedLarge: catalog.skippedLarge.length,
                    unreadable: catalog.unreadable,
                    findings,
                    gated: gated.length,
                },
                null,
                2,
            ),
        );
    } else {
        report(root, catalog, findings, includeLocal, staged);
    }

    if (gated.length > 0) process.exitCode = 1;
}

function report(
    root: string,
    catalog: SecretScanCatalog,
    findings: readonly SecretFinding[],
    includeLocal: boolean,
    staged: boolean,
): void {
    const committable = catalog.candidates.filter(
        (item) => item.scope === "committable",
    ).length;
    print(
        `secret scan  ${root}  (${staged ? "staged index" : "working tree"})`,
    );
    print(
        `  scanned:      ${String(catalog.candidates.length)} text files (${String(committable)} committable, ${String(catalog.candidates.length - committable)} local-only)`,
    );
    print(
        `  not scanned:  ${String(catalog.skippedBinary.length)} binary, ${String(catalog.skippedLarge.length)} oversized (counted, not read)`,
    );

    // Detail is for what gates. A local corpus always carries credentials the
    // capture path is supposed to keep out of evidence, so printing every one of
    // them by default buries the findings that decide the exit status.
    const detailed = findings.filter(
        (finding) => includeLocal || finding.scope === "committable",
    );

    for (const scope of ["committable", "local"] as const) {
        for (const severity of [
            "blocking",
            "warning",
            "note",
        ] as const satisfies readonly SecretSeverity[]) {
            const group = detailed.filter(
                (finding) =>
                    finding.scope === scope && finding.severity === severity,
            );
            if (group.length === 0) continue;
            print("");
            print(`  ${severity} · ${scope} (${String(group.length)})`);
            for (const finding of group) {
                print(`    ${finding.rule}`);
                print(`      at: ${finding.filePath}:${String(finding.line)}`);
                print(`      ${finding.excerpt}`);
                print(`      ${finding.detail}`);
            }
        }
    }

    const gated = findings.filter(
        (finding) =>
            finding.severity === "blocking" &&
            (includeLocal || finding.scope === "committable"),
    );
    const local = findings.filter((finding) => finding.scope === "local");

    if (!includeLocal && local.length > 0) {
        print("");
        print(`  ignored files, summarised (${String(local.length)})`);
        for (const line of summariseByRule(local)) print(`    ${line}`);
        print("    rerun with --all to gate on these and print them in full");
    }

    print("");
    print(
        gated.length === 0
            ? "  result: no blocking finding on the gated surface"
            : `  result: ${String(gated.length)} blocking finding(s) on the gated surface`,
    );
    print("  not covered: binary contents, image pixels, and Git history");
}

function summariseByRule(
    findings: readonly SecretFinding[],
): readonly string[] {
    const counts = new Map<string, number>();
    for (const finding of findings) {
        const key = `${finding.rule} · ${finding.severity}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([key, count]) => `${String(count)}  ${key}`);
}

function countBy<T, K extends string>(
    items: readonly T[],
    key: (item: T) => K,
): Readonly<Partial<Record<K, number>>> {
    const counts: Partial<Record<K, number>> = {};
    for (const item of items) {
        const name = key(item);
        counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
}

function print(line: string): void {
    process.stdout.write(`${line}\n`);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function printUsage(): void {
    print(`Usage:
  scripts/audit-secrets [--staged] [--all] [--json] [--root <path>]

Scans for credential values in the places they actually show up, and reports
whether each file would travel with a clone.

  --staged   scan the staged index instead of the working tree: exactly the
             content a commit would create. This is what the commit hook runs.
  --all      gate on findings in ignored files too, not only committable ones
  --json     machine-readable output
  --root     repository root to scan (default: the current directory)

Exit status is 1 when a blocking finding exists on the gated surface.

Not covered: binary contents (trace archives, snapshots), image pixels, and Git
history. Binary and oversized files are counted so a clean result is never
mistaken for proof that every artifact was inspected.

The patterns and the curated path exceptions live in
src/audit/secret-scan.ts, next to the rules, not in this file.`);
}
