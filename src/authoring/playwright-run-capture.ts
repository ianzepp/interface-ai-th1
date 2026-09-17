import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { containsSensitiveValue } from "./redaction.js";
import type { FileTestRunRecorder, TestRunOutcome } from "./run-recorder.js";

export interface TraceStartOptions {
    screenshots: true;
    snapshots: true;
    sources: false;
    title: string;
}

export interface TraceStopOptions {
    path: string;
}

export interface TraceController {
    start(options: TraceStartOptions): Promise<void>;
    stop(options: TraceStopOptions): Promise<void>;
}

export class PlaywrightTestRunCapture {
    #finished = false;
    readonly #sensitiveInputValues: readonly string[];

    private constructor(
        public readonly tracing: TraceController,
        public readonly recorder: FileTestRunRecorder,
        sensitiveInputValues: readonly string[],
    ) {
        this.#sensitiveInputValues = sensitiveInputValues;
    }

    public static async start(
        tracing: TraceController,
        recorder: FileTestRunRecorder,
        sensitiveInputValues: readonly string[] | undefined = [],
    ): Promise<PlaywrightTestRunCapture> {
        try {
            await startTrace(tracing, recorder.directory);
        } catch (error) {
            await recorder.finalize({
                status: "error",
                code: "trace-start-failed",
                summary: describeError(error),
            });
            throw error;
        }
        return new PlaywrightTestRunCapture(
            tracing,
            recorder,
            sensitiveInputValues,
        );
    }

    /** Runs an action outside the trace when it carries a declared sensitive value. */
    public async execute<T>(
        action: unknown,
        operation: () => Promise<T>,
    ): Promise<T> {
        if (!containsSensitiveValue(action, this.#sensitiveInputValues)) {
            return operation();
        }
        const temporaryDirectory = await mkdtemp(
            join(tmpdir(), "interface-ai-trace-"),
        );
        const temporaryTrace = join(temporaryDirectory, "sensitive-action.zip");
        try {
            try {
                await this.tracing.stop({ path: temporaryTrace });
            } catch (error) {
                await this.finalizeFailure("trace-suspend-failed", error);
                throw error;
            }
            let result: T | undefined;
            let actionError: unknown;
            try {
                result = await operation();
            } catch (error) {
                actionError = error;
            }
            try {
                await startTrace(this.tracing, this.recorder.directory);
            } catch (error) {
                await this.finalizeFailure("trace-suspend-failed", error);
                throw error;
            }
            if (actionError !== undefined) throw toError(actionError);
            return result as T;
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }

    public async finish(outcome: TestRunOutcome): Promise<void> {
        if (this.#finished) {
            throw new Error("Playwright test run capture is already finished");
        }
        this.#finished = true;
        const temporaryDirectory = await mkdtemp(
            join(tmpdir(), "interface-ai-trace-"),
        );
        const candidateTrace = join(temporaryDirectory, "trace.zip");
        try {
            await this.tracing.stop({ path: candidateTrace });
            if (
                await evidenceContainsSensitiveValue(
                    candidateTrace,
                    this.recorder.directory,
                    this.#sensitiveInputValues,
                )
            ) {
                await this.recorder.finalize({
                    status: "error",
                    code: "sensitive-evidence-detected",
                    summary:
                        "A declared sensitive value was detected in capture evidence.",
                });
                return;
            }
            const trace = await readFile(candidateTrace);
            await writeFile(this.recorder.tracePath, trace);
            await this.recorder.finalize(outcome);
        } catch (error) {
            await this.finalizeFailure("trace-stop-failed", error);
            throw error;
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }

    async finalizeFailure(code: string, error: unknown): Promise<void> {
        if (!this.#finished) this.#finished = true;
        await this.recorder.finalize({
            status: "error",
            code,
            summary: describeError(error),
        });
    }
}

async function startTrace(
    tracing: TraceController,
    directory: string,
): Promise<void> {
    await tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
        title: directory,
    });
}

async function evidenceContainsSensitiveValue(
    tracePath: string,
    runDirectory: string,
    sensitiveInputValues: readonly string[],
): Promise<boolean> {
    if (sensitiveInputValues.length === 0) return false;
    const candidates = [
        tracePath,
        ...(await filesUnder(join(runDirectory, "screenshots"))),
    ];
    for (const path of candidates) {
        const content = await readFile(path);
        if (
            sensitiveInputValues.some((value) =>
                content.includes(Buffer.from(value)),
            )
        )
            return true;
    }
    return false;
}

async function filesUnder(directory: string): Promise<string[]> {
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        return (
            await Promise.all(
                entries.map(async (entry) => {
                    const path = join(directory, entry.name);
                    return entry.isDirectory() ? filesUnder(path) : [path];
                }),
            )
        ).flat();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
