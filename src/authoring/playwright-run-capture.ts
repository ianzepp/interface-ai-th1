import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ArtifactPolicy } from "../runtime/policy.js";
import type { SurfaceAction } from "../surfaces/surface-driver.js";
import { containsSensitiveValue } from "./redaction.js";
import type { FileTestRunRecorder, TestRunOutcome } from "./run-recorder.js";

const execFileAsync = promisify(execFile);
const TRACE_SCAN_MAX_BUFFER = 64 * 1024 * 1024;

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

/**
 * Scans decompressed trace archive members for declared values. Screenshot pixels
 * are not scanned: byte matching cannot recover values merely rendered in PNGs.
 */
async function evidenceContainsSensitiveValue(
    tracePath: string,
    sensitiveInputValues: readonly string[],
): Promise<boolean> {
    if (sensitiveInputValues.length === 0) return false;
    const members = await traceMembers(tracePath);
    for (const member of members) {
        const content = await traceMemberContent(tracePath, member);
        if (
            sensitiveInputValues.some((value) =>
                content.includes(Buffer.from(value)),
            )
        )
            return true;
    }
    return false;
}

async function traceMembers(tracePath: string): Promise<readonly string[]> {
    const { stdout } = await execFileAsync("unzip", ["-Z1", tracePath], {
        encoding: "utf8",
        maxBuffer: TRACE_SCAN_MAX_BUFFER,
    });
    return stdout.split("\n").filter((member) => member.length > 0);
}

async function traceMemberContent(
    tracePath: string,
    member: string,
): Promise<Buffer> {
    const { stdout } = await execFileAsync("unzip", ["-p", tracePath, member], {
        encoding: "buffer",
        maxBuffer: TRACE_SCAN_MAX_BUFFER,
    });
    return stdout;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
