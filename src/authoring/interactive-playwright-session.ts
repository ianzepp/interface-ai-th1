/**
 * One live discovery browser session, as a command handler rather than a
 * process.
 *
 * The session's decisions (policy gate, origin check, target resolution,
 * recording, finalization) have exactly one implementation here; only how
 * commands arrive varies. The control socket stays a thin carrier of
 * `SessionCommand`s rather than a second implementation of what they mean.
 *
 * INVARIANTS
 * - `prepare` (authentication) runs before tracing and before the run
 *   directory exists, so a fixture credential reaches neither trace nor ledger.
 * - `handle` never rejects. A failed command comes back as a `command-error`
 *   record, so the transport stays alive and the caller decides what is next.
 * - Once a command reports `terminal`, the run is finalized and further
 *   commands are refused rather than recorded against a closed run.
 * - An action is authorized by the latest observation identity, and each
 *   identity authorizes at most one action.
 * - Producer provenance is sealed by the launcher; a command carrying it is
 *   refused at the parser.
 */

import { basename, join } from "node:path";

import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright";

import { describeError } from "../common/errors.js";
import { ControlLease } from "../intervention/control-lease.js";
import {
    createInterventionRequest,
    type InterventionRequest,
} from "../intervention/request.js";
import {
    evaluateResume,
    type ResumeCheckpoint,
} from "../intervention/resume.js";
import { ArtifactPolicy, type PolicyConfiguration } from "../runtime/policy.js";
import type { CapabilityStage } from "../runtime/state-machine.js";
import { PlaywrightBrowserDriver } from "../surfaces/playwright-driver.js";
import type { ActionRisk, SurfaceAction } from "../surfaces/surface-driver.js";
import {
    type DecisionReceipt,
    type EventIdentity,
    isEventIdentity,
    type ObservationIdentity,
} from "./event-recorder.js";
import { PlaywrightRunCapture } from "./playwright-run-capture.js";
import {
    FileRunRecorder,
    type ProducerRecord,
    type ReviewedResumeBinding,
    type RunOutcome,
} from "./run-recorder.js";

/**
 * Fields only the launcher may supply. A command carrying any of them is
 * refused before it can touch the ledger or the manifest.
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

const SESSION_COMMAND_TYPES: ReadonlySet<unknown> = new Set<
    SessionCommand["type"]
>([
    "observe",
    "take-control",
    "human-observe",
    "human-act",
    "resume",
    "escalate",
    "act",
    "checkpoint",
    "finish",
]);

/** Command types that must name the current control lease epoch. */
const EPOCH_BOUND_COMMAND_TYPES: ReadonlySet<unknown> = new Set<
    SessionCommand["type"]
>(["act", "take-control", "human-observe", "human-act", "resume", "escalate"]);

export interface SessionOptions {
    rootDirectory: string;
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    /**
     * The launcher-sealed producer of this session's decisions. A controller
     * cannot supply it; commands that try are refused at the parser.
     */
    producer?: ProducerRecord | undefined;
    /** Exact launcher-declared values excluded from durable evidence. */
    sensitiveInputValues?: readonly string[];
    policy: PolicyConfiguration;
    prepare(page: Page): Promise<void>;
    sessionSocketPath?: string;
    /** Committed artifact authority for the stages that may re-admit automation. */
    resumeBinding?: ReviewedResumeBinding;
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
    | { type: "escalate"; reason: string; controlEpoch: number }
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
    | { type: "finish"; outcome: RunOutcome };

type CommandOf<T extends SessionCommand["type"]> = Extract<
    SessionCommand,
    { type: T }
>;

/** Commands whose lease refusal is recorded as a `control-rejected` event. */
type ControlCommand =
    "take-control" | "human-observe" | "human-act" | "resume" | "escalate";

type Controller = "automation" | "human";

/** One command's answer, and whether the run is now over. */
export interface SessionCommandOutcome {
    record: unknown;
    terminal: boolean;
}

/** A live session: a command handler plus the run it records into. */
export interface InteractiveSession {
    runId: string;
    runDirectory: string;
    handle(command: SessionCommand): Promise<SessionCommandOutcome>;
    /** Stop tracing and the browser, finalizing the run if it is still open. */
    close(): Promise<void>;
}

/** The live state a session's commands operate on, created once and shared. */
interface SessionRun {
    options: SessionOptions;
    page: Page;
    recorder: FileRunRecorder;
    capture: PlaywrightRunCapture;
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
 */
export async function createInteractiveSession(
    options: SessionOptions,
): Promise<InteractiveSession> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await options.prepare(page);

        const recorder = await FileRunRecorder.start({
            rootDirectory: options.rootDirectory,
            goal: options.goal,
            situation: options.situation,
            targetProfile: options.targetProfile,
            targetVersion: options.targetVersion,
            fixtureId: options.fixtureId,
            producer: options.producer,
            sensitiveInputValues: options.sensitiveInputValues,
            resumeBinding: options.resumeBinding,
        });
        const capture = await PlaywrightRunCapture.start(
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
        run.currentObservationIdentity = await recorder.append({
            type: "observation",
            recordedAt: new Date().toISOString(),
            observation: initialObservation,
        });

        return {
            runId: basename(recorder.directory),
            runDirectory: recorder.directory,

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

/** Parse one controller command line, refusing launcher-sealed fields. */
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
    if (!SESSION_COMMAND_TYPES.has(command.type)) {
        throw new Error("Unknown session command type");
    }
    if (
        EPOCH_BOUND_COMMAND_TYPES.has(command.type) &&
        typeof command.controlEpoch !== "number"
    ) {
        const label = command.type === "act" ? "Act" : String(command.type);
        throw new Error(`${label} requires the current control lease epoch`);
    }
    if (
        command.type === "escalate" &&
        (typeof command.reason !== "string" || command.reason.trim() === "")
    ) {
        throw new Error("escalate requires a reason");
    }
    return value as SessionCommand;
}

// --- Command dispatch -------------------------------------------------------

/** Apply one command, recording it and reporting the state it reached. */
function handleCommand(
    run: SessionRun,
    command: SessionCommand,
): Promise<SessionCommandOutcome> {
    switch (command.type) {
        case "take-control":
            return takeControl(run, command.controlEpoch);
        case "escalate":
            return handleEscalate(run, command);
        case "resume":
            return handleResume(run, command.controlEpoch);
        case "observe":
        case "human-observe":
            return handleObserve(run, command);
        case "human-act":
            return handleHumanAct(run, command);
        case "checkpoint":
            return handleCheckpoint(run, command);
        case "finish":
            return handleFinish(run, command.outcome);
        case "act":
            return handleAct(run, command);
    }
}

async function takeControl(
    run: SessionRun,
    epoch: number,
): Promise<SessionCommandOutcome> {
    try {
        const control = await transferLease(run, "automation", epoch, "human");
        return { record: { type: "control-taken", control }, terminal: false };
    } catch (error) {
        return rejectControl(run, "take-control", describeError(error));
    }
}

async function handleEscalate(
    run: SessionRun,
    command: CommandOf<"escalate">,
): Promise<SessionCommandOutcome> {
    const failure = automationControlFailure(run, command.controlEpoch);
    if (failure !== null) {
        return rejectControl(run, "escalate", failure);
    }
    // Escalation is a decision about the screen the controller last saw, so the
    // request names that observation rather than an artifact stage that
    // discovery has not authored yet.
    const identity = run.currentObservationIdentity;
    const stageId =
        identity === null
            ? "discovery"
            : `observation:${String(identity.sequence)}`;
    const request = await raiseIntervention(run, stageId, command.reason);
    return {
        record: { type: "intervention-required", request },
        terminal: false,
    };
}

/**
 * Hand control back to automation only when a reviewed checkpoint's detectors
 * match the page the human left; a checkpoint that completes the goal also
 * finalizes the run.
 */
async function handleResume(
    run: SessionRun,
    epoch: number,
): Promise<SessionCommandOutcome> {
    const failure = humanControlFailure(run, epoch);
    if (failure !== null) {
        return rejectControl(run, "resume", failure);
    }

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
        const control = await transferLease(run, "human", epoch, "automation");
        if (decision.type === "complete") {
            const outcome = {
                status: "satisfied" as const,
                checkpoint: decision.checkpoint,
                summary: `Human recovery reached approved checkpoint ${decision.checkpoint}.`,
            };
            await finalizeRun(run, outcome);
            return { record: { type: "completed", outcome }, terminal: true };
        }
        return {
            record: { type: "resume-validated", decision, control },
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

async function handleObserve(
    run: SessionRun,
    command: CommandOf<"observe" | "human-observe">,
): Promise<SessionCommandOutcome> {
    if (command.type === "human-observe") {
        const failure = humanControlFailure(run, command.controlEpoch);
        if (failure !== null) {
            return rejectControl(run, "human-observe", failure);
        }
    }
    const observation = await run.driver.observe({
        includeAccessibility: true,
        includeScreenshot: command.screenshot ?? false,
    });
    const observationIdentity = await run.recorder.append({
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

/** A human action skips the policy gate but not the lease, observation, or origin checks. */
async function handleHumanAct(
    run: SessionRun,
    command: CommandOf<"human-act">,
): Promise<SessionCommandOutcome> {
    const controlFailure = humanControlFailure(run, command.controlEpoch);
    if (controlFailure !== null) {
        await recordControlRejection(run, "human-act", controlFailure);
        return humanActionRejected("control-lease-refused", controlFailure);
    }
    const observationFailure = observeRequirementFailure(
        run,
        command.observationIdentity,
    );
    if (observationFailure !== null) {
        return humanActionRejected("observe-required", observationFailure);
    }
    run.observationConsumed = true;
    const originFailure = originPolicyFailure(run, command.action);
    if (originFailure !== null) {
        return humanActionRejected("origin-not-allowed", originFailure);
    }
    const result = await performAction(run, command.action);
    await run.recorder.append({
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

async function handleCheckpoint(
    run: SessionRun,
    command: CommandOf<"checkpoint">,
): Promise<SessionCommandOutcome> {
    await run.recorder.append({
        ...command,
        recordedAt: new Date().toISOString(),
    });
    return {
        record: { type: "checkpoint-recorded", name: command.name },
        terminal: false,
    };
}

async function handleFinish(
    run: SessionRun,
    requested: RunOutcome,
): Promise<SessionCommandOutcome> {
    const outcome = await deriveTerminalOutcome(run, requested);
    if (outcome === null) {
        const reason =
            "A satisfied finish requires a validated resume and return of control to automation after human handoff.";
        await recordControlRejection(run, "finish", reason);
        return {
            record: { type: "finish-rejected", reason },
            terminal: false,
        };
    }
    await finalizeRun(run, outcome);
    return {
        record: { type: "finished", outcome },
        terminal: true,
    };
}

/**
 * Gate and run an automation action. The proposal is receipted against the
 * observation it followed and recorded before it runs, so a refusal or a
 * thrown locator leaves evidence of the attempt rather than a ledger gap.
 */
async function handleAct(
    run: SessionRun,
    command: CommandOf<"act">,
): Promise<SessionCommandOutcome> {
    const receipt = run.recorder.buildDecisionReceipt({
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
    // Consume the observation before evaluating policy or doing any
    // asynchronous work, so a concurrent action cannot reuse it.
    run.observationConsumed = true;
    const decision = run.policy.evaluate(command.action, command.risk);
    await run.recorder.append({
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
    const originFailure = originPolicyFailure(run, command.action);
    if (originFailure !== null) {
        return rejectDecision(
            run,
            command,
            receipt,
            "origin-not-allowed",
            originFailure,
        );
    }
    const result = await performAction(run, command.action);
    await run.recorder.append({
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

// --- Control lease: handoff, refusal, and lease checks ----------------------

/** Move the lease, notify the launcher, and record the transfer. */
async function transferLease(
    run: SessionRun,
    expected: Controller,
    epoch: number,
    next: Controller,
    requestId?: string,
): Promise<ReturnType<ControlLease["transfer"]>> {
    const before = run.lease.current();
    const after = run.lease.transfer(expected, epoch, next);
    await run.options.onControlChange?.(after);
    await run.recorder.append({
        type: "control-transfer",
        recordedAt: new Date().toISOString(),
        from: before,
        to: after,
        ...(requestId === undefined ? {} : { requestId }),
    });
    return after;
}

async function rejectControl(
    run: SessionRun,
    command: ControlCommand,
    reason: string,
): Promise<SessionCommandOutcome> {
    await recordControlRejection(run, command, reason);
    return { record: { type: "control-rejected", reason }, terminal: false };
}

function recordControlRejection(
    run: SessionRun,
    command: ControlCommand | "finish",
    reason: string,
): ReturnType<FileRunRecorder["append"]> {
    return run.recorder.append({
        type: "control-rejected",
        recordedAt: new Date().toISOString(),
        command,
        reason,
    });
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
    epoch: number | undefined,
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

// --- Intervention -----------------------------------------------------------

async function requireIntervention(
    run: SessionRun,
    command: CommandOf<"act">,
    receipt: DecisionReceipt,
    reason: string,
): Promise<SessionCommandOutcome> {
    const request = await raiseIntervention(
        run,
        `action:${command.action.type}`,
        reason,
    );
    return {
        record: { type: "intervention-required", request, receipt },
        terminal: false,
    };
}

/**
 * Record an intervention request and hand the lease to a human. Evidence and
 * the request reach the ledger before the lease moves, so the person who takes
 * over can see why they were called and what automation saw at that moment.
 */
async function raiseIntervention(
    run: SessionRun,
    stageId: string,
    reason: string,
): Promise<InterventionRequest> {
    const evidence = await run.driver.captureEvidence("intervention");
    const epoch = run.lease.current().epoch;
    const request = createInterventionRequest({
        id: `intervention:${run.recorder.directory}:${String(epoch)}`,
        capabilityId: run.options.targetProfile,
        goal: run.options.goal,
        stageId,
        reason,
        controlEpoch: epoch,
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
    await transferLease(run, "automation", epoch, "human", request.id);
    return request;
}

// --- Action gates and execution ---------------------------------------------

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

function sameEventIdentity(left: EventIdentity, right: EventIdentity): boolean {
    return left.sequence === right.sequence && left.hash === right.hash;
}

/** Why an action's origin is refused, or `null` when it is allowlisted. */
function originPolicyFailure(
    run: SessionRun,
    action: SurfaceAction,
): string | null {
    const candidate = action.type === "navigate" ? action.url : run.page.url();
    let origin: string;
    try {
        origin = new URL(candidate).origin;
    } catch {
        return `Invalid action URL: ${candidate}`;
    }
    return run.options.policy.allowedOrigins.includes(origin)
        ? null
        : `Origin ${origin} is not allowlisted`;
}

/** Resolve the action's target, then run it under trace capture. */
async function performAction(
    run: SessionRun,
    action: SurfaceAction,
): Promise<Awaited<ReturnType<PlaywrightBrowserDriver["act"]>>> {
    if (action.type !== "navigate" && action.type !== "press") {
        await run.driver.locate(action.target);
    }
    return run.capture.execute(action, () => run.driver.act(action));
}

function humanActionRejected(
    reason: string,
    detail: string,
): SessionCommandOutcome {
    return {
        record: { type: "action-rejected", reason, detail },
        terminal: false,
    };
}

/** Record an explicit rejected decision and report the refusal. */
async function rejectDecision(
    run: SessionRun,
    command: CommandOf<"act">,
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

// --- Finalization -----------------------------------------------------------

/**
 * The outcome a finish may record, or `null` when a satisfied finish is not
 * earned: without a handoff it needs a satisfied checkpoint; after a handoff,
 * every handoff needs a validated resume and a return to automation.
 */
async function deriveTerminalOutcome(
    run: SessionRun,
    requested: RunOutcome,
): Promise<RunOutcome | null> {
    if (requested.status === "error") {
        return {
            status: "error",
            code: requested.code,
            summary: `Session ended with recorded error ${requested.code}.`,
        };
    }

    const events = await run.recorder.readAll();
    const handoff = events.some((event) => event.type === "control-transfer");
    if (!handoff) {
        const checkpoint = [...events]
            .reverse()
            .find(
                (
                    event,
                ): event is Extract<typeof event, { type: "checkpoint" }> =>
                    event.type === "checkpoint" && event.satisfied,
            );
        if (checkpoint === undefined) return null;
        return {
            status: "satisfied",
            checkpoint: checkpoint.name,
            summary: `Recorded checkpoint ${checkpoint.name} satisfied the session goal.`,
        };
    }
    if (run.lease.current().controller !== "automation") return null;
    const resumes = events.filter(
        (event): event is Extract<typeof event, { type: "resume-validated" }> =>
            event.type === "resume-validated",
    );
    const handoffs = events.filter(
        (event) =>
            event.type === "control-transfer" &&
            event.from.controller === "automation" &&
            event.to.controller === "human",
    );
    const returns = events.filter(
        (event) =>
            event.type === "control-transfer" &&
            event.from.controller === "human" &&
            event.to.controller === "automation",
    );
    if (resumes.length < handoffs.length || returns.length < handoffs.length) {
        return null;
    }
    const latest = resumes.at(-1);
    if (latest === undefined) return null;
    const checkpoint =
        latest.decision.type === "complete"
            ? latest.decision.checkpoint
            : latest.decision.stageId;
    return {
        status: "satisfied",
        checkpoint,
        summary: `Validated resume returned control to automation at checkpoint ${checkpoint}.`,
    };
}

/** Record the terminal event, stop capture, and refuse further commands. */
async function finalizeRun(
    run: SessionRun,
    outcome: RunOutcome,
): Promise<void> {
    await run.recorder.append({
        type: "terminal",
        recordedAt: new Date().toISOString(),
        outcome,
    });
    await run.capture.finish(outcome);
    run.finalized = true;
}

async function closeQuietly(
    context: BrowserContext,
    browser: Browser,
): Promise<void> {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
}
