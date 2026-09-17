import { join } from "node:path";
import { readFile } from "node:fs/promises";
import process from "node:process";

import type { Page } from "playwright";

import { getTargetProfile } from "../targets/index.js";
import {
    createInteractiveSession,
    type InteractiveSession,
    type SessionOptions,
} from "./interactive-playwright-session.js";
import type { ProducerRecord } from "./run-recorder.js";
import { parseFlags, requireFlag } from "./flag-args.js";
import { SessionControlServer } from "./session-control.js";
import {
    clearSessionState,
    resolveSessionStatePath,
    writeSessionState,
    type SessionState,
} from "./session-state.js";

/**
 * One live discovery session, reachable by anything that can open a socket.
 *
 * This process exists so that a caller can be short-lived while the browser
 * context is not. It authenticates the fixture, opens the run, records it, and
 * serves commands until a signal ends the run. Everything that decides *what* to
 * do lives in the caller; everything that decides *whether it may* and *how it is
 * recorded* lives here.
 *
 * Lifecycle is deliberately not self-managed. This process does not decide to
 * exit after a `finish` command, because doing so would mean closing the control
 * server from inside the request it is still answering. `scripts/session finish`
 * therefore sends the command, reads the answer, and then signals this process,
 * which keeps the shutdown a caller-side decision on a clean turn.
 *
 * It is meant to be started by `scripts/session start`, which detaches it and
 * waits for the state file, so nothing manages this process directly.
 *
 * INVARIANTS
 * - Authentication completes before the run directory exists and before tracing
 *   starts, so a fixture credential reaches neither the trace nor the ledger.
 * - The state file is published only after the socket is listening, so its
 *   presence means a caller can actually reach this session.
 * - The run is finalized exactly once, whether it ends by signal or by a handler
 *   that throws during setup.
 */

const flags = parseFlags(process.argv.slice(2));

const target = requireFlag(flags, "target");
const fixtureName = requireFlag(flags, "fixture");
const goal = requireFlag(flags, "goal");
const lane = flags.get("lane") ?? "default";
const statePath = resolveSessionStatePath(lane);
const socketPath =
    process.env.CAPABILITY_SESSION_SOCKET ??
    join(process.cwd(), "tmp", "session", `${lane}.sock`);

// Producer identity has exactly one source: the record the launcher sealed into
// the lane directory. Flags and stdin are refuse, not read, because a
// controller-supplied identity is forgeable.
const producerFlagNames = [
    "producer",
    "model",
    "receipt",
    "nonce",
    "session-nonce",
    "sequence",
    "receipt-hash",
    "command-hash",
    "prior-observation-hash",
    "prior-observation-sequence",
];
const carriedFlags = producerFlagNames.filter((name) => flags.has(name));
if (carriedFlags.length > 0) {
    throw new Error(
        `Producer metadata is sealed by the launcher and cannot be set on the command line: ${carriedFlags.join(", ")}`,
    );
}
const producer = await readProducerSeal(process.env.CAPABILITY_PRODUCER_SEAL);

const profile = getTargetProfile(target);
const targetVersion =
    flags.get("target-version") ?? profile.supportedVersions[0];
if (targetVersion === undefined) {
    throw new Error(`Target profile ${target} declares no supported version`);
}
const fixtureId = `${target}/${fixtureName}`;
// A lane runs on its own port, so the origin cannot come from the profile alone.
// It is still exactly one origin per session; it is just chosen rather than fixed.
const origin = flags.get("origin") ?? profile.allowedOrigins[0];
if (origin === undefined) {
    throw new Error(`Target profile ${target} declares no origin`);
}

const options: SessionOptions = {
    rootDirectory: join(process.cwd(), "runs"),
    goal,
    situation:
        flags.get("situation") ??
        `Fixture ${fixtureId} reset and authenticated for authoring.`,
    targetProfile: profile.id,
    targetVersion,
    fixtureId,
    producer,
    policy: {
        allowedOrigins: [origin],
        allowedActionTypes: ["navigate", "activate", "fill", "select", "press"],
        riskyActionMode: "block",
    },
    sensitiveInputValues: fixtureSensitiveValues(target),
    prepare: (page) => bootstrapFixture(page, origin, flags),
    sessionSocketPath: socketPath,
    async onControlChange(lease) {
        if (state === undefined) {
            throw new Error(
                "Session state was not published before control changed",
            );
        }
        state = {
            ...state,
            controller: lease.controller,
            controlEpoch: lease.epoch,
        };
        await writeSessionState(statePath, state);
    },
};

let session: InteractiveSession | undefined;
let server: SessionControlServer | undefined;
let stopping = false;
let state: SessionState | undefined;

process.on("SIGTERM", () => {
    shutdown(0).catch(() => undefined);
});
process.on("SIGINT", () => {
    shutdown(0).catch(() => undefined);
});

try {
    session = await createInteractiveSession(options);
    const active = session;

    server = new SessionControlServer({
        socketPath,
        dispatch: async (command) => (await active.handle(command)).record,
    });
    await server.listen();

    state = {
        lane,
        socketPath,
        runDirectory: session.runDirectory,
        runId: session.runId,
        pid: process.pid,
        target: profile.id,
        targetVersion,
        fixtureId,
        goal,
        controller: "automation",
        controlEpoch: 0,
    };
    await writeSessionState(statePath, state);
} catch (error) {
    process.stderr.write(`Session failed to start: ${describeError(error)}\n`);
    await shutdown(1);
}

/** Close the socket and the run once, then exit with the given status. */
async function shutdown(code: number): Promise<void> {
    if (stopping) return;
    stopping = true;

    await server?.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    await clearSessionState(statePath).catch(() => undefined);
    process.exit(code);
}

/**
 * Authenticate the fixture before the run is opened.
 *
 * This is fixture bootstrap, not capability knowledge: it proves the session is
 * usable and is deliberately not recorded. Anything a capability claims about
 * logging in belongs to that capability's artifact, recorded as its own stages.
 */
async function bootstrapFixture(
    page: Page,
    origin: string,
    sessionFlags: Map<string, string>,
): Promise<void> {
    const username = sessionFlags.get("username") ?? "admin";

    switch (target) {
        case "dolibarr": {
            const password = requireEnvironment("DOLIBARR_FIXTURE_PASSWORD");
            await page.goto(origin);
            if (!page.url().includes("/index.php?mainmenu=home")) {
                await page.locator('input[name="username"]').fill(username);
                await page.locator('input[name="password"]').fill(password);
                await page
                    .locator('input[type="submit"], button[type="submit"]')
                    .first()
                    .click();
            }
            await page
                .getByRole("link", { name: "Third parties", exact: true })
                .waitFor();
            return;
        }
        case "ledgersmb": {
            const password = requireEnvironment("LEDGERSMB_FIXTURE_PASSWORD");
            await page.goto(`${origin}/login.pl`);
            await page.locator("#username").fill(username);
            await page.locator("#password").fill(password);
            await page
                .locator("#company")
                .fill(sessionFlags.get("company") ?? "interface_ai");
            await page
                .getByRole("button", { name: "Login", exact: true })
                .click();
            await page
                .getByText("Welcome to LedgerSMB", { exact: true })
                .waitFor();
            const expiry = page.getByRole("button", { name: "OK" });
            if (await expiry.isVisible()) await expiry.click();
            return;
        }
        default:
            throw new Error(
                `No fixture bootstrap is defined for target ${target}`,
            );
    }
}

function fixtureSensitiveValues(targetName: string): readonly string[] {
    switch (targetName) {
        case "dolibarr":
            return [requireEnvironment("DOLIBARR_FIXTURE_PASSWORD")];
        case "ledgersmb":
            return [requireEnvironment("LEDGERSMB_FIXTURE_PASSWORD")];
        default:
            return [];
    }
}

function requireEnvironment(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === "") {
        throw new Error(`${name} is required to authenticate the fixture`);
    }
    return value;
}

/**
 * Load the launcher-sealed producer record from the harness-designated path.
 *
 * A discovery session does not start without one: an unsealed run could not
 * prove who made its decisions, so the refusal happens before the browser comes
 * up. Only fields the launcher sealed are read; anything else in the file is
 * ignored rather than trusted.
 */
async function readProducerSeal(
    sealPath: string | undefined,
): Promise<ProducerRecord> {
    if (sealPath === undefined || sealPath === "") {
        throw new Error(
            "CAPABILITY_PRODUCER_SEAL is required: a discovery session only starts from a launcher-sealed producer record",
        );
    }
    let content: string;
    try {
        content = await readFile(sealPath, "utf8");
    } catch {
        throw new Error(
            `The launcher-sealed producer record is unreadable: ${sealPath}`,
        );
    }
    const value = JSON.parse(content) as Record<string, unknown>;
    const kind = value.kind;
    const provider = value.provider;
    const model = value.model;
    const sessionNonce = value.sessionNonce;
    if (
        (kind !== "external-llm" && kind !== "human") ||
        typeof provider !== "string" ||
        provider === "" ||
        typeof model !== "string" ||
        model === "" ||
        typeof sessionNonce !== "string" ||
        sessionNonce === ""
    ) {
        throw new Error(
            `The producer record at ${sealPath} is not a valid launcher seal`,
        );
    }
    return { kind, provider, model, sessionNonce, sealPath };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
