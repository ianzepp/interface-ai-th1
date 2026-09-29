/**
 * Playwright trace capture bound to one recorded run.
 *
 * The capture starts a trace with the run, keeps actions that carry a declared
 * sensitive value out of it, and saves the trace into the run directory only
 * after scanning it. Every capture failure finalizes the run as an error with
 * a code, so a broken trace never leaves a run looking unfinished.
 *
 * INVARIANTS
 * - A candidate trace is written to a temporary directory and copied into the
 *   run only when no declared sensitive value appears in any archive member.
 * - A contaminated trace finalizes the run as `sensitive-evidence-detected` and
 *   is discarded.
 *
 * LIMITS
 * - Screenshot pixels are not scanned: byte matching cannot recover values
 *   merely rendered in PNGs.
 * - Archive scanning shells out to `unzip`, which must be on `PATH`.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describeError } from "../common/errors.js";
import type { ArtifactPolicy } from "../runtime/policy.js";
import type { SurfaceAction } from "../surfaces/surface-driver.js";
import { containsSensitiveValue } from "./redaction.js";
import type { FileRunRecorder, RunOutcome } from "./run-recorder.js";

const TRACE_SCAN_MAX_BUFFER = 64 * 1024 * 1024;

const execFileAsync = promisify(execFile);

export interface TraceStartOptions {
    screenshots: true;
    snapshots: true;
    sources: false;
    title: string;
}

export interface TraceStopOptions {
    path: string;
}

/** The slice of Playwright's `context.tracing` this capture drives. */
export interface TraceController {
    start(options: TraceStartOptions): Promise<void>;
    stop(options: TraceStopOptions): Promise<void>;
}

/** Evaluate a scripted action before allowing its browser operation to begin. */
export async function executePolicyBoundAction<T>(
    policy: ArtifactPolicy,
    action: SurfaceAction,
    operation: () => Promise<T>,
): Promise<T> {
    const decision = policy.evaluate(action);
    if (decision.type !== "allow") {
        throw new Error(`Action blocked by policy: ${decision.reason}`);
    }
    return operation();
}

/** One run's Playwright trace, from start through a scanned, saved archive. */
export class PlaywrightRunCapture {
    readonly #tracing: TraceController;
    readonly #recorder: FileRunRecorder;
    readonly #sensitiveInputValues: readonly string[];
    #finished = false;

    private constructor(
        tracing: TraceController,
        recorder: FileRunRecorder,
        sensitiveInputValues: readonly string[],
    ) {
        this.#tracing = tracing;
        this.#recorder = recorder;
        this.#sensitiveInputValues = sensitiveInputValues;
    }

    /** Start tracing, finalizing the run as `trace-start-failed` on failure. */
    public static async start(
        tracing: TraceController,
        recorder: FileRunRecorder,
        sensitiveInputValues: readonly string[] | undefined = [],
    ): Promise<PlaywrightRunCapture> {
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
        return new PlaywrightRunCapture(
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
            await this.#finalizeOnFailure("trace-suspend-failed", () =>
                this.#tracing.stop({ path: temporaryTrace }),
            );
            let result: T | undefined;
            let actionError: unknown;
            try {
                result = await operation();
            } catch (error) {
                actionError = error;
            }
            // Tracing resumes even after a failed action, so the rest of the
            // run is still captured.
            await this.#finalizeOnFailure("trace-suspend-failed", () =>
                startTrace(this.#tracing, this.#recorder.directory),
            );
            if (actionError !== undefined) throw toError(actionError);
            return result as T;
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }

    /** Stop tracing, scan the candidate trace, save it, and finalize the run. */
    public async finish(outcome: RunOutcome): Promise<void> {
        if (this.#finished) {
            throw new Error("Playwright run capture is already finished");
        }
        this.#finished = true;
        const temporaryDirectory = await mkdtemp(
            join(tmpdir(), "interface-ai-trace-"),
        );
        const candidateTrace = join(temporaryDirectory, "trace.zip");
        try {
            await this.#tracing.stop({ path: candidateTrace });
            if (
                await traceContainsSensitiveValue(
                    candidateTrace,
                    this.#sensitiveInputValues,
                )
            ) {
                await this.#recorder.finalize({
                    status: "error",
                    code: "sensitive-evidence-detected",
                    summary:
                        "A declared sensitive value was detected in capture evidence.",
                });
                return;
            }
            const trace = await readFile(candidateTrace);
            await writeFile(this.#recorder.tracePath, trace);
            await this.#recorder.finalize(outcome);
        } catch (error) {
            await this.#finalizeFailure("trace-stop-failed", error);
            throw error;
        } finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }

    /** Run one trace step, finalizing the run as `code` if it throws. */
    async #finalizeOnFailure(
        code: string,
        step: () => Promise<void>,
    ): Promise<void> {
        try {
            await step();
        } catch (error) {
            await this.#finalizeFailure(code, error);
            throw error;
        }
    }

    async #finalizeFailure(code: string, error: unknown): Promise<void> {
        this.#finished = true;
        await this.#recorder.finalize({
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

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/** Whether any decompressed trace archive member holds a declared value. */
async function traceContainsSensitiveValue(
    tracePath: string,
    sensitiveInputValues: readonly string[],
): Promise<boolean> {
    if (sensitiveInputValues.length === 0) return false;
    for (const member of await listTraceMembers(tracePath)) {
        const content = await readTraceMember(tracePath, member);
        if (
            sensitiveInputValues.some((value) =>
                content.includes(Buffer.from(value)),
            )
        )
            return true;
    }
    return false;
}

async function listTraceMembers(tracePath: string): Promise<readonly string[]> {
    const { stdout } = await execFileAsync("unzip", ["-Z1", tracePath], {
        encoding: "utf8",
        maxBuffer: TRACE_SCAN_MAX_BUFFER,
    });
    return stdout.split("\n").filter((member) => member.length > 0);
}

async function readTraceMember(
    tracePath: string,
    member: string,
): Promise<Buffer> {
    const { stdout } = await execFileAsync("unzip", ["-p", tracePath, member], {
        encoding: "buffer",
        maxBuffer: TRACE_SCAN_MAX_BUFFER,
    });
    return stdout;
}
