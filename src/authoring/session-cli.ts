import { mkdir, open } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import type {
    ActionRisk,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import type { SessionCommand } from "./interactive-playwright-session.js";
import { parseFlags, requireFlag } from "./flag-args.js";
import { requestSessionControl } from "./session-control.js";
import {
    clearSessionState,
    readSessionState,
    resolveSessionStatePath,
    type SessionState,
} from "./session-state.js";

/**
 * The command-line hand a discovery session offers.
 *
 * A session holds one Playwright context, so it cannot be restarted per action.
 * This CLI is how a caller reaches the session that is already running: it turns
 * flags into one `SessionCommand`, sends it over the control socket, and renders
 * the answer as something a person or a language model can read.
 *
 * Flags exist instead of a JSON argument on purpose. A model composing JSON in a
 * shell has to escape selectors, quotes, and newlines by hand, and one mistake
 * costs a turn and can silently misfire an action. Flags move that quoting into
 * argv, where the shell handles it.
 *
 * Output is rendered rather than echoed as JSON for the same reason: the reader
 * wants the page, not the envelope. One helper writes every line, so this file's
 * console footprint stays a single known place.
 *
 * EXIT CODES
 * Zero means the session answered, including when it answered "rejected". A
 * refusal is a legitimate outcome the caller should reason about, not a broken
 * tool. Non-zero means this CLI could not deliver the command at all: no session
 * is running, the flags do not describe a valid command, or the session did not
 * answer.
 */

const args = process.argv.slice(2);
const verb = args[0];
const flags = parseFlags(args.slice(1));

try {
    await run();
} catch (error) {
    print(`error: ${describeError(error)}`);
    process.exitCode = 1;
}

async function run(): Promise<void> {
    switch (verb) {
        case "start":
            await start();
            return;
        case "observe":
            await send({
                type: "observe",
                screenshot: flags.has("screenshot"),
            });
            return;
        case "act":
            await send({
                type: "act",
                action: buildAction(flags),
                risk: readRisk(),
                rationale: requireFlag(flags, "rationale"),
            });
            return;
        case "checkpoint":
            await send({
                type: "checkpoint",
                name: requireFlag(flags, "name"),
                satisfied: flags.get("satisfied") !== "false",
            });
            return;
        case "finish":
            await finish();
            return;
        case "status":
            await status();
            return;
        case "stop":
            await stop();
            return;
        default:
            printUsage();
            process.exitCode = 2;
    }
}

/**
 * Start a detached session for one run and wait until it can be reached.
 *
 * The session process outlives this command, so it is detached and its output is
 * kept in a log beside the state file. A failed start is the case worth reading
 * about, which is why the log tail is printed rather than summarized.
 */
async function start(): Promise<void> {
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

    const child = spawn(process.execPath, [entry, ...sessionArguments(lane)], {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: process.env,
    });
    child.unref();
    await log.close();

    const timeoutMs = Number(flags.get("timeout") ?? 240_000);
    const state = await waitForState(statePath, timeoutMs);
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
function sessionArguments(lane: string): string[] {
    const forwarded = [
        "target",
        "fixture",
        "goal",
        "situation",
        "company",
        "username",
        "origin",
    ];
    const passthrough: string[] = ["--lane", lane];
    for (const name of forwarded) {
        const value = flags.get(name);
        if (value !== undefined) passthrough.push(`--${name}`, value);
    }
    return passthrough;
}

/**
 * Finalize the run and retire the session.
 *
 * The order matters: the run must be closed by the session while it is still
 * alive, so the command is sent and answered first and only then is the process
 * signalled.
 */
async function finish(): Promise<void> {
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

    await send({ type: "finish", outcome });
    if (process.exitCode === 1) return;
    await stop();
}

async function status(): Promise<void> {
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
}

async function stop(): Promise<void> {
    const lane = flags.get("lane");
    const statePath = resolveSessionStatePath(lane);
    const state = await readSessionState(statePath);
    if (state === null) {
        print("no session is running");
        return;
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

/** Send one command to the running session and render its answer. */
async function send(command: SessionCommand): Promise<void> {
    const state = await readState();
    const response = await requestSessionControl(state.socketPath, command);
    if (!response.ok) {
        print(`error: ${response.error}`);
        process.exitCode = 1;
        return;
    }
    render(response.record);
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
        case "action-completed": {
            const result = asRecord(value.result);
            const observation = asRecord(result.observation);
            print("completed");
            print(`url: ${String(observation.url)}`);
            print(`title: ${String(observation.title)}`);
            return;
        }
        case "action-rejected": {
            const decision = asRecord(value.decision);
            print(`rejected: ${rejectionReason(value, decision)}`);
            return;
        }
        case "checkpoint-recorded":
            print(`checkpoint recorded: ${String(value.name)}`);
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
 * Turn target flags into the one action the session's vocabulary accepts.
 *
 * The error text enumerates the accepted forms, because a caller that gets this
 * wrong has no other way to learn the grammar.
 */
function buildAction(options: Map<string, string>): SurfaceAction {
    const type = requireFlag(flags, "type", options);
    if (type === "navigate") {
        return { type: "navigate", url: requireFlag(flags, "url", options) };
    }
    if (type === "press") {
        return { type: "press", key: requireFlag(flags, "key", options) };
    }
    if (type !== "activate" && type !== "fill" && type !== "select") {
        throw new Error(
            `--type must be navigate, activate, fill, select, or press (received ${type})`,
        );
    }

    const target = buildTarget(options);
    if (type === "activate") return { type: "activate", target };
    return { type, target, value: requireFlag(flags, "value", options) };
}

function buildTarget(options: Map<string, string>): TargetDescriptor {
    const candidate = pickCandidate(options);
    return { candidates: [candidate], require: "exactly-one" };
}

function pickCandidate(
    options: Map<string, string>,
): TargetDescriptor["candidates"][number] {
    const role = options.get("role");
    if (role !== undefined) {
        return {
            kind: "role",
            role,
            name: requireFlag(flags, "name", options),
        };
    }
    const label = options.get("label");
    if (label !== undefined) return { kind: "label", text: label };

    const text = options.get("text");
    if (text !== undefined) {
        return { kind: "text", text, exact: options.has("exact") };
    }
    const css = options.get("css");
    if (css !== undefined) return { kind: "css", selector: css };

    throw new Error(
        "A target is required: --role <role> --name <name>, --label <text>, --text <text> [--exact], or --css <selector>",
    );
}

function readRisk(): ActionRisk {
    const risk = flags.get("risk") ?? "safe";
    if (risk !== "safe" && risk !== "reversible" && risk !== "irreversible") {
        throw new Error(
            `--risk must be safe, reversible, or irreversible (received ${risk})`,
        );
    }
    return risk;
}

async function readState(): Promise<SessionState> {
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

function waitForState(
    statePath: string,
    timeoutMs: number,
): Promise<SessionState | null> {
    return waitForValue(() => readSessionState(statePath), timeoutMs);
}

function pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 250));
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/**
 * Explain a refusal, which the session reports in two different shapes.
 *
 * A policy denial carries a decision object with a reason; an origin block
 * carries a bare reason string. Neither is guaranteed, so an unrecognized shape
 * still has to produce a truthful sentence rather than `[object Object]`.
 */
function rejectionReason(
    value: Record<string, unknown>,
    decision: Record<string, unknown>,
): string {
    if (typeof value.reason === "string") return value.reason;
    if (typeof decision.reason === "string") return decision.reason;
    return "the session refused this action";
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

function print(line: string): void {
    process.stdout.write(`${line}\n`);
}

function printUsage(): void {
    print(`Usage:
  scripts/session start --target <ledgersmb|dolibarr> --fixture <name> --goal <text> [--lane <name>]
  scripts/session observe [--screenshot]
  scripts/session act --type <navigate|activate|fill|select|press> [target flags] --rationale <text>
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
