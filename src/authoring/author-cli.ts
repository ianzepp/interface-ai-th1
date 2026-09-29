/**
 * Launch one self-contained Codex authoring session: `scripts/author`.
 *
 * The launcher writes a prompt, runs Codex once, and reports what came back.
 * Every authoring decision — which fixture to reset, how many runs to capture,
 * whether a branch is real, what the artifact says — is made by the model inside
 * that one execution, following the repository's authoring skill. Because a
 * session sequences itself, several can run at once, each on its own fixture
 * instance and lane, with nothing for the launcher to arbitrate.
 *
 * INVARIANTS
 * - The launcher never performs a fixture operation or a browser action.
 * - The prompt is written to the lane directory before the session starts, so
 *   what the model was asked is part of the evidence.
 * - The producer seal exists before the host starts; the attestation written
 *   afterwards binds its nonce to the captured stream digest and exit status.
 * - A session that overruns its budget is killed, not left running.
 *
 * SANDBOX
 * - Codex runs with `danger-full-access` by default: fixture resets invoke
 *   Docker and the session CLI connects over a Unix socket, and neither
 *   survives a restricted sandbox.
 * - The model therefore has this machine's permissions inside the repository,
 *   so review the diff before committing anything. `--codex-sandbox` narrows it
 *   when a flow does not need Docker.
 *
 * EXIT CODES
 * - 1 when setup fails, the session times out, or codex cannot be started.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { print, runMain } from "../common/cli.js";
import { getTargetProfile } from "../targets/index.js";
import { buildAuthorPrompt, buildDiscoveryRunPrompt } from "./author-prompt.js";
import {
    runCodexSessionWithCapture,
    type CodexRunStatus,
} from "./codex-run.js";
import { parseFlags, requireFlag, requireNumberFlag } from "./flag-args.js";
import {
    attestDiscoveryRuns,
    type HostProducerAttestation,
} from "./run-recorder.js";

/** What the launcher records when codex resolves a setting itself. */
const CODEX_DEFAULT = "codex default (global config)";

interface AuthorSessionOptions {
    prompt: string;
    goal: string;
    target: string;
    fixtureId: string;
    lane: string;
    maxRuns: number;
    maxActions: number;
    timeoutMs: number;
    sandbox: string;
    model: string | undefined;
    reasoningEffort: string | undefined;
    repoRoot: string;
    laneDirectory: string;
}

await runMain(main);

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.has("help")) {
        printUsage();
        return;
    }

    const goal = requireFlag(flags, "goal");
    const target = requireFlag(flags, "target");
    const fixtureName = requireFlag(flags, "fixture");
    const lane = flags.get("lane") ?? `author-${String(Date.now())}`;
    const maxRuns = requireNumberFlag(flags, "max-runs", 12);
    const maxActions = requireNumberFlag(flags, "max-actions", 60);
    const timeoutMs = requireNumberFlag(flags, "timeout", 3_600_000);
    const fixtureId = `${target}/${fixtureName}`;
    const repoRoot = process.cwd();

    // A lane answers on its own port, so the origin is supplied by the wrapper
    // that provisioned it and falls back to the profile for the default instance.
    const defaultOrigin = getTargetProfile(target).allowedOrigins[0];
    const origin = flags.get("origin") ?? defaultOrigin;
    if (origin === undefined) {
        throw new Error(`Target profile ${target} declares no origin`);
    }

    const promptOptions = {
        goal,
        target,
        fixtureId,
        lane,
        origin,
        maxRuns,
        maxActionsPerRun: maxActions,
    };
    const prompt = flags.has("preflight")
        ? buildPreflightPrompt(target, fixtureName, lane, origin)
        : flags.has("single-run")
          ? buildDiscoveryRunPrompt(promptOptions)
          : buildAuthorPrompt(promptOptions);

    if (flags.has("print-prompt")) {
        print(prompt);
        return;
    }

    await runAuthorSession({
        prompt,
        goal,
        target,
        fixtureId,
        lane,
        maxRuns,
        maxActions,
        timeoutMs,
        sandbox: flags.get("codex-sandbox") ?? "danger-full-access",
        // Passed only when asked for; codex otherwise resolves them from the
        // operator's global configuration. These are requests: what the host
        // actually resolved is sealed into producer-attestation.json.
        model: flags.get("model"),
        reasoningEffort: flags.get("reasoning-effort"),
        repoRoot,
        laneDirectory: join(repoRoot, "tmp", "discovery", lane),
    });
}

/**
 * Prove the transport before spending a full authoring session on it.
 *
 * The likeliest failure is not the model's reasoning but whether Codex's shell
 * can reach the session: sandbox rules, environment filtering, and socket
 * visibility all sit between the two. This asks for exactly that round trip,
 * so a failure is diagnosed in seconds.
 */
function buildPreflightPrompt(
    target: string,
    fixtureName: string,
    lane: string,
    origin: string,
): string {
    return [
        "This is a transport check, not an authoring session. Do not write code,",
        "do not read the authoring skill, and do not attempt any capability work.",
        "",
        "Perform exactly these three shell commands and report their raw output:",
        "",
        `1. \`scripts/session start --lane ${lane} --target ${target} --fixture ${fixtureName} --origin ${origin} --goal "Transport preflight."\``,
        `2. \`scripts/session observe --lane ${lane}\``,
        `3. \`scripts/session stop --lane ${lane}\``,
        "",
        "Then answer in one short paragraph: did all three succeed, and if not,",
        "which one failed and what did it say? If `scripts/session` is missing or the",
        "socket is unreachable, say so plainly — that is the result this check exists",
        "to produce.",
    ].join("\n");
}

/** Seal, run, and attest one Codex session, then report how it ended. */
async function runAuthorSession(options: AuthorSessionOptions): Promise<void> {
    const { lane, laneDirectory, model } = options;
    const promptPath = join(laneDirectory, "prompt.md");
    const lastMessagePath = join(laneDirectory, "last-message.md");

    await mkdir(laneDirectory, { recursive: true });
    await writeFile(promptPath, `${options.prompt}\n`, "utf8");

    print(`lane: ${lane}`);
    print(`target: ${options.target} (fixture ${options.fixtureId})`);
    print(`prompt: ${promptPath}`);
    print(`sandbox: ${options.sandbox}`);
    print(
        `model: ${model ?? CODEX_DEFAULT} at ${options.reasoningEffort ?? "codex default effort"}`,
    );
    print(`timeout: ${String(options.timeoutMs)}ms`);
    print("");

    await writeJson(join(laneDirectory, "session-metadata.json"), {
        lane,
        target: options.target,
        fixtureId: options.fixtureId,
        goal: options.goal,
        model: model ?? CODEX_DEFAULT,
        reasoningEffort: options.reasoningEffort ?? CODEX_DEFAULT,
        sandbox: options.sandbox,
        maxRuns: options.maxRuns,
        maxActions: options.maxActions,
        promptPath,
    });

    // Every session the model opens reads this launcher-written seal and
    // nothing else, so it must exist before the host starts.
    const sessionNonce = randomUUID();
    const producerSealPath = join(laneDirectory, "producer-seal.json");
    await writeJson(producerSealPath, {
        kind: "external-llm",
        provider: "codex",
        // The requested model; the resolved one is sealed in the attestation.
        model: model ?? null,
        sessionNonce,
        lane,
        sealedAt: new Date().toISOString(),
    });
    print(`producer seal: ${producerSealPath}`);

    const result = await runCodexSessionWithCapture({
        prompt: options.prompt,
        workingDirectory: options.repoRoot,
        outputPath: lastMessagePath,
        sandbox: options.sandbox,
        model,
        reasoningEffort: options.reasoningEffort,
        timeoutMs: options.timeoutMs,
        extraEnv: { CAPABILITY_PRODUCER_SEAL: producerSealPath },
    });

    const attestation: HostProducerAttestation = {
        sessionNonce,
        sessionId: result.capture.identity.sessionId,
        resolvedModel: result.capture.identity.resolvedModel,
        streamDigest: result.capture.streamDigest,
        exitStatus: result.status,
        exitCode: result.exitCode,
    };
    const attestationPath = join(laneDirectory, "producer-attestation.json");
    await writeJson(attestationPath, {
        ...attestation,
        attestedAt: new Date().toISOString(),
    });
    print(`producer attestation: ${attestationPath}`);
    const attestedRuns = await attestDiscoveryRuns(
        join(options.repoRoot, "runs"),
        attestation,
    );
    print(`attested runs: ${attestedRuns.join(", ") || "none"}`);

    printSessionFailure(result.status, options.timeoutMs);
    print("");
    print(`codex status: ${result.status}`);
    print(`final message: ${lastMessagePath}`);
    print("");
    print(await readTail(lastMessagePath, 60));

    const reportPath = join(laneDirectory, "report.md");
    if ((await readIfPresent(reportPath)) !== null) {
        print("");
        print(`authoring report: ${reportPath}`);
    }
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Report a session that did not exit on its own, and fail the process. */
function printSessionFailure(status: CodexRunStatus, timeoutMs: number): void {
    if (status === "exited") return;
    print("");
    print(
        status === "timeout"
            ? `error: the session exceeded ${String(timeoutMs)}ms and was stopped`
            : "error: codex could not be started",
    );
    process.exitCode = 1;
}

/** The last `lines` lines of a file, or a placeholder when it is absent. */
async function readTail(path: string, lines: number): Promise<string> {
    const content = await readIfPresent(path);
    if (content === null) return "(no final message was written)";
    return content.trimEnd().split("\n").slice(-lines).join("\n");
}

async function readIfPresent(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch {
        return null;
    }
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
  --max-runs <n>             Recorded runs allowed in total. Defaults to 12, which
                             leaves room for the happy path, a failure matrix, and the
                             two validation runs the method reserves.
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
  --single-run               Capture one recorded discovery run toward the goal,
                             escalating to a human when stuck, instead of
                             authoring a whole capability.
  --preflight                Verify the session transport only, in seconds.
  --print-prompt             Print the prompt and exit without running anything.
  --help                     Show this message.
`);
}
