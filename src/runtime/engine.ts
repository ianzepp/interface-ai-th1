/**
 * The execution plane: walks a capability artifact with no model in the loop.
 *
 * The engine applies the recorded policy to each stage's action, matches the
 * observed state against that stage's detectors, and returns a typed terminal
 * outcome. The same artifact against the same target version with the same
 * inputs must produce the same result and outputs, which is what makes a
 * capability safe to invoke unattended. An expired session, a validation
 * error, or a "record not found" page is a state to route on, not a crash.
 *
 * INVARIANTS
 * - The engine holds no application knowledge. Stages, detectors, transitions,
 *   and bindings all arrive from the artifact.
 * - Input binding happens before policy and origin checks, so those two decide
 *   on the action that would actually run rather than on its template.
 * - The walk is step-limited by the artifact's own stage count, so a graph
 *   cycle ends as a typed failure instead of a hang.
 *
 * LIMITS
 * - Determinism is guaranteed over the graph, not over the surface. A
 *   recognized state always routes the same way; the engine cannot make the
 *   application reach that state.
 * - A driver exception becomes a `stage-execution-failed` failure instead of
 *   propagating, so a run always ends typed. The cost is that a driver bug and
 *   a genuinely unrecognized screen arrive by the same code, and only the
 *   recorded `observed` text tells them apart.
 * - The caller owns the session. The engine starts no browser, resets no
 *   fixture, and finalizes no run.
 */

import { describeError } from "../common/errors.js";
import type {
    ActionResult,
    EvidenceReference,
    StateDetector,
    SurfaceAction,
    SurfaceDriver,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import type { ArtifactPolicy } from "./policy.js";
import type { FailureDetail, RecoveryReport, RunResult } from "./result.js";
import {
    selectDestination,
    selectTransition,
    type CapabilityArtifact,
    type CapabilityStage,
    type RecoveryDeclaration,
    type TerminalOutcome,
} from "./state-machine.js";

const DEFAULT_STAGE_TIMEOUT_MS = 15_000;

/** A `{{input.NAME}}` placeholder; group 1 is the input name. */
const INPUT_PLACEHOLDER = /\{\{input\.([a-zA-Z0-9_-]+)\}\}/g;

/** One call: which capability, and the values for its declared inputs. */
export interface CapabilityInvocation {
    capabilityId: string;
    inputs: Record<string, unknown>;
}

/**
 * Where a replay reports progress.
 *
 * The engine persists nothing. A caller that wants a run directory, a trace,
 * or a live progress display supplies an observer, so replay and discovery can
 * produce the same evidence shape without the engine knowing what a run
 * directory is.
 */
export interface EngineObserver {
    actionCompleted(
        stageId: string,
        action: SurfaceAction,
        result: ActionResult,
    ): Promise<void>;
    checkpoint(stageId: string, detectorId: string): Promise<void>;
    recoveryOccurred?(recovery: RecoveryReport): Promise<void>;
}

/** `stageTimeoutMs` bounds each stage's detector wait; it defaults to 15s. */
export interface EngineOptions {
    stageTimeoutMs?: number;
    observer?: EngineObserver;
}

/**
 * Walk one artifact against one surface.
 *
 * The engine is stateless between calls: everything a run needs arrives as the
 * artifact plus the invocation, so two invocations cannot contaminate each
 * other and a failed run leaves nothing behind to reset.
 */
export class DeterministicEngine {
    public constructor(
        public readonly driver: SurfaceDriver,
        public readonly policy: ArtifactPolicy,
        public readonly options: EngineOptions = {},
    ) {}

    /**
     * The stage loop: act, detect, extract, transition.
     *
     * The two guards refuse the run before any browser action happens, because
     * a mismatched artifact or policy means the reviewed graph is not the graph
     * that would execute.
     */
    public async run(
        artifact: CapabilityArtifact,
        invocation: CapabilityInvocation,
    ): Promise<RunResult> {
        if (invocation.capabilityId !== artifact.id) {
            return buildFailure(
                "artifact",
                "capability-id-mismatch",
                artifact.id,
                invocation.capabilityId,
                [],
                [],
            );
        }
        if (
            JSON.stringify(this.policy.configuration) !==
            JSON.stringify(artifact.policy)
        ) {
            return buildFailure(
                "artifact",
                "policy-mismatch",
                JSON.stringify(artifact.policy),
                JSON.stringify(this.policy.configuration),
                [],
                [],
            );
        }
        const stages = new Map(
            artifact.stages.map((stage) => [stage.id, stage]),
        );
        let stageId = artifact.entryStageId;
        const outputs: Record<string, unknown> = {};
        const recoveries: RecoveryReport[] = [];
        const recoveryAttempts = new Map<string, number>();
        // Two steps per stage is the budget the graph needs to reach a terminal
        // from any admitted entry point; anything beyond that is a cycle.
        for (let step = 0; step <= artifact.stages.length * 2; step += 1) {
            const stage = stages.get(stageId);
            if (stage === undefined) {
                return buildFailure(
                    stageId,
                    "missing-stage",
                    "declared stage",
                    "missing",
                    [],
                    recoveries,
                );
            }
            try {
                if (stage.action !== undefined) {
                    const refusal = await this.performAction(
                        artifact,
                        stage,
                        stage.action,
                        invocation.inputs,
                        recoveries,
                    );
                    if (refusal !== null) return refusal;
                }

                const match = await this.driver.waitFor(
                    stage.detectors.map((detector) =>
                        bindDetector(detector, invocation.inputs),
                    ),
                    this.options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS,
                );
                for (const extraction of stage.extractions) {
                    outputs[extraction.name] =
                        await this.driver.extract(extraction);
                }
                if (match !== null) {
                    await this.options.observer?.checkpoint(
                        stage.id,
                        match.detectorId,
                    );
                }
                const detectorId = match?.detectorId ?? null;
                const transition = selectTransition(stage, detectorId);
                const destination = selectDestination(stage, detectorId);
                if (transition?.recovery !== undefined) {
                    const exhausted = await this.recordRecovery(
                        stage.id,
                        transition.detectorId,
                        transition.recovery,
                        recoveryAttempts,
                        recoveries,
                    );
                    if (exhausted !== null) return exhausted;
                }
                if (destination.type === "stage") {
                    stageId = destination.stageId;
                    continue;
                }
                return buildTerminalResult(
                    artifact.id,
                    stage,
                    destination.outcome,
                    detectorId,
                    outputs,
                    recoveries,
                );
            } catch (error) {
                const evidence = await this.captureOptionalEvidence(
                    `failure-${stage.id}`,
                );
                return buildFailure(
                    stage.id,
                    "stage-execution-failed",
                    stage.description,
                    describeError(error),
                    evidence,
                    recoveries,
                );
            }
        }
        return buildFailure(
            stageId,
            "stage-cycle",
            "terminating graph",
            "stage limit exceeded",
            [],
            recoveries,
        );
    }

    /**
     * Bind, vet, and perform one stage's action.
     *
     * Returns the result that ends the run when the origin or the policy
     * refuses the action, or `null` once the action has run.
     */
    private async performAction(
        artifact: CapabilityArtifact,
        stage: CapabilityStage,
        template: SurfaceAction,
        inputs: Record<string, unknown>,
        recoveries: readonly RecoveryReport[],
    ): Promise<RunResult | null> {
        const action = bindAction(template, inputs);
        const currentUrl =
            action.type === "navigate"
                ? undefined
                : (
                      await this.driver.observe({
                          includeAccessibility: false,
                          includeScreenshot: false,
                      })
                  ).url;
        const blockedOrigin = readBlockedOrigin(
            action,
            artifact.policy.allowedOrigins,
            currentUrl,
        );
        if (blockedOrigin !== null) {
            return buildFailure(
                stage.id,
                "origin-blocked",
                artifact.policy.allowedOrigins.join(", "),
                blockedOrigin,
                [],
                recoveries,
            );
        }
        const decision = this.policy.evaluate(action, stage.risk);
        if (decision.type === "block") {
            return buildFailure(
                stage.id,
                "policy-blocked",
                "allow",
                decision.reason,
                [],
                recoveries,
            );
        }
        if (decision.type === "require-confirmation") {
            return {
                type: "intervention-required",
                requestId: `${artifact.id}:${stage.id}`,
                code: "policy-confirmation-required",
                recoveries,
            };
        }
        // Navigating and pressing act on the page rather than on a located
        // control, so only the other verbs resolve a target first. Locating
        // early is what turns an ambiguous or missing control into a typed
        // failure before the action mutates state.
        if (action.type !== "navigate" && action.type !== "press") {
            await this.driver.locate(action.target);
        }
        const result = await this.driver.act(action);
        await this.options.observer?.actionCompleted(stage.id, action, result);
        return null;
    }

    /**
     * Count and report one declared recovery.
     *
     * Returns the `recovery-exhausted` failure once the declaration's attempt
     * budget is spent, or `null` after the recovery has been recorded.
     */
    private async recordRecovery(
        stageId: string,
        detectorId: string,
        recovery: RecoveryDeclaration,
        recoveryAttempts: Map<string, number>,
        recoveries: RecoveryReport[],
    ): Promise<RunResult | null> {
        const attempt = (recoveryAttempts.get(recovery.id) ?? 0) + 1;
        if (attempt > recovery.maxAttempts) {
            return buildFailure(
                stageId,
                "recovery-exhausted",
                recovery.id,
                recovery.condition,
                [],
                recoveries,
                { recoveryId: recovery.id, condition: recovery.condition },
            );
        }
        const evidence = await this.captureOptionalEvidence(
            `recovery-${recovery.id}-${String(attempt)}`,
        );
        const report: RecoveryReport = {
            recoveryId: recovery.id,
            condition: recovery.condition,
            sourceRunId: recovery.sourceRunId,
            detectorId,
            attempt,
            evidence,
        };
        recoveryAttempts.set(recovery.id, attempt);
        recoveries.push(report);
        await this.options.observer?.recoveryOccurred?.(report);
        return null;
    }

    /** Evidence for a report, or none when the capture itself fails. */
    private captureOptionalEvidence(
        reason: string,
    ): Promise<EvidenceReference[]> {
        return this.driver
            .captureEvidence(reason)
            .then((item) => [item])
            .catch(() => []);
    }
}

/** Build the unrecoverable result every refusal path returns. */
function buildFailure(
    stageId: string,
    code: string,
    expected: string,
    observed: string,
    evidence: readonly EvidenceReference[],
    recoveries: readonly RecoveryReport[],
    recovery?: FailureDetail["recovery"],
): RunResult {
    return {
        type: "failure",
        code,
        detail: {
            stageId,
            expected,
            observed,
            evidence,
            ...(recovery === undefined ? {} : { recovery }),
        },
        recoveries,
    };
}

/**
 * Resolve `{{input.NAME}}` placeholders in an action's own target and value.
 *
 * Binding is textual and total: an unbound placeholder is an error rather than
 * an empty string, because a half-resolved target would silently act on the
 * wrong control while still looking like a faithful replay of the reviewed
 * artifact. A placeholder can sit in an action, in a detector signal, or in a
 * target candidate nested in a detector's count signal; each shape has its own
 * traversal below, and all share `bindPlaceholders`.
 */
function bindAction(
    action: SurfaceAction,
    inputs: Record<string, unknown>,
): SurfaceAction {
    switch (action.type) {
        case "navigate":
            return { ...action, url: bindPlaceholders(action.url, inputs) };
        case "fill":
        case "select":
            return {
                ...action,
                target: bindTarget(action.target, inputs),
                value: bindPlaceholders(action.value, inputs),
            };
        case "activate":
            return { ...action, target: bindTarget(action.target, inputs) };
        case "press":
            return action;
    }
}

function bindTarget(
    target: TargetDescriptor,
    inputs: Record<string, unknown>,
): TargetDescriptor {
    const bind = (value: string): string => bindPlaceholders(value, inputs);
    return {
        ...target,
        candidates: target.candidates.map((candidate) => {
            switch (candidate.kind) {
                case "role":
                    return { ...candidate, name: bind(candidate.name) };
                case "label":
                    return { ...candidate, text: bind(candidate.text) };
                case "text":
                    return { ...candidate, text: bind(candidate.text) };
                case "css":
                    return { ...candidate, selector: bind(candidate.selector) };
                case "relative":
                    return {
                        ...candidate,
                        anchor: bind(candidate.anchor),
                        relation: bind(candidate.relation),
                    };
            }
        }),
    };
}

/** Substitute every placeholder, throwing on an input the caller omitted. */
function bindPlaceholders(
    value: string,
    inputs: Record<string, unknown>,
): string {
    return value.replaceAll(INPUT_PLACEHOLDER, (_match, name: string) => {
        if (!(name in inputs)) {
            throw new Error(`Missing invocation input: ${name}`);
        }
        return String(inputs[name]);
    });
}

/**
 * The origin an action would touch when it is outside the allowlist, else
 * `null`.
 *
 * A navigation is judged by where it is going; every other action is judged
 * by the page it is already on. An action with no determinable URL is refused
 * rather than allowed, so a driver that cannot report its location cannot
 * widen the allowlist by omission.
 */
function readBlockedOrigin(
    action: SurfaceAction,
    allowedOrigins: readonly string[],
    currentUrl: string | undefined,
): string | null {
    const url = action.type === "navigate" ? action.url : currentUrl;
    if (url === undefined) return "unknown origin";
    const origin = new URL(url).origin;
    return allowedOrigins.includes(origin) ? null : origin;
}

/** Bind a detector's signals, including targets nested in count signals. */
function bindDetector(
    detector: StateDetector,
    inputs: Record<string, unknown>,
): StateDetector {
    return {
        ...detector,
        signals: detector.signals.map((signal) => {
            switch (signal.kind) {
                case "url":
                    return {
                        ...signal,
                        pattern: bindPlaceholders(signal.pattern, inputs),
                    };
                case "text":
                    return {
                        ...signal,
                        value: bindPlaceholders(signal.value, inputs),
                    };
                case "role":
                    return {
                        ...signal,
                        name: bindPlaceholders(signal.name, inputs),
                    };
                case "count":
                    return {
                        ...signal,
                        target: bindTarget(signal.target, inputs),
                    };
                case "response-status":
                case "timeout":
                    return signal;
            }
        }),
    };
}

/** Turn the artifact's declared ending into the invocation's result. */
function buildTerminalResult(
    artifactId: string,
    stage: CapabilityStage,
    outcome: TerminalOutcome,
    detectorId: string | null,
    outputs: Record<string, unknown>,
    recoveries: readonly RecoveryReport[],
): RunResult {
    switch (outcome.type) {
        case "success":
            return { type: "success", outputs, recoveries };
        case "business-outcome":
            return {
                type: "business-outcome",
                code: outcome.code,
                details: outputs,
                recoveries,
            };
        case "intervention-required":
            return {
                type: "intervention-required",
                requestId: `${artifactId}:${stage.id}`,
                code: outcome.code,
                recoveries,
            };
        case "failure":
            return buildFailure(
                stage.id,
                outcome.code,
                stage.detectors.map((detector) => detector.id).join(", "),
                detectorId ?? "unrecognized state",
                [],
                recoveries,
            );
    }
}
