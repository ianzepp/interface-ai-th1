import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

/**
 * One bounded `codex exec` invocation.
 *
 * Two callers run Codex non-interactively: the authoring launcher and the artifact
 * reviewer. They differ only in prompt and flags, so the spawn, the optional model
 * and reasoning-effort overrides, and the timeout live here rather than being
 * written twice and drifting.
 *
 * The model and effort are passed only when supplied. Leaving them out lets codex
 * resolve them from the operator's global configuration, which is why callers that
 * care record what they resolved to.
 *
 * INVARIANTS
 * - A session that overruns its budget is signalled, not abandoned. Callers cannot
 *   leave a Codex process running by returning early.
 * - Output is inherited rather than captured, so a long session is observable while
 *   it runs; the final message is read from the file codex writes. The capturing
 *   variant below tees the stream instead of replacing that observability.
 */

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

export type CodexRunStatus = "exited" | "timeout" | "failed";

export function runCodexSession(
    options: CodexRunOptions,
): Promise<CodexRunStatus> {
    const args = buildCodexArgs(options, false);
    const child = spawn("codex", args, {
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
 * resolved model the host reported in its own events. Stream bytes are still
 * teed to this process's stdout, so the session stays observable while it runs.
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
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        process.stdout.write(chunk);
        buffer += chunk.toString("utf8");
        const newline = buffer.lastIndexOf("\n");
        if (newline !== -1) {
            for (const line of buffer.slice(0, newline).split("\n")) {
                scanHostIdentityLine(line, identity);
            }
            buffer = buffer.slice(newline + 1);
        }
    });

    return new Promise((resolve) => {
        let settled = false;
        const finish = (status: CodexRunStatus, exitCode: number | null) => {
            if (settled) return;
            settled = true;
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

function buildCodexArgs(options: CodexRunOptions, json: boolean): string[] {
    const args = [
        "exec",
        "--cd",
        options.workingDirectory,
        "--sandbox",
        options.sandbox,
        "--output-last-message",
        options.outputPath,
    ];
    if (json) args.push("--json");
    if (options.model !== undefined) args.push("--model", options.model);
    if (options.reasoningEffort !== undefined) {
        args.push("-c", `model_reasoning_effort=${options.reasoningEffort}`);
    }
    args.push(options.prompt);
    return args;
}

function scanHostIdentityLine(
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
    if (value === null || typeof value !== "object") return;
    const event = value as Record<string, unknown>;
    const session = asRecord(event.session);
    const thread = asRecord(event.thread);
    identity.sessionId ??=
        asString(event.session_id) ??
        asString(session?.id) ??
        asString(thread?.id) ??
        null;
    identity.resolvedModel ??=
        asString(event.model) ??
        asString(session?.model) ??
        asString(thread?.model) ??
        null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}
