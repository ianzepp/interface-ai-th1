import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { CapabilityArtifact } from "../runtime/state-machine.js";

/**
 * Every committed capability artifact, discovered rather than listed.
 *
 * Both the audit gate in the test suite and the audit CLI need the same set, and
 * neither may depend on someone remembering to register a new capability. An
 * audit that has to be opted into is one that eventually gets skipped, so the set
 * is derived from the source tree.
 *
 * Discovery reads `src/capabilities/*.ts` and imports the compiled module for
 * each. It deliberately does not list the compiled directory: `tsc` leaves output
 * behind for a deleted source, so listing `dist/` keeps auditing capabilities that
 * no longer exist. A stale build of a deleted probe artifact is what exposed that,
 * and the source tree is the honest index.
 *
 * Each entry carries its source path because callers need to name the file — a
 * review has to point at something a reader can open — and a path reconstructed
 * from the capability id would be wrong: `ledgersmb.initialize-company` does not
 * live in `ledgersmb-initialize-company.ts`.
 *
 * LIMITS
 * - Only modules exporting an artifact-shaped value are returned. Export names
 *   vary per capability, so shape is the only stable handle.
 */

export interface CapabilityEntry {
    artifact: CapabilityArtifact;
    /** Source path relative to the repository root. */
    sourcePath: string;
}

export async function loadCapabilityArtifacts(
    repositoryRoot: string,
): Promise<readonly CapabilityEntry[]> {
    const sourceDirectory = join(repositoryRoot, "src", "capabilities");
    const compiledDirectory = join(
        repositoryRoot,
        "dist",
        "src",
        "capabilities",
    );
    const entries: CapabilityEntry[] = [];

    for (const name of (await readdir(sourceDirectory)).sort()) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;

        const sourcePath = join("src", "capabilities", name);
        const compiledPath = join(
            compiledDirectory,
            name.replace(/\.ts$/, ".js"),
        );

        let module: Record<string, unknown>;
        try {
            // A computed specifier is untyped, so the module is narrowed by
            // assertion before anything is read off it.
            module = (await import(compiledPath)) as Record<string, unknown>;
        } catch (error) {
            throw new Error(
                `could not load the compiled module for ${sourcePath}; build first`,
                { cause: error },
            );
        }

        for (const value of Object.values(module)) {
            if (isArtifact(value))
                entries.push({ artifact: value, sourcePath });
        }
    }

    return entries;
}

/**
 * Load the artifact exported by one source file.
 *
 * Reviewing a file rather than a registered id is what lets this run against an
 * artifact that is not in the tree yet — the one a lane just produced — and what
 * makes the unit of review "this file" rather than "this catalog entry".
 */
export async function loadCapabilitySource(
    repositoryRoot: string,
    sourcePath: string,
): Promise<readonly CapabilityEntry[]> {
    const compiledPath = join(
        repositoryRoot,
        "dist",
        sourcePath.replace(/\.ts$/, ".js"),
    );

    let module: Record<string, unknown>;
    try {
        module = (await import(compiledPath)) as Record<string, unknown>;
    } catch (error) {
        throw new Error(
            `could not load the compiled module for ${sourcePath}; build first`,
            { cause: error },
        );
    }

    return Object.values(module)
        .filter(isArtifact)
        .map((artifact) => ({ artifact, sourcePath }));
}

/**
 * Recognize an artifact by shape.
 *
 * Export names vary per capability, so shape is the only stable handle. The check
 * is narrow on purpose: anything matching it is an artifact, and anything that is
 * not is ignored rather than guessed at.
 */
export function isArtifact(value: unknown): value is CapabilityArtifact {
    if (value === null || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.id === "string" &&
        typeof candidate.entryStageId === "string" &&
        Array.isArray(candidate.stages)
    );
}
