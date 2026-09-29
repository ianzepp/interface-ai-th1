/**
 * Review capability artifacts on demand, as a report and as a gate.
 *
 * The mechanical pass always runs: it is free, fast, and deterministic. The
 * model pass is opt-in, because it costs money and time and because a
 * mechanical finding needs no model to confirm. The two stay separate in the
 * output: findings a program decided are facts, findings a model decided are
 * opinions, and a reader should be able to tell which is which.
 *
 * EXIT CODES
 * - 0: no audited artifact carries a blocking finding.
 * - 1: an audited artifact carries a blocking finding, or the audit failed.
 *
 * INVARIANTS
 * - The reviewer is fixed by default to one model and effort level, because
 *   comparing reviews of different artifacts is only meaningful if the same
 *   reviewer produced them.
 * - The reviewer never edits. It is prompted to report, and the artifact is left
 *   exactly as the author wrote it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { runCodexSession } from "../authoring/codex-run.js";
import { parseFlags } from "../authoring/flag-args.js";
import { print, runMain } from "../common/cli.js";
import {
    loadCapabilityArtifacts,
    loadCapabilitySource,
    type CapabilityEntry,
} from "./artifact-catalog.js";
import { auditArtifact, type AuditFinding } from "./artifact-rubric.js";
import { buildAuditPrompt } from "./audit-prompt.js";

interface ReviewOptions {
    model: string;
    reasoningEffort: string;
    sandbox: string;
    timeoutMs: number;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.has("help")) {
        printUsage();
        return;
    }

    const source = flags.get("source");
    const reviewOptions: ReviewOptions = {
        model: flags.get("model") ?? "gpt-5.6-sol",
        reasoningEffort: flags.get("reasoning-effort") ?? "medium",
        sandbox: flags.get("codex-sandbox") ?? "danger-full-access",
        timeoutMs: Number(flags.get("timeout") ?? 1_800_000),
    };
    const entries =
        source === undefined
            ? selectEntries(
                  await loadCapabilityArtifacts(process.cwd()),
                  flags.get("capability"),
              )
            : await loadCapabilitySource(process.cwd(), source);
    if (entries.length === 0) {
        // Silence here would read as "audited and clean", which is the opposite of
        // what an empty result means.
        throw new Error(
            source === undefined
                ? "no capability artifacts were found"
                : `no artifact is exported by ${source}`,
        );
    }
    let blocked = false;

    for (const entry of entries) {
        const findings = auditArtifact(entry.artifact);
        printFindings(entry, findings);
        if (findings.some((finding) => finding.severity === "blocking")) {
            blocked = true;
        }
        if (flags.has("model-review")) {
            await runModelReview(entry, findings, reviewOptions);
        }
    }

    if (blocked) process.exitCode = 1;
}

await runMain(main);

function printUsage(): void {
    print(`Usage:
  scripts/audit-artifact [--capability <id>] [options]

Audits one capability artifact, or every artifact when no id is given. The
mechanical rubric always runs; the model review is opt-in.

Options:
  --capability <id>        Audit one artifact instead of all of them.
  --source <path>          Audit the artifact in one source file, whether or not
                           it is registered. Useful for a file a lane just wrote.
  --model-review           Also run the model review pass.
  --model <model>          Model for the review. Defaults to gpt-5.6-sol.
  --reasoning-effort <level>  Defaults to medium. Keeping the reviewer fixed is
                           what makes reviews of different artifacts comparable.
  --codex-sandbox <mode>   read-only, workspace-write, or danger-full-access.
  --timeout <ms>           Review budget. Defaults to 1800000.

Exit status is 1 when an audited artifact carries a blocking finding.

Reviewer output lands in tmp/audit/, one report per capability.
`);
}

/** The requested artifact, or all of them when none is requested. */
function selectEntries(
    entries: readonly CapabilityEntry[],
    requested: string | undefined,
): readonly CapabilityEntry[] {
    if (requested === undefined) return entries;

    const selected = entries.filter((entry) => entry.artifact.id === requested);
    if (selected.length === 0) {
        throw new Error(
            `no capability with id '${requested}'; known ids: ${entries
                .map((entry) => entry.artifact.id)
                .join(", ")}`,
        );
    }
    return selected;
}

function printFindings(
    entry: CapabilityEntry,
    findings: readonly AuditFinding[],
): void {
    print("");
    print(`## ${entry.artifact.id}  (${entry.sourcePath})`);

    if (findings.length === 0) {
        print("  no findings");
        return;
    }
    for (const severity of ["blocking", "warning", "note"] as const) {
        const group = findings.filter(
            (finding) => finding.severity === severity,
        );
        if (group.length === 0) continue;
        print("");
        print(`  ${severity} (${String(group.length)})`);
        for (const finding of group) {
            print(`    ${finding.rule}`);
            print(`      at: ${finding.subject}`);
            print(`      ${finding.detail}`);
        }
    }
}

/** Run the model pass for one artifact and print the review it wrote. */
async function runModelReview(
    entry: CapabilityEntry,
    findings: readonly AuditFinding[],
    options: ReviewOptions,
): Promise<void> {
    const directory = join(process.cwd(), "tmp", "audit");
    await mkdir(directory, { recursive: true });

    const slug = entry.artifact.id.replace(/[^a-z0-9]+/gi, "-");
    const reportPath = join(directory, `${slug}.md`);
    const promptPath = join(directory, `${slug}-prompt.md`);
    const lastMessagePath = join(directory, `${slug}-last-message.md`);

    const prompt = buildAuditPrompt({
        capabilityId: entry.artifact.id,
        artifactPath: entry.sourcePath,
        reportPath,
        mechanicalFindings: findings.map(
            (finding) =>
                `${finding.severity}: ${finding.rule} (${finding.subject})`,
        ),
    });
    await writeFile(promptPath, `${prompt}\n`, "utf8");

    print("");
    print(
        `  model review: ${options.model} at ${options.reasoningEffort}, prompt ${promptPath}`,
    );

    const status = await runCodexSession({
        prompt,
        workingDirectory: process.cwd(),
        outputPath: lastMessagePath,
        sandbox: options.sandbox,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        timeoutMs: options.timeoutMs,
    });

    print(`  model review: ${status}`);
    const body =
        (await readTextOrNull(reportPath)) ??
        (await readTextOrNull(lastMessagePath));
    if (body !== null) {
        print("");
        print(body.trimEnd());
    }
}

async function readTextOrNull(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch {
        return null;
    }
}
