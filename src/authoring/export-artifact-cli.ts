import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
    loadCapabilityArtifacts,
    type CapabilityEntry,
} from "../audit/artifact-catalog.js";
import type { CapabilityArtifact } from "../runtime/state-machine.js";

/**
 * Serialize an artifact with sorted object keys and stable two-space formatting.
 * Arrays retain their authored order because stage and candidate order is part
 * of the artifact contract.
 */
export function serializeCapabilityArtifact(
    artifact: CapabilityArtifact,
): string {
    const serialized = JSON.stringify(canonicalize(artifact), null, 2);
    return `${serialized}\n`;
}

/** Export every capability discovered in the compiled source catalog. */
export async function exportCapabilityArtifacts(
    repositoryRoot: string,
): Promise<readonly string[]> {
    const entries = [...(await loadCapabilityArtifacts(repositoryRoot))].sort(
        compareEntries,
    );
    if (entries.length === 0)
        throw new Error("no capability artifacts were found");

    const outputDirectory = join(repositoryRoot, "evidence", "capabilities");
    await mkdir(outputDirectory, { recursive: true });

    const exportedPaths: string[] = [];
    const exportedIds = new Set<string>();
    for (const entry of entries) {
        const { id } = entry.artifact;
        if (exportedIds.has(id))
            throw new Error(`duplicate capability id '${id}'`);
        exportedIds.add(id);

        const outputPath = join(outputDirectory, `${id}.json`);
        await writeFile(
            outputPath,
            serializeCapabilityArtifact(entry.artifact),
            "utf8",
        );
        exportedPaths.push(outputPath);
    }

    return exportedPaths;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
            Object.keys(record)
                .sort()
                .map((key) => [key, canonicalize(record[key])]),
        );
    }
    return value;
}

function compareEntries(left: CapabilityEntry, right: CapabilityEntry): number {
    if (left.artifact.id < right.artifact.id) return -1;
    if (left.artifact.id > right.artifact.id) return 1;
    if (left.sourcePath < right.sourcePath) return -1;
    if (left.sourcePath > right.sourcePath) return 1;
    return 0;
}

async function main(): Promise<void> {
    const paths = await exportCapabilityArtifacts(process.cwd());
    for (const path of paths) console.log(`Exported artifact: ${path}`);
}

if (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        await main();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    }
}
