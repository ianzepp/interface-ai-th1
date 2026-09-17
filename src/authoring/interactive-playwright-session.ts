import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright";

import { ArtifactPolicy, type PolicyConfiguration } from "../runtime/policy.js";
import type { CapabilityStage } from "../runtime/state-machine.js";
import { ControlLease } from "../intervention/control-lease.js";
import {
    evaluateResume,
    type ResumeCheckpoint,
} from "../intervention/resume.js";
import { createInterventionRequest } from "../intervention/request.js";
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
    /** Exact launcher-declared values excluded from durable evidence. */
    sensitiveInputValues?: readonly string[];
    policy: PolicyConfiguration;
    prepare(page: Page): Promise<void>;
    sessionSocketPath?: string;
    /** Reviewed artifact stages whose detectors may re-admit automation. */
    resumeCheckpoints?: readonly CapabilityStage[];
    /** Maximum time to wait for an admitted checkpoint after human resume. */
    resumeValidationTimeoutMs?: number;
    onControlChange?(state: {
        controller: "automation" | "human";
        epoch: number;
    }): Promise<void>;
}

export type SessionCommand =
    | { type: "observe"; screenshot?: boolean }
    | { type: "take-control"; controlEpoch: number }
    | { type: "human-observe"; controlEpoch: number; screenshot?: boolean }
    | {
          type: "human-act";
          action: SurfaceAction;
          rationale: string;
          observationIdentity?: ObservationIdentity;
          controlEpoch: number;
      }
    | { type: "resume"; controlEpoch: number }
    | { type: "release-control"; controlEpoch: number }
    | {
          type: "act";
          action: SurfaceAction;
          risk: ActionRisk;
          rationale: string;
          /** Identity returned by the most recent successful observe. */
          observationIdentity?: ObservationIdentity;
          controlEpoch?: number;
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
    lease: ControlLease;
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
            sensitiveInputValues: options.sensitiveInputValues,
        });
        const capture = await PlaywrightTestRunCapture.start(
            context.tracing,
            recorder,
            options.sensitiveInputValues,
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
            lease: new ControlLease(),
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

    if (command.type === "take-control") {
        return transferControl(
            run,
            "automation",
            command.controlEpoch,
            "human",
            "control-taken",
        );
    }

    if (command.type === "release-control") {
        return transferControl(
            run,
            "human",
            command.controlEpoch,
            "automation",
            "control-released",
        );
    }

    if (command.type === "resume") {
        const failure = humanControlFailure(run, command.controlEpoch);
        if (failure !== null) {
            return {
                record: { type: "control-rejected", reason: failure },
                terminal: false,
            };
        }
        return validateResume(run, command.controlEpoch);
    }

    if (command.type === "observe" || command.type === "human-observe") {
        const failure =
            command.type === "human-observe"
                ? humanControlFailure(run, command.controlEpoch)
                : null;
        if (failure !== null) {
            return {
                record: { type: "control-rejected", reason: failure },
                terminal: false,
            };
        }
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

    if (command.type === "human-act") {
        const controlFailure = humanControlFailure(run, command.controlEpoch);
        if (controlFailure !== null) {
            return {
                record: {
                    type: "action-rejected",
                    reason: "control-lease-refused",
                    detail: controlFailure,
                },
                terminal: false,
            };
        }
        const observationFailure = observeRequirementFailure(
            run,
            command.observationIdentity,
        );
        if (observationFailure !== null) {
            return {
                record: {
                    type: "action-rejected",
                    reason: "observe-required",
                    detail: observationFailure,
                },
                terminal: false,
            };
        }
        run.observationConsumed = true;
        const originFailure = blockedOrigin(
            command.action,
            page,
            options.policy.allowedOrigins,
        );
        if (originFailure !== null) {
            return {
                record: {
                    type: "action-rejected",
                    reason: "origin-not-allowed",
                    detail: originFailure,
                },
                terminal: false,
            };
        }
        if (
            command.action.type !== "navigate" &&
            command.action.type !== "press"
        ) {
            await driver.locate(command.action.target);
        }
        const result = await capture.execute(command.action, () =>
            driver.act(command.action),
        );
        await recorder.append({
            type: "action",
            recordedAt: new Date().toISOString(),
            action: command.action,
            result,
            rationale: command.rationale,
        });
        return {
            record: { type: "human-action-completed", result },
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
    const controlFailure = automationControlFailure(run, command.controlEpoch);
    if (controlFailure !== null) {
        return rejectDecision(
            run,
            command,
            receipt,
            "control-lease-refused",
            controlFailure,
        );
    }
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
    if (decision.type === "require-confirmation") {
        return requireIntervention(run, command, receipt, decision.reason);
    }
    if (decision.type === "block") {
        return rejectDecision(
            run,
            command,
            receipt,
            "policy-block",
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
    const result = await capture.execute(command.action, () =>
        driver.act(command.action),
    );
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

async function requireIntervention(
    run: SessionRun,
    command: Extract<SessionCommand, { type: "act" }>,
    receipt: DecisionReceipt,
    reason: string,
): Promise<SessionCommandOutcome> {
    const evidence = await run.driver.captureEvidence("intervention");
    const before = run.lease.current();
    const request = createInterventionRequest({
        id: `intervention:${run.recorder.directory}:${String(before.epoch)}`,
        capabilityId: run.options.targetProfile,
        goal: run.options.goal,
        stageId: `action:${command.action.type}`,
        reason,
        controlEpoch: before.epoch,
        session: {
            runId: basename(run.recorder.directory),
            runDirectory: run.recorder.directory,
            ...(run.options.sessionSocketPath === undefined
                ? {}
                : { socketPath: run.options.sessionSocketPath }),
        },
        evidence: [evidence],
    });
    await run.recorder.append({
        type: "intervention-request",
        recordedAt: new Date().toISOString(),
        request,
    });
    const after = run.lease.transfer("automation", before.epoch, "human");
    await run.options.onControlChange?.(after);
    await run.recorder.append({
        type: "control-transfer",
        recordedAt: new Date().toISOString(),
        from: before,
        to: after,
        requestId: request.id,
    });
    return {
        record: { type: "intervention-required", request, receipt },
        terminal: false,
    };
}

async function validateResume(
    run: SessionRun,
    epoch: number,
): Promise<SessionCommandOutcome> {
    const checkpoints = run.options.resumeCheckpoints ?? [];
    for (const stage of checkpoints) {
        const match = await run.driver.waitFor(
            stage.detectors,
            run.options.resumeValidationTimeoutMs ?? 1_000,
        );
        if (match === null) continue;
        const observation = await run.driver.observe({
            includeAccessibility: true,
            includeScreenshot: true,
        });
        const decision = await evaluateResume({
            stage,
            observation,
            detectorId: match.detectorId,
        } satisfies ResumeCheckpoint);
        if (decision.type === "reject") continue;

        await run.recorder.append({
            type: "resume-validated",
            recordedAt: new Date().toISOString(),
            observation,
            decision,
        });
        if (decision.type === "complete") {
            const outcome = {
                status: "satisfied" as const,
                checkpoint: decision.checkpoint,
                summary: `Human recovery reached approved checkpoint ${decision.checkpoint}.`,
            };
            await run.capture.finish(outcome);
            run.finalized = true;
            return { record: { type: "completed", outcome }, terminal: true };
        }

        const before = run.lease.current();
        const after = run.lease.transfer("human", epoch, "automation");
        await run.options.onControlChange?.(after);
        await run.recorder.append({
            type: "control-transfer",
            recordedAt: new Date().toISOString(),
            from: before,
            to: after,
        });
        return {
            record: { type: "resume-validated", decision, control: after },
            terminal: false,
        };
    }

    const reason =
        checkpoints.length === 0
            ? "No reviewed resume checkpoints are configured for this session."
            : "The fresh observation did not match an admitted resume checkpoint.";
    const observation = await run.driver.observe({
        includeAccessibility: true,
        includeScreenshot: true,
    });
    await run.recorder.append({
        type: "resume-rejected",
        recordedAt: new Date().toISOString(),
        observation,
        reason,
    });
    return {
        record: { type: "resume-rejected", reason, evidence: observation },
        terminal: false,
    };
}

async function transferControl(
    run: SessionRun,
    expected: "automation" | "human",
    epoch: number,
    next: "automation" | "human",
    type: "control-taken" | "control-released",
): Promise<SessionCommandOutcome> {
    const before = run.lease.current();
    try {
        const after = run.lease.transfer(expected, epoch, next);
        await run.options.onControlChange?.(after);
        await run.recorder.append({
            type: "control-transfer",
            recordedAt: new Date().toISOString(),
            from: before,
            to: after,
        });
        return { record: { type, control: after }, terminal: false };
    } catch (error) {
        return {
            record: { type: "control-rejected", reason: describeError(error) },
            terminal: false,
        };
    }
}

function humanControlFailure(run: SessionRun, epoch: number): string | null {
    try {
        run.lease.assertOwnedBy("human", epoch);
        return null;
    } catch (error) {
        return describeError(error);
    }
}

function automationControlFailure(
    run: SessionRun,
    epoch: unknown,
): string | null {
    if (typeof epoch !== "number") {
        return "Act requires the current control lease epoch.";
    }
    try {
        run.lease.assertOwnedBy("automation", epoch);
        return null;
    } catch (error) {
        return describeError(error);
    }
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
        command.type !== "take-control" &&
        command.type !== "human-observe" &&
        command.type !== "human-act" &&
        command.type !== "resume" &&
        command.type !== "release-control" &&
        command.type !== "act" &&
        command.type !== "checkpoint" &&
        command.type !== "finish"
    ) {
        throw new Error("Unknown session command type");
    }
    if (
        (command.type === "act" ||
            command.type === "take-control" ||
            command.type === "human-observe" ||
            command.type === "human-act" ||
            command.type === "resume" ||
            command.type === "release-control") &&
        typeof command.controlEpoch !== "number"
    ) {
        const label = command.type === "act" ? "Act" : command.type;
        throw new Error(`${label} requires the current control lease epoch`);
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
