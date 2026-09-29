/**
 * The command-line hand a discovery session offers.
 *
 * A session holds one Playwright context, so it cannot be restarted per action.
 * This CLI reaches the session already running: it turns flags into one
 * `SessionCommand`, sends it over the control socket, and renders the answer as
 * the few lines a person or a language model needs, rather than the JSON
 * envelope. Scripts read some of these lines verbatim (`scripts/mock-operator`
 * greps `controller: human` from `status`), so their wording is a contract.
 *
 * REJECTED ALTERNATIVES
 * - A JSON argument instead of flags: a model composing JSON in a shell has to
 *   escape selectors, quotes, and newlines by hand, and one mistake costs a turn
 *   or misfires an action. Flags move that quoting into argv.
 *
 * EXIT CODES
 * - 0: the session answered, including when it answered "rejected". A refusal
 *   is a legitimate outcome the caller should reason about.
 * - 1: the command could not be delivered: no session is running, the flags do
 *   not describe a valid command, or the session did not answer.
 * - 2: unknown verb; usage is printed.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import { print, runMain } from "../common/cli.js";
import { isRecord } from "../common/records.js";
import type {
    ActionRisk,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import { parseFlags, requireFlag, requireNumberFlag } from "./flag-args.js";
import type { SessionCommand } from "./interactive-playwright-session.js";
import { requestSessionControl } from "./session-control.js";
import {
    clearSessionState,
    readSessionState,
    resolveSessionStatePath,
    writeSessionState,
    type SessionState,
} from "./session-state.js";

/** Flags the session process understands, forwarded by `start`. */
const FORWARDED_START_FLAGS = [
    "target",
    "fixture",
    "goal",
    "situation",
    "company",
    "username",
    "origin",
];

type CommandOf<T extends SessionCommand["type"]> = Extract<
    SessionCommand,
    { type: T }
>;

/** A command before the CLI fills in the lease epoch and observation identity. */
type WithoutLease<T> = T extends unknown
    ? Omit<T, "controlEpoch" | "observationIdentity">
    : never;

type LeasedCommand = WithoutLease<
    CommandOf<
        | "act"
        | "take-control"
        | "escalate"
        | "human-observe"
        | "human-act"
        | "resume"
    >
>;

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const verb = args[0];
    const flags = parseFlags(args.slice(1));

    switch (verb) {
        case "start":
            await start(flags);
            return;
        case "observe":
            await send(flags, {
                type: "observe",
                screenshot: flags.has("screenshot"),
            });
            return;
        case "act":
            await sendWithCurrentEpoch(flags, {
                type: "act",
                action: buildAction(flags),
                risk: parseRisk(flags),
                rationale: requireFlag(flags, "rationale"),
            });
            return;
        case "escalate":
            await sendWithCurrentEpoch(flags, {
                type: "escalate",
                reason: requireFlag(flags, "reason"),
            });
            return;
        case "wait-for-control":
            await waitForControl(flags);
            return;
        case "take-control":
            await sendWithCurrentEpoch(flags, { type: "take-control" });
            return;
        case "human-observe":
            await sendWithCurrentEpoch(flags, {
                type: "human-observe",
                screenshot: flags.has("screenshot"),
            });
            return;
        case "human-act":
            await sendWithCurrentEpoch(flags, {
                type: "human-act",
                action: buildAction(flags),
                rationale: requireFlag(flags, "rationale"),
            });
            return;
        case "resume":
            await sendWithCurrentEpoch(flags, { type: "resume" });
            return;
        case "checkpoint":
            await send(flags, {
                type: "checkpoint",
                name: requireFlag(flags, "name"),
                satisfied: flags.get("satisfied") !== "false",
            });
            return;
        case "finish":
            await finish(flags);
            return;
        case "status":
            await status(flags);
            return;
        case "stop":
            await stop(flags);
            return;
        default:
            printUsage();
            process.exitCode = 2;
    }
}

await runMain(main);

/**
 * Start a detached session for one run and wait until it can be reached. The
 * session outlives this command, so its output goes to a log beside the state
 * file, and a failed start prints the log tail rather than a summary.
 */
async function start(flags: Map<string, string>): Promise<void> {
    const lane = flags.get("lane") ?? "default";
    const statePath = resolveSessionStatePath(lane);
    const existing = await readSessionState(statePath);
    if (existing !== null) {
        print(
            `A session is already running for lane ${lane} (run ${existing.runId}).`,
        );
        print(`run directory: ${existing.runDirectory}`);
        process.exitCode = 1;
        return;
    }

    const entry = join(import.meta.dirname, "discovery-session-cli.js");
    const logPath = join(dirname(statePath), `${lane}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const log = await open(logPath, "a");

    const child = spawn(
        process.execPath,
        [entry, ...sessionArguments(flags, lane)],
        {
            detached: true,
            stdio: ["ignore", log.fd, log.fd],
            env: process.env,
        },
    );
    child.unref();
    await log.close();

    const timeoutMs = requireNumberFlag(flags, "timeout", 240_000);
    const state = await waitForValue(
        () => readSessionState(statePath),
        timeoutMs,
    );
    if (state === null) {
        print(
            `error: the session did not become reachable within ${String(timeoutMs)}ms`,
        );
        print(`session log: ${logPath}`);
        print(tail(logPath));
        process.exitCode = 1;
        return;
    }

    print(`session started: run ${state.runId}`);
    print(`run directory: ${state.runDirectory}`);
    print(`fixture: ${state.fixtureId}`);
    print(`socket: ${state.socketPath}`);
}

/** Forward the flags the session process understands, re-adding their dashes. */
function sessionArguments(flags: Map<string, string>, lane: string): string[] {
    const passthrough: string[] = ["--lane", lane];
    for (const name of FORWARDED_START_FLAGS) {
        const value = flags.get(name);
        if (value !== undefined) passthrough.push(`--${name}`, value);
    }
    return passthrough;
}

/** Poll a probe until it reports a value, or return null at the deadline. */
async function waitForValue<T>(
    probe: () => Promise<T | null>,
    timeoutMs: number,
): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await probe();
        if (value !== null) return value;
        await pause();
    }
    return null;
}

/** The last few log lines, which is where a failed start explains itself. */
function tail(path: string, lines = 20): string {
    try {
        const content = readFileSync(path, "utf8").trimEnd().split("\n");
        return content.slice(-lines).join("\n");
    } catch {
        return "(no session log)";
    }
}

/** Send one command to the running session and render its answer. */
async function send(
    flags: Map<string, string>,
    command: SessionCommand,
): Promise<void> {
    await deliver(flags, await requireState(flags), command);
}

/** Send a command bound to the current lease epoch and observation identity. */
async function sendWithCurrentEpoch(
    flags: Map<string, string>,
    command: LeasedCommand,
): Promise<void> {
    const state = await requireState(flags);
    const observationIdentity = state.currentObservationIdentity;
    await deliver(flags, state, {
        ...command,
        controlEpoch: state.controlEpoch,
        ...((command.type === "act" || command.type === "human-act") &&
        observationIdentity !== null &&
        observationIdentity !== undefined
            ? { observationIdentity }
            : {}),
    });
}

async function deliver(
    flags: Map<string, string>,
    state: SessionState,
    command: SessionCommand,
): Promise<void> {
    const response = await requestSessionControl(state.socketPath, command);
    if (!response.ok) {
        print(`error: ${response.error}`);
        process.exitCode = 1;
        return;
    }
    await persistObservationIdentity(flags, state, response.record);
    render(response.record);
}

/** Remember an observation's identity so the next act can bind to it. */
async function persistObservationIdentity(
    flags: Map<string, string>,
    state: SessionState,
    record: unknown,
): Promise<void> {
    const value = asRecord(record);
    if (value.type !== "observation") return;
    const identity = asRecord(value.observationIdentity);
    if (
        typeof identity.sequence !== "number" ||
        typeof identity.hash !== "string"
    ) {
        return;
    }
    await writeSessionState(resolveSessionStatePath(flags.get("lane")), {
        ...state,
        currentObservationIdentity: {
            sequence: identity.sequence,
            hash: identity.hash,
        },
    });
}

/** Render a session record as the small number of facts a reader needs. */
function render(record: unknown): void {
    const value = asRecord(record);
    const type = typeof value.type === "string" ? value.type : "unknown";

    switch (type) {
        case "observation": {
            const observation = asRecord(value.observation);
            print(`url: ${String(observation.url)}`);
            print(`title: ${String(observation.title)}`);
            print(
                `observation identity: ${JSON.stringify(value.observationIdentity)}`,
            );
            if (typeof observation.screenshotPath === "string") {
                print(`screenshot: ${observation.screenshotPath}`);
            }
            const accessibility = asRecord(observation.accessibility);
            if (typeof accessibility.text === "string") {
                print("---");
                print(accessibility.text);
            }
            return;
        }
        case "action-completed":
        case "human-action-completed": {
            const result = asRecord(value.result);
            const observation = asRecord(result.observation);
            print("completed");
            print(`url: ${String(observation.url)}`);
            print(`title: ${String(observation.title)}`);
            return;
        }
        case "action-rejected":
            print(`rejected: ${describeRejection(value)}`);
            return;
        case "checkpoint-recorded":
            print(`checkpoint recorded: ${String(value.name)}`);
            return;
        case "control-taken": {
            const control = asRecord(value.control);
            print(
                `${type}: ${String(control.controller)} epoch ${String(control.epoch)}`,
            );
            return;
        }
        case "intervention-required": {
            const request = asRecord(value.request);
            print(`intervention requested: ${String(request.id)}`);
            print(`reason: ${String(request.reason)}`);
            print(
                "control is now with a human operator; run `scripts/session wait-for-control` and observe again once it returns",
            );
            return;
        }
        case "resume-validated": {
            const decision = asRecord(value.decision);
            const control = asRecord(value.control);
            print(
                `resume validated: stage ${String(decision.stageId)}; automation epoch ${String(control.epoch)}`,
            );
            return;
        }
        case "resume-rejected":
            print(`resume rejected: ${String(value.reason)}`);
            return;
        case "control-rejected":
            print(`rejected: ${String(value.reason)}`);
            return;
        case "finished": {
            const outcome = asRecord(value.outcome);
            const marker =
                outcome.status === "satisfied"
                    ? outcome.checkpoint
                    : outcome.code;
            print(`run finalized: ${String(outcome.status)} ${String(marker)}`);
            print(String(outcome.summary));
            return;
        }
        case "command-error":
            print(`error: ${String(value.error)}`);
            return;
        default:
            print(JSON.stringify(record));
    }
}

/**
 * Explain a refusal. The session names the reason as a string; a record in any
 * other shape still has to produce a truthful sentence, not `[object Object]`.
 */
function describeRejection(value: Record<string, unknown>): string {
    if (typeof value.reason === "string") return value.reason;
    const decision = asRecord(value.decision);
    if (typeof decision.reason === "string") return decision.reason;
    return "the session refused this action";
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

/**
 * Turn target flags into the one action the session's vocabulary accepts. The
 * error text enumerates the accepted forms, because a caller that gets this
 * wrong has no other way to learn the grammar.
 */
function buildAction(flags: Map<string, string>): SurfaceAction {
    const type = requireFlag(flags, "type");
    if (type === "navigate") {
        return { type: "navigate", url: requireFlag(flags, "url") };
    }
    if (type === "press") {
        return { type: "press", key: requireFlag(flags, "key") };
    }
    if (type !== "activate" && type !== "fill" && type !== "select") {
        throw new Error(
            `--type must be navigate, activate, fill, select, or press (received ${type})`,
        );
    }

    const target = buildTarget(flags);
    if (type === "activate") return { type: "activate", target };
    return { type, target, value: requireFlag(flags, "value") };
}

function buildTarget(flags: Map<string, string>): TargetDescriptor {
    return { candidates: [buildCandidate(flags)], require: "exactly-one" };
}

function buildCandidate(
    flags: Map<string, string>,
): TargetDescriptor["candidates"][number] {
    const role = flags.get("role");
    if (role !== undefined) {
        return { kind: "role", role, name: requireFlag(flags, "name") };
    }
    const label = flags.get("label");
    if (label !== undefined) return { kind: "label", text: label };

    const text = flags.get("text");
    if (text !== undefined) {
        return { kind: "text", text, exact: flags.has("exact") };
    }
    const css = flags.get("css");
    if (css !== undefined) return { kind: "css", selector: css };

    throw new Error(
        "A target is required: --role <role> --name <name>, --label <text>, --text <text> [--exact], or --css <selector>",
    );
}

function parseRisk(flags: Map<string, string>): ActionRisk {
    const risk = flags.get("risk") ?? "safe";
    if (risk !== "safe" && risk !== "reversible" && risk !== "irreversible") {
        throw new Error(
            `--risk must be safe, reversible, or irreversible (received ${risk})`,
        );
    }
    return risk;
}

/**
 * Block until automation holds the lease again, or the session is gone. The
 * state file is the one place that knows who holds control. Exit status is 0
 * when control came back, 1 when the session ended or the wait ran out.
 */
async function waitForControl(flags: Map<string, string>): Promise<void> {
    const statePath = resolveSessionStatePath(flags.get("lane"));
    const timeoutMs = requireNumberFlag(flags, "timeout", 600_000);
    const state = await waitForValue(async () => {
        const current = await readSessionState(statePath);
        if (current === null) return { gone: true as const };
        return current.controller === "automation"
            ? { gone: false as const, current }
            : null;
    }, timeoutMs);
    if (state === null) {
        print(
            `error: automation did not regain control within ${String(timeoutMs)}ms`,
        );
        process.exitCode = 1;
        return;
    }
    if (state.gone) {
        print("error: the session ended while waiting for control");
        process.exitCode = 1;
        return;
    }
    print(
        `control returned: automation epoch ${String(state.current.controlEpoch)}`,
    );
    print("observe before the next action");
}

/**
 * Finalize the run and retire the session. The session must close the run
 * while it is still alive, so the command is answered before the process is
 * signalled.
 */
async function finish(flags: Map<string, string>): Promise<void> {
    const status = requireFlag(flags, "status");
    const outcome =
        status === "satisfied"
            ? {
                  status: "satisfied" as const,
                  summary: requireFlag(flags, "summary"),
                  checkpoint: requireFlag(flags, "checkpoint"),
              }
            : {
                  status: "error" as const,
                  summary: requireFlag(flags, "summary"),
                  code: requireFlag(flags, "code"),
              };

    await send(flags, { type: "finish", outcome });
    if (process.exitCode === 1) return;
    await stop(flags);
}

async function status(flags: Map<string, string>): Promise<void> {
    const state = await readSessionState(
        resolveSessionStatePath(flags.get("lane")),
    );
    if (state === null) {
        print("no session is running");
        return;
    }
    print(`session running: run ${state.runId}`);
    print(`run directory: ${state.runDirectory}`);
    print(`fixture: ${state.fixtureId}`);
    print(`target: ${state.target} ${state.targetVersion}`);
    print(`socket: ${state.socketPath}`);
    print(`pid: ${String(state.pid)}`);
    print(`goal: ${state.goal}`);
    print(`controller: ${state.controller}`);
    print(`control epoch: ${String(state.controlEpoch)}`);
}

async function stop(flags: Map<string, string>): Promise<void> {
    const statePath = resolveSessionStatePath(flags.get("lane"));
    const state = await readSessionState(statePath);
    if (state === null) {
        print("no session is running");
        return;
    }

    // Finalize the run *before* signalling the process. A SIGTERM tears the
    // browser down under Playwright's own exit handling, so a session stopping
    // its trace afterwards finalizes as `trace-stop-failed`, which says nothing
    // about what happened. Declaring the abandonment while the browser is alive
    // stops the trace cleanly and records the honest reason instead.
    const response = await requestSessionControl(state.socketPath, {
        type: "finish",
        outcome: {
            status: "error",
            code: "controller-disconnected",
            summary:
                "The controller stopped this run without declaring an outcome.",
        },
    });
    // The session answers a finish on a closed run with a command-error record
    // rather than a transport error, so only a `finished` record means this
    // stop is what finalized the run.
    const answer = response.ok ? asRecord(response.record) : {};
    const refusal = response.ok ? String(answer.error) : response.error;
    if (answer.type === "finished") {
        print("run finalized: controller-disconnected");
    } else if (!refusal.includes("already finalized")) {
        print(`note: the session did not accept the final outcome: ${refusal}`);
    }

    try {
        process.kill(state.pid, "SIGTERM");
    } catch {
        // The session is already gone; clearing the state file is all that is left.
    }
    const stopped = await waitUntilGone(
        () => readSessionState(statePath),
        60_000,
    );
    if (!stopped) {
        print("error: the session did not stop within 60000ms");
        process.exitCode = 1;
        return;
    }
    await clearSessionState(statePath);
    print(`session stopped: run ${state.runId}`);
}

/** Poll a probe until it stops reporting a value; true when it disappeared. */
async function waitUntilGone(
    probe: () => Promise<unknown>,
    timeoutMs: number,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await probe()) === null) return true;
        await pause();
    }
    return false;
}

async function requireState(flags: Map<string, string>): Promise<SessionState> {
    const state = await readSessionState(
        resolveSessionStatePath(flags.get("lane")),
    );
    if (state === null) {
        throw new Error(
            "No session is running. Start one with: scripts/session start --target <target> --fixture <name> --goal <text>",
        );
    }
    return state;
}

function pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 250));
}

function printUsage(): void {
    print(`Usage:
  scripts/session start --target <ledgersmb|dolibarr> --fixture <name> --goal <text> [--lane <name>]
  scripts/session observe [--screenshot]
  scripts/session act --type <navigate|activate|fill|select|press> [target flags] --rationale <text>
  scripts/session escalate --reason <text>
  scripts/session wait-for-control [--timeout <ms>]
  scripts/session take-control
  scripts/session human-observe [--screenshot]
  scripts/session human-act --type <navigate|activate|fill|select|press> [target flags] --rationale <text>
  scripts/session resume
  scripts/session checkpoint --name <name> [--satisfied true|false]
  scripts/session finish --status <satisfied|error> --summary <text> (--checkpoint <name> | --code <code>)
  scripts/session status
  scripts/session stop

Target flags:
  --type navigate                --url <url>
  --type press                   --key <key>
  --type activate|fill|select    --role <role> --name <name>
                                 --label <text>
                                 --text <text> [--exact]
                                 --css <selector>
                                 and --value <value> for fill and select

Other:
  --risk <safe|reversible|irreversible>   Defaults to safe.
  --lane <name>                           Selects a session when several run.
`);
}
