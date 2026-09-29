/**
 * Run the secret scan over a repository, as a report and as a gate.
 *
 * Gating is deliberately asymmetric. A blocking finding in a file Git would
 * carry fails the command, because that file ships. A blocking finding in an
 * ignored file is reported and does not fail, because every local capture
 * corpus contains them (session cookies in traces, credentials typed into a
 * pilot's ledger), and making that fatal would make the command useless on the
 * machine where the work happens. `--all` gates on ignored files too.
 *
 * EXIT CODES
 * - 0: no blocking finding on the gated surface.
 * - 1: a blocking finding on the gated surface, or the scan failed.
 *
 * LIMITS
 * - Binary files are counted, never scanned. Screenshots and trace archives are
 *   outside this command by construction; the capture path protects those.
 */

import process from "node:process";

import { parseFlags } from "../authoring/flag-args.js";
import { print, runMain } from "../common/cli.js";
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

interface ScanOptions {
    /** Gate on, and print in full, findings in ignored files too. */
    includeLocal: boolean;
    /** Scan the staged index instead of the working tree. */
    staged: boolean;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.has("help")) {
        printUsage();
        return;
    }

    const root = flags.get("root") ?? process.cwd();
    const options: ScanOptions = {
        includeLocal: flags.has("all"),
        staged: flags.has("staged"),
    };
    if (options.staged && options.includeLocal) {
        throw new Error(
            "--staged scans the index; --all widens to ignored files",
        );
    }
    const catalog = options.staged
        ? await collectStagedCandidates(root)
        : await collectScanCandidates(root);
    const findings = scanSecrets(catalog.candidates, DEFAULT_RULES);
    const gated = findings.filter(
        (finding) =>
            finding.severity === "blocking" &&
            isOnGatedSurface(finding, options),
    );

    if (flags.has("json")) {
        print(
            JSON.stringify(
                {
                    root,
                    surface: options.staged ? "index" : "working-tree",
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
        printReport(root, catalog, findings, gated.length, options);
    }

    if (gated.length > 0) process.exitCode = 1;
}

await runMain(main);

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

function isOnGatedSurface(
    finding: SecretFinding,
    options: ScanOptions,
): boolean {
    return options.includeLocal || finding.scope === "committable";
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

function printReport(
    root: string,
    catalog: SecretScanCatalog,
    findings: readonly SecretFinding[],
    gatedCount: number,
    options: ScanOptions,
): void {
    const committable = catalog.candidates.filter(
        (item) => item.scope === "committable",
    ).length;
    print(
        `secret scan  ${root}  (${options.staged ? "staged index" : "working tree"})`,
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
    printFindingGroups(
        findings.filter((finding) => isOnGatedSurface(finding, options)),
    );

    const local = findings.filter((finding) => finding.scope === "local");
    if (!options.includeLocal && local.length > 0) {
        print("");
        print(`  ignored files, summarised (${String(local.length)})`);
        for (const line of summariseByRule(local)) print(`    ${line}`);
        print("    rerun with --all to gate on these and print them in full");
    }

    print("");
    print(
        gatedCount === 0
            ? "  result: no blocking finding on the gated surface"
            : `  result: ${String(gatedCount)} blocking finding(s) on the gated surface`,
    );
    print("  not covered: binary contents, image pixels, and Git history");
}

/** Print findings grouped by scope, then severity, most severe first. */
function printFindingGroups(findings: readonly SecretFinding[]): void {
    for (const scope of ["committable", "local"] as const) {
        for (const severity of [
            "blocking",
            "warning",
            "note",
        ] as const satisfies readonly SecretSeverity[]) {
            const group = findings.filter(
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
