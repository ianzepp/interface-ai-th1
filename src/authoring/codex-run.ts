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
 *   it runs; the final message is read from the file codex writes.
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
}

export type CodexRunStatus = "exited" | "timeout" | "failed";

export function runCodexSession(
    options: CodexRunOptions,
): Promise<CodexRunStatus> {
    const args = [
        "exec",
        "--cd",
        options.workingDirectory,
        "--sandbox",
        options.sandbox,
        "--output-last-message",
        options.outputPath,
    ];
    if (options.model !== undefined) args.push("--model", options.model);
    if (options.reasoningEffort !== undefined) {
        args.push("-c", `model_reasoning_effort=${options.reasoningEffort}`);
    }
    args.push(options.prompt);

    const child = spawn("codex", args, {
        stdio: "inherit",
        env: process.env,
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
