import { cp, lstat, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Promoting scratch runs into the committed evidence set.
 *
 * Runs are written to a working directory while the system is being exercised;
 * `evidence/` is the deliverable a reviewer reads. Promotion is that curation
 * gate. Only finalized runs holding every required file are copied, and nothing
 * is overwritten, so what is committed stays a deliberate selection rather than
 * a directory dump of whatever happened to run.
 *
 * Validation covers every requested run before the first copy begins, so a bad
 * request fails without leaving evidence half-promoted.
 */

export interface PromoteTestRunsOptions {
    runsDirectory: string;
    evidenceDirectory: string;
    runIds: readonly string[];
}

/** One run that was promoted, and the outcome it was validated against. */
export interface PromotedTestRun {
    runId: string;
    status: "satisfied" | "error";
    sourceDirectory: string;
    evidenceDirectory: string;
}

const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const REQUIRED_RUN_FILES = [
    "README.md",
    "run.json",
    "events.jsonl",
    "trace.zip",
] as const;

/**
 * Copy finalized runs into the evidence directory.
 *
 * Run IDs are validated and de-duplicated up front, and an existing destination
 * is refused rather than merged: two evidence directories claiming the same run
 * would disagree about provenance, which is the one thing evidence cannot do.
 */
export async function promoteTestRuns(
    options: PromoteTestRunsOptions,
): Promise<readonly PromotedTestRun[]> {
    if (options.runIds.length === 0) {
        throw new Error("At least one run ID is required");
    }

    const evidenceRunsDirectory = join(options.evidenceDirectory, "runs");
    await mkdir(evidenceRunsDirectory, { recursive: true });

    const candidates: PromotedTestRun[] = [];
    const seen = new Set<string>();
    for (const runId of options.runIds) {
        validateRunId(runId);
        if (seen.has(runId)) {
            throw new Error(`Run ${runId} was requested more than once`);
        }
        seen.add(runId);

        const sourceDirectory = join(options.runsDirectory, runId);
        const destinationDirectory = join(evidenceRunsDirectory, runId);
        const status = await validateCompletedRun(sourceDirectory, runId);

        if (await pathExists(destinationDirectory)) {
            throw new Error(`Evidence run ${runId} already exists`);
        }
        candidates.push({
            runId,
            status,
            sourceDirectory,
            evidenceDirectory: destinationDirectory,
        });
    }

    for (const candidate of candidates) {
        await cp(candidate.sourceDirectory, candidate.evidenceDirectory, {
            recursive: true,
            force: false,
            errorOnExist: true,
        });
    }
    return candidates;
}

async function validateCompletedRun(
    sourceDirectory: string,
    expectedRunId: string,
): Promise<"satisfied" | "error"> {
    const manifestPath = join(sourceDirectory, "run.json");
    const manifest = parseManifest(await readFile(manifestPath, "utf8"));
    if (manifest.runId !== expectedRunId) {
        throw new Error(
            `Run manifest ID ${String(manifest.runId)} does not match ${expectedRunId}`,
        );
    }
    if (manifest.status !== "satisfied" && manifest.status !== "error") {
        throw new Error(`Run ${expectedRunId} is not finalized`);
    }

    await Promise.all(
        REQUIRED_RUN_FILES.map(async (name) => {
            const file = await stat(join(sourceDirectory, name));
            if (!file.isFile()) {
                throw new Error(`Run ${expectedRunId} has invalid ${name}`);
            }
        }),
    );
    return manifest.status;
}

function parseManifest(source: string): Record<string, unknown> {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Run manifest must be a JSON object");
    }
    return value as Record<string, unknown>;
}

function validateRunId(runId: string): void {
    if (!RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid run ID: ${runId}`);
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
