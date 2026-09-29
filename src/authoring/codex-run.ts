/**
 * One bounded `codex exec` invocation.
 *
 * The authoring launcher and the artifact reviewer both run Codex
 * non-interactively and differ only in prompt and flags, so the spawn, the
 * optional model and reasoning-effort overrides, and the timeout live here once.
 * The model and effort are passed only when supplied; otherwise codex resolves
 * them from the operator's global configuration.
 *
 * INVARIANTS
 * - A session that overruns its budget is signalled, not abandoned. Callers
 *   cannot leave a Codex process running by returning early.
 * - Output stays visible while a session runs: the plain variant inherits it,
 *   and the capturing variant tees it. The final message is read from the file
 *   codex writes.
 * - A captured stream digest is final once the run settles; output that arrives
 *   later is still shown but never hashed.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

export interface CodexRunOptions {
    prompt: string;
    workingDirectory: string;
    /** Where `--output-last-message` writes the session's final message. */
    outputPath: string;
    sandbox: string;
    model?: string | undefined;
    reasoningEffort?: string | undefined;
    timeoutMs: number;
    /** Extra environment for the host process, e.g. the producer seal path. */
    extraEnv?: Record<string, string>;
}

export type CodexRunStatus = "exited" | "timeout" | "failed";

/** Session identity the host reported about itself in its own event stream. */
export interface HostStreamIdentity {
    sessionId: string | null;
    resolvedModel: string | null;
}

/** What the launcher captured from the host's JSON event stream. */
export interface CodexStreamCapture {
    /** sha256 over the exact captured stream bytes. */
    streamDigest: string;
    identity: HostStreamIdentity;
}

export interface CodexRunResult {
    status: CodexRunStatus;
    exitCode: number | null;
    capture: CodexStreamCapture;
}

/** Run one host session with its output inherited, resolving how it ended. */
export function runCodexSession(
    options: CodexRunOptions,
): Promise<CodexRunStatus> {
    const child = spawn("codex", buildCodexArgs(options, false), {
        stdio: "inherit",
        env: { ...process.env, ...options.extraEnv },
    });

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            resolve("timeout");
        }, options.timeoutMs);

        child.on("error", () => {
            clearTimeout(timer);
            resolve("failed");
        });
        child.on("exit", () => {
            clearTimeout(timer);
            resolve("exited");
        });
    });
}

/**
 * Run one host session while capturing its JSON event stream.
 *
 * Codex is asked for `--json` so the launcher can seal what the host said about
 * itself: a sha256 digest over the stream bytes plus the session identity and
 * resolved model the host reported in its own events.
 *
 * The identity scan is best-effort by design: field shapes drift between codex
 * versions, so the seal records whatever the host reported, including nothing,
 * rather than guessing an identity it did not see.
 */
export function runCodexSessionWithCapture(
    options: CodexRunOptions,
): Promise<CodexRunResult> {
    const child = spawn("codex", buildCodexArgs(options, true), {
        stdio: ["inherit", "pipe", "inherit"],
        env: { ...process.env, ...options.extraEnv },
    });

    const hash = createHash("sha256");
    const identity: HostStreamIdentity = {
        sessionId: null,
        resolvedModel: null,
    };
    let isSettled = false;
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        // A timed-out host can still flush while it dies; the digest is final.
        if (isSettled) return;
        hash.update(chunk);
        buffer += chunk.toString("utf8");
        const newline = buffer.lastIndexOf("\n");
        if (newline === -1) return;
        for (const line of buffer.slice(0, newline).split("\n")) {
            scanHostIdentityLine(line, identity);
        }
        buffer = buffer.slice(newline + 1);
    });

    return new Promise((resolve) => {
        const finish = (status: CodexRunStatus, exitCode: number | null) => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            resolve({
                status,
                exitCode,
                capture: {
                    streamDigest: hash.digest("hex"),
                    identity: { ...identity },
                },
            });
        };

        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            finish("timeout", null);
        }, options.timeoutMs);

        child.on("error", () => {
            finish("failed", null);
        });
        child.on("close", (code) => {
            for (const line of buffer.split("\n")) {
                scanHostIdentityLine(line, identity);
            }
            finish("exited", code);
        });
    });
}

/**
 * Record the first session id and model a host event line reports.
 *
 * Non-JSON lines and events without those fields are ignored, and a field
 * already set is never overwritten.
 */
export function scanHostIdentityLine(
    line: string,
    identity: HostStreamIdentity,
): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let value: unknown;
    try {
        value = JSON.parse(trimmed);
    } catch {
        return;
    }
    const event = readRecord(value);
    if (event === null) return;
    const session = readRecord(event.session);
    const thread = readRecord(event.thread);
    // codex 0.158 reports its session only as `thread.started`'s top-level
    // `thread_id`, and reports no model at all; the other shapes are kept for
    // versions that nest them.
    identity.sessionId ??=
        readString(event.thread_id) ??
        readString(event.session_id) ??
        readString(session?.id) ??
        readString(thread?.id);
    identity.resolvedModel ??=
        readString(event.model) ??
        readString(session?.model) ??
        readString(thread?.model);
}

function buildCodexArgs(options: CodexRunOptions, isJson: boolean): string[] {
    const args = [
        "exec",
        "--cd",
        options.workingDirectory,
        "--sandbox",
        options.sandbox,
        "--output-last-message",
        options.outputPath,
    ];
    if (isJson) args.push("--json");
    if (options.model !== undefined) args.push("--model", options.model);
    if (options.reasoningEffort !== undefined) {
        args.push("-c", `model_reasoning_effort=${options.reasoningEffort}`);
    }
    args.push(options.prompt);
    return args;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** A non-empty string, or `null` for anything else. */
function readString(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null;
}
