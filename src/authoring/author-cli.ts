import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { runCodexSession } from "./codex-run.js";

import { getTargetProfile } from "../targets/index.js";
import { buildAuthorPrompt } from "./author-prompt.js";
import { parseFlags, requireFlag } from "./flag-args.js";

/**
 * Launch one self-contained authoring session.
 *
 * This script owns nothing about the work. It writes a prompt, runs Codex once,
 * and reports what came back. Every decision — which fixture to reset, how many
 * runs to capture, whether a branch is real, what the artifact should say — is
 * made by the model inside that single execution, following the repository's own
 * authoring skill.
 *
 * Keeping the launcher thin is what makes concurrency possible. Because a
 * session is one self-contained execution rather than a step the launcher
 * sequences, several can run at once, each bound to its own fixture instance and
 * its own lane, and the launcher never has to arbitrate between them.
 *
 * INVARIANTS
 * - The launcher never performs a fixture operation or a browser action. It has
 *   no browser, no socket, and no Docker access of its own.
 * - The prompt is written to the lane directory before the session starts, so what
 *   the model was asked is part of the evidence.
 * - A session that overruns its budget is killed, not left running.
 *
 * SANDBOX
 * Codex runs with full access by default, because the harness genuinely needs it:
 * resetting a fixture invokes Docker, and driving the browser means connecting to
 * a Unix socket. Neither survives a restricted sandbox. The trade-off is that the
 * model has this machine's permissions inside this repository, so review the diff
 * before committing anything. `--codex-sandbox` narrows it when a flow does not
 * need Docker.
 */

const flags = parseFlags(process.argv.slice(2));

if (flags.has("help")) {
    printUsage();
} else {
    await author();
}

/**
 * Build the prompt and run one Codex session.
 *
 * Everything below is deferred out of module scope so that `--help` can be
 * answered without first demanding the flags a real run needs.
 */
async function author(): Promise<void> {
    const goal = requireFlag(flags, "goal");
    const target = requireFlag(flags, "target");
    const fixtureName = requireFlag(flags, "fixture");
    const lane = flags.get("lane") ?? `author-${String(Date.now())}`;
    const maxRuns = Number(flags.get("max-runs") ?? 8);
    const maxActions = Number(flags.get("max-actions") ?? 60);
    const repoRoot = process.cwd();

    const laneDirectory = join(repoRoot, "tmp", "discovery", lane);
    const promptPath = join(laneDirectory, "prompt.md");
    const lastMessagePath = join(laneDirectory, "last-message.md");

    // A lane answers on its own port, so the origin is supplied by the wrapper
    // that provisioned it and falls back to the profile for the default instance.
    const defaultOrigin = getTargetProfile(target).allowedOrigins[0];
    const origin = flags.get("origin") ?? defaultOrigin;
    if (origin === undefined) {
        throw new Error(`Target profile ${target} declares no origin`);
    }

    const prompt = flags.has("preflight")
        ? buildPreflightPrompt(target, fixtureName, lane, origin)
        : buildAuthorPrompt({
              goal,
              target,
              fixtureId: `${target}/${fixtureName}`,
              lane,
              origin,
              maxRuns,
              maxActionsPerRun: maxActions,
          });

    if (flags.has("print-prompt")) {
        print(prompt);
        return;
    }

    try {
        await run({
            prompt,
            goal,
            target,
            fixtureName,
            lane,
            maxRuns,
            maxActions,
            timeoutMs: Number(flags.get("timeout") ?? 3_600_000),
            sandbox: flags.get("codex-sandbox") ?? "danger-full-access",
            repoRoot,
            laneDirectory,
            promptPath,
            lastMessagePath,
        });
    } catch (error) {
        print(`error: ${describeError(error)}`);
        process.exitCode = 1;
    }
}

interface AuthorRunOptions {
    prompt: string;
    goal: string;
    target: string;
    fixtureName: string;
    lane: string;
    maxRuns: number;
    maxActions: number;
    timeoutMs: number;
    sandbox: string;
    repoRoot: string;
    laneDirectory: string;
    promptPath: string;
    lastMessagePath: string;
}

async function run(options: AuthorRunOptions): Promise<void> {
    const {
        prompt,
        goal,
        target,
        fixtureName,
        lane,
        maxRuns,
        maxActions,
        timeoutMs,
        sandbox,
        repoRoot,
        laneDirectory,
        promptPath,
        lastMessagePath,
    } = options;

    if (!Number.isFinite(maxRuns) || !Number.isFinite(maxActions)) {
        throw new Error("--max-runs and --max-actions must be numbers");
    }
    await mkdir(laneDirectory, { recursive: true });
    await writeFile(promptPath, `${prompt}\n`, "utf8");

    print(`lane: ${lane}`);
    print(`target: ${target} (fixture ${target}/${fixtureName})`);
    print(`prompt: ${promptPath}`);
    print(`sandbox: ${sandbox}`);
    print(
        `model: ${flags.get("model") ?? "codex default (global config)"} at ${flags.get("reasoning-effort") ?? "codex default effort"}`,
    );
    print(`timeout: ${String(timeoutMs)}ms`);
    print("");

    // Model and reasoning effort are passed only when asked for. Leaving them out
    // lets codex resolve them from the operator's global configuration, which is why
    // the resolved values are recorded below: the same goal on a machine with a
    // different config would otherwise produce different work with nothing in the
    // evidence saying so.
    const model = flags.get("model");
    const reasoningEffort = flags.get("reasoning-effort");

    await writeFile(
        join(laneDirectory, "session-metadata.json"),
        `${JSON.stringify(
            {
                lane,
                target,
                fixtureId: `${target}/${fixtureName}`,
                goal,
                model: model ?? "codex default (global config)",
                reasoningEffort:
                    reasoningEffort ?? "codex default (global config)",
                sandbox,
                maxRuns,
                maxActions,
                promptPath,
            },
            null,
            2,
        )}\n`,
        "utf8",
    );

    const outcome = await runCodexSession({
        prompt,
        workingDirectory: repoRoot,
        outputPath: lastMessagePath,
        sandbox,
        model,
        reasoningEffort,
        timeoutMs,
    });

    if (outcome === "timeout") {
        print("");
        print(
            `error: the session exceeded ${String(timeoutMs)}ms and was stopped`,
        );
        process.exitCode = 1;
    } else if (outcome === "failed") {
        print("");
        print("error: codex could not be started");
        process.exitCode = 1;
    }

    print("");
    print(`codex status: ${outcome}`);
    print(`final message: ${lastMessagePath}`);
    print("");
    print(await tail(lastMessagePath, 60));

    const report = join(laneDirectory, "report.md");
    if ((await readIfPresent(report)) !== null) {
        print("");
        print(`authoring report: ${report}`);
    }
}

/**
 * Prove the transport before spending a full authoring session on it.
 *
 * The thing most likely to fail is not the model's reasoning but whether Codex's
 * shell can reach the session: sandbox rules, environment filtering, and socket
 * visibility all sit between the two. This asks for exactly that round trip, so a
 * failure is diagnosed in seconds instead of inferred from a long run that never
 * got anywhere.
 */
function buildPreflightPrompt(
    targetId: string,
    fixture: string,
    laneName: string,
    origin: string,
): string {
    return [
        "This is a transport check, not an authoring session. Do not write code,",
        "do not read the authoring skill, and do not attempt any capability work.",
        "",
        "Perform exactly these three shell commands and report their raw output:",
        "",
        `1. \`scripts/session start --lane ${laneName} --target ${targetId} --fixture ${fixture} --origin ${origin} --goal "Transport preflight."\``,
        `2. \`scripts/session observe --lane ${laneName}\``,
        `3. \`scripts/session stop --lane ${laneName}\``,
        "",
        "Then answer in one short paragraph: did all three succeed, and if not,",
        "which one failed and what did it say? If `scripts/session` is missing or the",
        "socket is unreachable, say so plainly — that is the result this check exists",
        "to produce.",
    ].join("\n");
}

async function readIfPresent(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch {
        return null;
    }
}

async function tail(path: string, lines: number): Promise<string> {
    const content = await readIfPresent(path);
    if (content === null) return "(no final message was written)";
    return content.trimEnd().split("\n").slice(-lines).join("\n");
}

function print(line: string): void {
    process.stdout.write(`${line}\n`);
}

function printUsage(): void {
    print(`Usage:
  scripts/author --goal <text> --target <ledgersmb|dolibarr> --fixture <snapshot> [options]

Runs one self-contained authoring session with Codex, which reads
skills/capability-author/SKILL.md and works the whole corpus loop itself.

Options:
  --goal <text>              The capability goal. Required.
  --target <name>            ledgersmb or dolibarr. Required.
  --fixture <snapshot>       Starting fixture snapshot name. Required.
  --lane <name>              Lane name. Defaults to a timestamped value.
  --max-runs <n>             Recorded runs allowed in total. Defaults to 8, which
                             leaves room for the happy path plus a failure matrix.
  --max-actions <n>          Browser actions allowed per run. Defaults to 60.
  --timeout <ms>             Whole-session budget. Defaults to 3600000.
  --origin <url>             Origin this lane answers on. Defaults to the
                             target profile's origin.
  --model <model>            Model for codex exec. Defaults to whatever the
                             operator's global codex config specifies.
  --reasoning-effort <level> low, medium, high, xhigh, ultra, or max. Also
                             defaults to the global codex config.
  --codex-sandbox <mode>     read-only, workspace-write, or danger-full-access.
                             Defaults to danger-full-access, because fixture
                             resets need Docker and the session needs a socket.
  --preflight                Verify the session transport only, in seconds.
  --print-prompt             Print the prompt and exit without running anything.
  --help                     Show this message.
`);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
