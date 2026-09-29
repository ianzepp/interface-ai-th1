/**
 * Operator entry point for draft extraction: `npm run draft:artifact`.
 *
 * Argument parsing, module loading, and operator-facing output live here; the
 * extraction itself lives in `draft-artifact.ts`, which stays free of process
 * arguments and dynamic imports.
 *
 * `--compare` is the review aid: it diffs the draft against an existing
 * compiled artifact by observed stage order and reports exact action and
 * detector matches, showing how far the mechanical draft is from the reviewed
 * graph it approximates.
 *
 * EXIT CODES
 * - 1 when the run cannot be drafted or the comparison artifact is missing.
 * - 2 for a malformed argument list.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { print, runMain } from "../common/cli.js";
import type { CapabilityArtifact } from "../runtime/state-machine.js";
import {
    buildDraftArtifact,
    compareArtifacts,
    readSuccessfulRun,
    type ArtifactComparison,
} from "./draft-artifact.js";

interface DraftOptions {
    runDirectory: string;
    capabilityId: string;
    outputPath: string;
    /** A compiled module holding the artifact to compare against. */
    comparisonPath: string | undefined;
    comparisonExport: string | undefined;
}

await runMain(main);

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (argv.includes("--help") || argv.includes("-h")) {
        printUsage();
        return;
    }
    const options = parseOptions(argv);
    if (options === null) {
        printUsage();
        process.exitCode = 2;
        return;
    }

    const runEvidence = await readSuccessfulRun(options.runDirectory);
    const draft = buildDraftArtifact({
        ...runEvidence,
        capabilityId: options.capabilityId,
    });
    await writeJson(options.outputPath, draft);

    print(`Draft written: ${options.outputPath}`);
    print(
        `Source run: ${draft.source.runId}; ${String(draft.source.actionCount)} ledger actions; ${String(draft.source.trace.actionCount)} trace actions`,
    );
    print(
        `Draft artifact: ${draft.artifact.id}; ${String(draft.artifact.stages.length)} stages; ${String(draft.warnings.length)} warnings`,
    );

    if (options.comparisonPath !== undefined) {
        const current = await loadCapabilityArtifact(
            options.comparisonPath,
            options.comparisonExport,
        );
        const comparison = compareArtifacts(draft.artifact, current);
        const comparisonOutputPath = options.comparisonPath.endsWith(".json")
            ? options.comparisonPath.replace(/\.json$/, ".comparison.json")
            : `${options.outputPath.replace(/\.json$/, "")}.comparison.json`;
        await writeJson(comparisonOutputPath, comparison);
        printComparison(comparison, comparisonOutputPath);
    }
}

/** Read `--flag value` pairs, or `null` when the argument list is malformed. */
function parseOptions(argv: readonly string[]): DraftOptions | null {
    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument?.startsWith("--")) return null;
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) return null;
        values.set(argument, value);
        index += 1;
    }

    const runDirectory = values.get("--run");
    const capabilityId = values.get("--id");
    if (runDirectory === undefined || capabilityId === undefined) return null;

    return {
        runDirectory,
        capabilityId,
        outputPath:
            values.get("--out") ??
            `tmp/drafts/${capabilityId.replaceAll(".", "-")}.json`,
        comparisonPath: values.get("--compare"),
        comparisonExport: values.get("--compare-export"),
    };
}

async function loadCapabilityArtifact(
    modulePath: string,
    exportName: string | undefined,
): Promise<CapabilityArtifact> {
    const module = (await import(
        pathToFileURL(resolve(modulePath)).href
    )) as Record<string, unknown>;
    const candidate =
        exportName === undefined
            ? Object.values(module).find(isCapabilityArtifact)
            : module[exportName];
    if (!isCapabilityArtifact(candidate)) {
        throw new Error(
            `Could not find a CapabilityArtifact in ${modulePath}${exportName === undefined ? "" : ` export ${exportName}`}`,
        );
    }
    return candidate;
}

function isCapabilityArtifact(value: unknown): value is CapabilityArtifact {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const candidate = value as Partial<CapabilityArtifact>;
    return (
        typeof candidate.id === "string" &&
        typeof candidate.entryStageId === "string" &&
        Array.isArray(candidate.stages) &&
        candidate.contract !== undefined &&
        candidate.policy !== undefined
    );
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printComparison(
    comparison: ArtifactComparison,
    comparisonPath: string,
): void {
    print(`Comparison written: ${comparisonPath}`);
    print(
        `Stages: draft ${String(comparison.draftStageCount)}, current ${String(comparison.currentStageCount)}`,
    );
    print(
        `Exact action matches: ${String(comparison.exactActionMatches)}/${String(comparison.currentStageCount)}`,
    );
    print(
        `Exact detector matches: ${String(comparison.exactDetectorMatches)}/${String(comparison.currentStageCount)}`,
    );
    print(
        `Exact detector-signal matches: ${String(comparison.exactDetectorSignalMatches)}/${String(comparison.currentStageCount)}`,
    );
    if (comparison.differentTopLevelFields.length > 0)
        print(
            `Different top-level fields: ${comparison.differentTopLevelFields.join(", ")}`,
        );
    for (const stage of comparison.stageComparisons) {
        if (stage.differentFields.length === 0) continue;
        print(
            `Stage ${String(stage.index)} (${stage.draftStageId ?? "missing"} vs ${stage.currentStageId ?? "missing"}): ${stage.differentFields.join(", ")}`,
        );
    }
}

function printUsage(): void {
    print(`Usage:
  npm run draft:artifact -- --run <run-directory> --id <capability-id> [options]

Options:
  --out <path>                    Draft JSON output path
  --compare <compiled-module>     Compare with a compiled artifact module
  --compare-export <name>         Export containing the current artifact
`);
}
