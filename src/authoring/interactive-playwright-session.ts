import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright";

import { ArtifactPolicy, type PolicyConfiguration } from "../runtime/policy.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import type {
    ActionRisk,
    Observation,
    SurfaceAction,
} from "../surfaces/surface-driver.js";
import { PlaywrightTestRunCapture } from "./playwright-run-capture.js";
import type {
    DecisionReceipt,
    EventIdentity,
    ObservationIdentity,
} from "./event-recorder.js";
import {
    FileTestRunRecorder,
    type ProducerRecord,
    type TestRunOutcome,
} from "./run-recorder.js";

export interface SessionOptions {
    rootDirectory: string;
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    /**
     * The launcher-sealed producer of this session's decisions.
     *
     * Sealed by the launcher into the lane directory; a controller cannot supply
     * it, and commands that try are refused at the parser.
     */
    producer?: ProducerRecord | undefined;
    policy: PolicyConfiguration;
    prepare(page: Page): Promise<void>;
}

export type SessionCommand =
    | { type: "observe"; screenshot?: boolean }
    | {
          type: "act";
          action: SurfaceAction;
          risk: ActionRisk;
          rationale: string;
          /** Identity returned by the most recent successful observe. */
          observationIdentity?: ObservationIdentity;
      }
    | { type: "checkpoint"; name: string; satisfied: boolean }
    | { type: "finish"; outcome: TestRunOutcome };

/** One command's answer, and whether the run is now over. */
export interface SessionCommandOutcome {
    record: unknown;
    terminal: boolean;
}

/**
 * A live session as a command handler rather than as a process.
 *
 * The session's decisions — policy gate, origin check, target resolution,
 * recording, finalization — belong to exactly one implementation, and the only
 * thing that legitimately varies is how commands arrive. Separating setup from
 * transport is what lets a stdin loop and a control socket drive the identical
 * code path instead of two implementations that drift apart.
 *
 * INVARIANTS
 * - `handle` never rejects. A failed command comes back as a `command-error`
 *   record, so the transport stays alive and the caller decides what to do next.
 * - Once a command reports `terminal`, the run is finalized and further commands
 *   are refused rather than recorded against a closed run.
 */
export interface InteractiveSession {
    runId: string;
    runDirectory: string;
    /**
     * What the surface looked like once the session was ready.
     *
     * Captured here rather than by each transport because it is part of the
     * protocol a stdio controller already depends on, and a controller that had
     * to ask for it separately would be making a second round trip for something
     * the session already knows.
     */
    initialObservation: Observation;
    initialObservationIdentity: ObservationIdentity;
    handle(command: SessionCommand): Promise<SessionCommandOutcome>;
    /** Stop tracing and the browser, finalizing the run if it is still open. */
    close(): Promise<void>;
}

/** The live state a session's commands operate on, created once and shared. */
interface SessionRun {
    options: SessionOptions;
    page: Page;
    recorder: FileTestRunRecorder;
    capture: PlaywrightTestRunCapture;
    driver: PlaywrightBrowserDriver;
    policy: ArtifactPolicy;
    finalized: boolean;
    /** The last observation issued to the external controller. */
    currentObservationIdentity: ObservationIdentity | null;
    /** Whether the current observation has already authorized an action. */
    observationConsumed: boolean;
}

/**
 * Bring up one browser attempt: authenticate, start recording, and return a
 * handler for the commands an external host will send.
 *
 * Authentication happens before tracing and before the run directory exists, so
 * a fixture credential can reach neither the trace nor the ledger.
 */
export async function createInteractiveSession(
    options: SessionOptions,
): Promise<InteractiveSession> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await options.prepare(page);

        const recorder = await FileTestRunRecorder.start({
            rootDirectory: options.rootDirectory,
            goal: options.goal,
            situation: options.situation,
            targetProfile: options.targetProfile,
            targetVersion: options.targetVersion,
            fixtureId: options.fixtureId,
            producer: options.producer,
        });
        const capture = await PlaywrightTestRunCapture.start(
            context.tracing,
            recorder,
        );
        const driver = new PlaywrightBrowserDriver(
            context,
            page,
            join(recorder.directory, "screenshots"),
        );
        const run: SessionRun = {
            options,
            page,
            recorder,
            capture,
            driver,
            policy: new ArtifactPolicy(options.policy),
            finalized: false,
            currentObservationIdentity: null,
            observationConsumed: false,
        };
        const initialObservation = await driver.observe({
            includeAccessibility: true,
            includeScreenshot: false,
        });
        // The screen the controller first saw is ledger event zero, so the first
        // decision always has an observation to bind to.
        const initialObservationIdentity = await recorder.append({
            type: "observation",
            recordedAt: new Date().toISOString(),
            observation: initialObservation,
        });
        run.currentObservationIdentity = initialObservationIdentity;

        return {
            runId: basename(recorder.directory),
            runDirectory: recorder.directory,
            initialObservation,
            initialObservationIdentity,

            async handle(
                command: SessionCommand,
            ): Promise<SessionCommandOutcome> {
                if (run.finalized) {
                    return {
                        record: {
                            type: "command-error",
                            error: "The run is already finalized",
                        },
                        terminal: true,
                    };
                }
                try {
                    return await handleCommand(run, command);
                } catch (error) {
                    return {
                        record: {
                            type: "command-error",
                            error: describeError(error),
                        },
                        terminal: false,
                    };
                }
            },

            async close(): Promise<void> {
                try {
                    if (!run.finalized) {
                        await run.capture.finish({
                            status: "error",
                            code: "controller-disconnected",
                            summary:
                                "The external discovery controller disconnected before finalizing the run.",
                        });
                        run.finalized = true;
                    }
                } finally {
                    await closeQuietly(context, browser);
                }
            },
        };
    } catch (error) {
        await closeQuietly(context, browser);
        throw error;
    }
}

/** Apply one command, recording it and reporting the state it reached. */
async function handleCommand(
    run: SessionRun,
    command: SessionCommand,
): Promise<SessionCommandOutcome> {
    const { driver, recorder, capture, page, policy, options } = run;

    if (command.type === "observe") {
        const observation = await driver.observe({
            includeAccessibility: true,
            includeScreenshot: command.screenshot ?? false,
        });
        const observationIdentity = await recorder.append({
            type: "observation",
            recordedAt: new Date().toISOString(),
            observation,
        });
        run.currentObservationIdentity = observationIdentity;
        run.observationConsumed = false;
        return {
            record: { type: "observation", observation, observationIdentity },
            terminal: false,
        };
    }

    if (command.type === "checkpoint") {
        await recorder.append({
            ...command,
            recordedAt: new Date().toISOString(),
        });
        return {
            record: { type: "checkpoint-recorded", name: command.name },
            terminal: false,
        };
    }

    if (command.type === "finish") {
        await capture.finish(command.outcome);
        run.finalized = true;
        return {
            record: { type: "finished", outcome: command.outcome },
            terminal: true,
        };
    }

    // A proposed action is receipted against the observation it followed, and
    // recorded before it runs, so a refusal or a thrown locator leaves evidence
    // of the attempt rather than a gap in the ledger.
    const receipt = recorder.buildDecisionReceipt({
        action: command.action,
        risk: command.risk,
        rationale: command.rationale,
    });
    const observationFailure = observeRequirementFailure(
        run,
        command.observationIdentity,
    );
    if (observationFailure !== null) {
        return rejectDecision(
            run,
            command,
            receipt,
            "observe-required",
            observationFailure,
        );
    }
    // Consume the epoch before evaluating policy or doing any asynchronous work.
    // A second action cannot race this one and reuse the same observation.
    run.observationConsumed = true;
    const decision = policy.evaluate(command.action, command.risk);
    await recorder.append({
        type: "proposal",
        recordedAt: new Date().toISOString(),
        action: command.action,
        risk: command.risk,
        rationale: command.rationale,
        policyDecision: decision,
        receipt,
    });
    if (decision.type !== "allow") {
        return rejectDecision(
            run,
            command,
            receipt,
            `policy-${decision.type}`,
            decision.reason,
        );
    }
    const originFailure = blockedOrigin(
        command.action,
        page,
        options.policy.allowedOrigins,
    );
    if (originFailure !== null) {
        return rejectDecision(
            run,
            command,
            receipt,
            "origin-not-allowed",
            originFailure,
        );
    }
    if (command.action.type !== "navigate" && command.action.type !== "press") {
        await driver.locate(command.action.target);
    }
    const result = await driver.act(command.action);
    await recorder.append({
        type: "action",
        recordedAt: new Date().toISOString(),
        action: command.action,
        result,
        rationale: command.rationale,
        receipt,
    });
    return {
        record: { type: "action-completed", result },
        terminal: false,
    };
}

function observeRequirementFailure(
    run: SessionRun,
    supplied: unknown,
): string | null {
    const issued = run.currentObservationIdentity;
    if (issued === null) {
        return "The session has not issued an observation identity yet.";
    }
    if (!isEventIdentity(supplied)) {
        return "Act requires the identity returned by the latest observation.";
    }
    if (run.observationConsumed) {
        return "The observation identity was already consumed; observe again before acting.";
    }
    if (!sameEventIdentity(supplied, issued)) {
        return "Act requires the identity returned by the latest observation.";
    }
    return null;
}

function isEventIdentity(value: unknown): value is EventIdentity {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.sequence === "number" && typeof record.hash === "string"
    );
}

function sameEventIdentity(left: EventIdentity, right: EventIdentity): boolean {
    return left.sequence === right.sequence && left.hash === right.hash;
}

/** Record an explicit rejected decision and report the refusal. */
async function rejectDecision(
    run: SessionRun,
    command: Extract<SessionCommand, { type: "act" }>,
    receipt: DecisionReceipt,
    reason: string,
    detail: string,
): Promise<SessionCommandOutcome> {
    await run.recorder.append({
        type: "decision-rejected",
        recordedAt: new Date().toISOString(),
        action: command.action,
        risk: command.risk,
        rationale: command.rationale,
        reason,
        receipt,
    });
    return {
        record: { type: "action-rejected", reason, detail },
        terminal: false,
    };
}

/**
 * Run one browser attempt while an external LLM supplies each next action.
 *
 * The host process writes one JSON command per line and receives one JSON
 * observation in response. This keeps discovery decisions outside the repo
 * while preserving a single Playwright context, trace, policy gate, and event
 * ledger for the complete attempt.
 */
export async function runInteractivePlaywrightSession(
    options: SessionOptions,
): Promise<void> {
    const session = await createInteractiveSession(options);

    try {
        emit({
            type: "ready",
            runId: session.runId,
            runDirectory: session.runDirectory,
            observation: session.initialObservation,
            observationIdentity: session.initialObservationIdentity,
        });

        const lines = createInterface({
            input: process.stdin,
            crlfDelay: Infinity,
        });
        for await (const line of lines) {
            if (line.trim() === "") continue;
            let command: SessionCommand;
            try {
                command = parseSessionCommand(line);
            } catch (error) {
                emit({ type: "command-error", error: describeError(error) });
                continue;
            }
            const outcome = await session.handle(command);
            emit(outcome.record);
            if (outcome.terminal) {
                lines.close();
                break;
            }
        }
    } finally {
        await session.close();
    }
}

/**
 * Producer provenance is sealed by the launcher, so commands carrying these
 * fields are refused before they can touch the ledger or the manifest.
 */
const FORBIDDEN_COMMAND_FIELDS = [
    "producer",
    "model",
    "receipt",
    "nonce",
    "sessionNonce",
    "sequence",
    "receiptHash",
    "commandHash",
    "priorObservationHash",
    "priorObservationSequence",
] as const;

export function parseSessionCommand(source: string): SessionCommand {
    const value = JSON.parse(source) as unknown;
    if (value === null || typeof value !== "object") {
        throw new Error("Session command must be a JSON object");
    }
    const command = value as Record<string, unknown>;
    const carried = FORBIDDEN_COMMAND_FIELDS.filter(
        (field) => field in command,
    );
    if (carried.length > 0) {
        throw new Error(
            `Producer metadata is sealed by the launcher and cannot be sent by a controller: ${carried.join(", ")}`,
        );
    }
    if (
        command.type !== "observe" &&
        command.type !== "act" &&
        command.type !== "checkpoint" &&
        command.type !== "finish"
    ) {
        throw new Error("Unknown session command type");
    }
    return value as SessionCommand;
}

function blockedOrigin(
    action: SurfaceAction,
    page: Page,
    allowedOrigins: readonly string[],
): string | null {
    const candidate = action.type === "navigate" ? action.url : page.url();
    let origin: string;
    try {
        origin = new URL(candidate).origin;
    } catch {
        return `Invalid action URL: ${candidate}`;
    }
    return allowedOrigins.includes(origin)
        ? null
        : `Origin ${origin} is not allowlisted`;
}

function emit(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function closeQuietly(
    context: BrowserContext,
    browser: Browser,
): Promise<void> {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
}
