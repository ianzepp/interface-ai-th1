/**
 * Operator entry point for draft extraction: `npm run draft:artifact`.
 *
 * Everything here is argument parsing, module loading, and operator-facing output.
 * The extraction itself lives in `draft-artifact.ts`, which keeps that module
 * free of process arguments and dynamic imports.
 *
 * `--compare` is the review aid: it diffs the generated draft against an existing
 * compiled artifact by observed stage order and reports exact action and detector
 * matches, which is how a reviewer sees the distance between a mechanical draft
 * and the reviewed graph it is meant to approximate.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
    buildDraftArtifact,
    compareArtifacts,
    readSuccessfulRun,
    type ArtifactComparison,
} from "./draft-artifact.js";
import type { CapabilityArtifact } from "../runtime/state-machine.js";

interface Options {
    runDirectory: string;
    capabilityId: string;
    outputPath: string;
    comparisonPath?: string;
    comparisonExport?: string;
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
} else {
    const options = parseOptions(argv);
    if (options === null) {
        printUsage();
        process.exitCode = 2;
    } else {
        await run(options);
    }
}

async function run(options: Options): Promise<void> {
    const runEvidence = await readSuccessfulRun(options.runDirectory);
    const draft = buildDraftArtifact({
        ...runEvidence,
        capabilityId: options.capabilityId,
    });
    await writeJson(options.outputPath, draft);

    console.log(`Draft written: ${options.outputPath}`);
    console.log(
        `Source run: ${draft.source.runId}; ${String(draft.source.actionCount)} ledger actions; ${String(draft.source.trace.actionCount)} trace actions`,
    );
    console.log(
        `Draft artifact: ${draft.artifact.id}; ${String(draft.artifact.stages.length)} stages; ${String(draft.warnings.length)} warnings`,
    );

    if (options.comparisonPath !== undefined) {
        const current = await loadCapabilityArtifact(
            options.comparisonPath,
            options.comparisonExport,
        );
        const comparison = compareArtifacts(draft.artifact, current);
        const comparisonPath = options.comparisonPath.endsWith(".json")
            ? options.comparisonPath.replace(/\.json$/, ".comparison.json")
            : `${options.outputPath.replace(/\.json$/, "")}.comparison.json`;
        await writeJson(comparisonPath, comparison);
        printComparison(comparison, comparisonPath);
    }
}

function parseOptions(argv: readonly string[]): Options | null {
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

    const options: Options = {
        runDirectory,
        capabilityId,
        outputPath:
            values.get("--out") ??
            `tmp/drafts/${capabilityId.replaceAll(".", "-")}.json`,
    };
    const comparisonPath = values.get("--compare");
    if (comparisonPath !== undefined) options.comparisonPath = comparisonPath;
    const comparisonExport = values.get("--compare-export");
    if (comparisonExport !== undefined)
        options.comparisonExport = comparisonExport;
    return options;
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
    console.log(`Comparison written: ${comparisonPath}`);
    console.log(
        `Stages: draft ${String(comparison.draftStageCount)}, current ${String(comparison.currentStageCount)}`,
    );
    console.log(
        `Exact action matches: ${String(comparison.exactActionMatches)}/${String(comparison.currentStageCount)}`,
    );
    console.log(
        `Exact detector matches: ${String(comparison.exactDetectorMatches)}/${String(comparison.currentStageCount)}`,
    );
    console.log(
        `Exact detector-signal matches: ${String(comparison.exactDetectorSignalMatches)}/${String(comparison.currentStageCount)}`,
    );
    if (comparison.differentTopLevelFields.length > 0)
        console.log(
            `Different top-level fields: ${comparison.differentTopLevelFields.join(", ")}`,
        );
    for (const stage of comparison.stageComparisons) {
        if (stage.differentFields.length === 0) continue;
        console.log(
            `Stage ${String(stage.index)} (${stage.draftStageId ?? "missing"} vs ${stage.currentStageId ?? "missing"}): ${stage.differentFields.join(", ")}`,
        );
    }
}

function printUsage(): void {
    console.log(`Usage:
  npm run draft:artifact -- --run <run-directory> --id <capability-id> [options]

Options:
  --out <path>                    Draft JSON output path
  --compare <compiled-module>     Compare with a compiled artifact module
  --compare-export <name>         Export containing the current artifact
`);
}
