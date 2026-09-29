/**
 * One live discovery session, reachable by anything that can open a socket.
 *
 * This process exists so a caller can be short-lived while the browser context
 * is not. It authenticates the fixture, opens and records the run, and serves
 * commands until a signal ends it. The caller decides *what* to do; this
 * process decides *whether it may* and *how it is recorded*. `session-cli
 * start` spawns it detached and waits for the state file.
 *
 * REJECTED ALTERNATIVES
 * - Exiting after a `finish` command: that would close the control server from
 *   inside the request it is still answering. `session-cli finish` sends the
 *   command, reads the answer, and then signals this process.
 *
 * INVARIANTS
 * - Authentication completes before the run directory exists and before
 *   tracing starts, so a fixture credential reaches neither trace nor ledger.
 * - The state file is published only after the socket is listening, so its
 *   presence means a caller can actually reach this session.
 * - Producer identity comes only from the launcher-sealed record; producer
 *   flags are refused because a controller-supplied identity is forgeable.
 * - The run is finalized exactly once, whether it ends by signal or by a
 *   failure during setup.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import type { Page } from "playwright";

import { dolibarrThirdPartyLookupArtifact } from "../capabilities/dolibarr-third-party-lookup.js";
import { print, runMain } from "../common/cli.js";
import { requireEnv } from "../common/env.js";
import { describeError } from "../common/errors.js";
import { getTargetProfile } from "../targets/index.js";
import { parseFlags, requireFlag } from "./flag-args.js";
import {
    createInteractiveSession,
    type InteractiveSession,
    type SessionOptions,
} from "./interactive-playwright-session.js";
import {
    assertDiscoveryProducer,
    type ProducerRecord,
} from "./run-recorder.js";
import { SessionControlServer } from "./session-control.js";
import {
    clearSessionState,
    resolveSessionStatePath,
    writeSessionState,
    type SessionState,
} from "./session-state.js";

/** Flags that would carry launcher-sealed producer metadata. */
const PRODUCER_FLAG_NAMES = [
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

/** Everything the session needs, validated before the browser comes up. */
interface SessionLaunch {
    flags: Map<string, string>;
    target: string;
    goal: string;
    lane: string;
    statePath: string;
    socketPath: string;
    producer: ProducerRecord;
    profileId: string;
    targetVersion: string;
    fixtureId: string;
    origin: string;
}

async function main(): Promise<void> {
    const launch = await readSessionLaunch(parseFlags(process.argv.slice(2)));
    await serveSession(launch);
}

await runMain(main);

async function readSessionLaunch(
    flags: Map<string, string>,
): Promise<SessionLaunch> {
    const target = requireFlag(flags, "target");
    const fixtureName = requireFlag(flags, "fixture");
    const goal = requireFlag(flags, "goal");
    const lane = flags.get("lane") ?? "default";
    const statePath = resolveSessionStatePath(lane);
    const socketPath =
        process.env.CAPABILITY_SESSION_SOCKET ??
        join(process.cwd(), "tmp", "session", `${lane}.sock`);

    const carriedFlags = PRODUCER_FLAG_NAMES.filter((name) => flags.has(name));
    if (carriedFlags.length > 0) {
        throw new Error(
            `Producer metadata is sealed by the launcher and cannot be set on the command line: ${carriedFlags.join(", ")}`,
        );
    }
    const producer = await readProducerSeal(
        process.env.CAPABILITY_PRODUCER_SEAL,
    );
    assertDiscoveryProducer(producer);

    const profile = getTargetProfile(target);
    const targetVersion =
        flags.get("target-version") ?? profile.supportedVersions[0];
    if (targetVersion === undefined) {
        throw new Error(
            `Target profile ${target} declares no supported version`,
        );
    }
    // A lane runs on its own port, so the origin cannot come from the profile
    // alone. It is still exactly one origin per session, chosen per lane.
    const origin = flags.get("origin") ?? profile.allowedOrigins[0];
    if (origin === undefined) {
        throw new Error(`Target profile ${target} declares no origin`);
    }

    return {
        flags,
        target,
        goal,
        lane,
        statePath,
        socketPath,
        producer,
        profileId: profile.id,
        targetVersion,
        fixtureId: `${target}/${fixtureName}`,
        origin,
    };
}

/**
 * Open the run, serve the control socket, and publish the state file. The
 * process then lives until a signal, when it closes everything once and exits.
 */
async function serveSession(launch: SessionLaunch): Promise<void> {
    const { flags, target, statePath, socketPath, fixtureId, origin } = launch;
    let session: InteractiveSession | undefined;
    let server: SessionControlServer | undefined;
    let state: SessionState | undefined;
    let stopping = false;

    const options: SessionOptions = {
        rootDirectory: join(process.cwd(), "runs"),
        goal: launch.goal,
        situation:
            flags.get("situation") ??
            `Fixture ${fixtureId} reset and authenticated for authoring.`,
        targetProfile: launch.profileId,
        targetVersion: launch.targetVersion,
        fixtureId,
        producer: launch.producer,
        policy: {
            allowedOrigins: [origin],
            allowedActionTypes: [
                "navigate",
                "activate",
                "fill",
                "select",
                "press",
            ],
            riskyActionMode: "block",
        },
        sensitiveInputValues: fixtureSensitiveValues(target),
        ...reviewedResumeConfiguration(target),
        prepare: (page) => bootstrapFixture(page, target, origin, flags),
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

    /** Close the socket and the run once, then exit with the given status. */
    const shutdown = async (code: number): Promise<void> => {
        if (stopping) return;
        stopping = true;

        await server?.close().catch(() => undefined);
        await session?.close().catch(() => undefined);
        await clearSessionState(statePath).catch(() => undefined);
        process.exit(code);
    };

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
            lane: launch.lane,
            socketPath,
            runDirectory: session.runDirectory,
            runId: session.runId,
            pid: process.pid,
            target: launch.profileId,
            targetVersion: launch.targetVersion,
            fixtureId,
            goal: launch.goal,
            controller: "automation",
            controlEpoch: 0,
        };
        await writeSessionState(statePath, state);
    } catch (error) {
        print(`Session failed to start: ${describeError(error)}`);
        await shutdown(1);
    }
}

/**
 * Load the launcher-sealed producer record from the harness-designated path.
 * An unsealed run could not prove who made its decisions, so the refusal
 * happens before the browser comes up. Only the sealed fields are read.
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
    const parsed: unknown = JSON.parse(content);
    // A seal that is not an object fails the field checks below, not a TypeError.
    const seal: Record<string, unknown> =
        parsed !== null && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    const { kind, provider, model, sessionNonce } = seal;
    if (
        (kind !== "external-llm" && kind !== "human") ||
        typeof provider !== "string" ||
        provider === "" ||
        (typeof model !== "string" && model !== null) ||
        typeof sessionNonce !== "string" ||
        sessionNonce === ""
    ) {
        throw new Error(
            `The producer record at ${sealPath} is not a valid launcher seal`,
        );
    }
    return { kind, provider, model, sessionNonce, sealPath };
}

/** The fixture secrets that must never reach durable evidence. */
function fixtureSensitiveValues(target: string): readonly string[] {
    switch (target) {
        case "dolibarr":
            return [requireEnv("DOLIBARR_FIXTURE_PASSWORD")];
        case "ledgersmb":
            return [requireEnv("LEDGERSMB_FIXTURE_PASSWORD")];
        default:
            return [];
    }
}

/** The reviewed artifact whose checkpoints may hand control back to automation. */
function reviewedResumeConfiguration(
    target: string,
): Pick<SessionOptions, "resumeBinding" | "resumeCheckpoints"> {
    if (target !== "dolibarr") return {};
    const checkpoints = dolibarrThirdPartyLookupArtifact.stages;
    return {
        resumeBinding: {
            artifactId: dolibarrThirdPartyLookupArtifact.id,
            checkpoints: checkpoints.map((stage) => ({
                stageId: stage.id,
                detectorIds: stage.detectors.map((detector) => detector.id),
            })),
        },
        resumeCheckpoints: checkpoints,
    };
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
    target: string,
    origin: string,
    flags: Map<string, string>,
): Promise<void> {
    const username = flags.get("username") ?? "admin";

    switch (target) {
        case "dolibarr": {
            const password = requireEnv("DOLIBARR_FIXTURE_PASSWORD");
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
            const password = requireEnv("LEDGERSMB_FIXTURE_PASSWORD");
            await page.goto(`${origin}/login.pl`);
            await page.locator("#username").fill(username);
            await page.locator("#password").fill(password);
            await page
                .locator("#company")
                .fill(flags.get("company") ?? "interface_ai");
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
