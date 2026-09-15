import type {
    ActionResult,
    SurfaceAction,
    SurfaceDriver,
} from "../surfaces/surface-driver.js";
import type { ArtifactPolicy } from "./policy.js";
import type { RunResult } from "./result.js";
import { selectDestination, type CapabilityArtifact } from "./state-machine.js";

/**
 * The execution plane: the production path, with no model in the decision loop.
 *
 * The engine walks the artifact's stages, applies the recorded policy to each
 * action, matches the observed state against that stage's detectors, and returns
 * a terminal outcome. Determinism is the whole point: the same artifact against
 * the same target version with the same inputs must produce the same result and
 * the same outputs, which is what makes a capability safe to invoke unattended
 * and cheap enough to invoke often.
 *
 * Runtime conditions are expected rather than exceptional. An expired session, a
 * validation error, or a "record not found" page is a state to detect and route
 * on, not a crash to propagate.
 *
 * INVARIANTS
 * - The engine holds no application knowledge. Stages, detectors, transitions,
 *   and bindings all arrive from the artifact.
 * - Input binding happens before policy and origin checks, so those two decide on
 *   the action that would actually run rather than on its template.
 * - The walk is step-limited by the artifact's own stage count, so a graph cycle
 *   ends as a typed failure instead of a hang.
 *
 * LIMITS
 * - Determinism is guaranteed over the graph, not over the surface. A recognized
 *   state always routes the same way; the engine cannot make the application
 *   reach that state.
 * - A driver exception becomes a `stage-execution-failed` failure instead of
 *   propagating, so a run always ends typed. The cost is that a driver bug and a
 *   genuinely unrecognized screen arrive by the same code, and only the recorded
 *   `observed` text tells them apart.
 * - The caller owns the session. The engine starts no browser, resets no fixture,
 *   and finalizes no run.
 */

/** One call: which capability, and the values for its declared inputs. */
export interface CapabilityInvocation {
    capabilityId: string;
    inputs: Record<string, unknown>;
}

/**
 * Where a replay reports progress.
 *
 * The engine is deliberately silent about evidence. A caller that wants a run
 * directory, a trace, or a live progress display supplies an observer, so replay
 * and discovery can produce the same evidence shape without the engine knowing
 * what a run directory is.
 */
export interface EngineObserver {
    actionCompleted(
        stageId: string,
        action: SurfaceAction,
        result: ActionResult,
    ): Promise<void>;
    checkpoint(stageId: string, detectorId: string): Promise<void>;
}

export interface EngineOptions {
    stageTimeoutMs?: number;
    observer?: EngineObserver;
}

/**
 * Walk one artifact against one surface.
 *
 * The engine is stateless between calls: everything a run needs arrives as the
 * artifact plus the invocation, so two invocations cannot contaminate each other
 * and a failed run leaves nothing behind to reset.
 */
export class DeterministicEngine {
    public constructor(
        public readonly driver: SurfaceDriver,
        public readonly policy: ArtifactPolicy,
        public readonly options: EngineOptions = {},
    ) {}

    public run(
        artifact: CapabilityArtifact,
        invocation: CapabilityInvocation,
    ): Promise<RunResult> {
        return this.execute(artifact, invocation);
    }

    /**
     * The stage loop: act, detect, extract, transition.
     *
     * Each guard below refuses the run before any browser action happens, because
     * a mismatched artifact or policy means the reviewed graph is not the graph
     * that would execute.
     */
    private async execute(
        artifact: CapabilityArtifact,
        invocation: CapabilityInvocation,
    ): Promise<RunResult> {
        if (invocation.capabilityId !== artifact.id) {
            return failure(
                "artifact",
                "capability-id-mismatch",
                artifact.id,
                invocation.capabilityId,
                [],
            );
        }
        if (
            JSON.stringify(this.policy.configuration) !==
            JSON.stringify(artifact.policy)
        ) {
            return failure(
                "artifact",
                "policy-mismatch",
                JSON.stringify(artifact.policy),
                JSON.stringify(this.policy.configuration),
                [],
            );
        }
        const stages = new Map(
            artifact.stages.map((stage) => [stage.id, stage]),
        );
        let stageId = artifact.entryStageId;
        const outputs: Record<string, unknown> = {};
        // Two steps per stage is the budget the graph needs to reach a terminal
        // from any admitted entry point; anything beyond that is a cycle.
        for (let step = 0; step <= artifact.stages.length * 2; step += 1) {
            const stage = stages.get(stageId);
            if (stage === undefined)
                return failure(
                    stageId,
                    "missing-stage",
                    "declared stage",
                    "missing",
                    [],
                );
            try {
                if (stage.action !== undefined) {
                    const action = bindAction(stage.action, invocation.inputs);
                    const currentUrl =
                        action.type === "navigate"
                            ? undefined
                            : (
                                  await this.driver.observe({
                                      includeAccessibility: false,
                                      includeScreenshot: false,
                                  })
                              ).url;
                    const originFailure = validateOrigin(
                        action,
                        artifact.policy.allowedOrigins,
                        currentUrl,
                    );
                    if (originFailure !== null)
                        return failure(
                            stage.id,
                            "origin-blocked",
                            artifact.policy.allowedOrigins.join(", "),
                            originFailure,
                            [],
                        );
                    const decision = this.policy.evaluate(action, stage.risk);
                    if (decision.type === "block")
                        return failure(
                            stage.id,
                            "policy-blocked",
                            "allow",
                            decision.reason,
                            [],
                        );
                    if (decision.type === "require-confirmation") {
                        return {
                            type: "intervention-required",
                            requestId: `${artifact.id}:${stage.id}`,
                            code: "policy-confirmation-required",
                        };
                    }
                    // Navigating and pressing act on the page rather than on a
                    // located control, so only the other verbs resolve a target
                    // first. Locating early is what turns an ambiguous or missing
                    // control into a typed failure before the action mutates state.
                    if (action.type !== "navigate" && action.type !== "press")
                        await this.driver.locate(action.target);
                    const result = await this.driver.act(action);
                    await this.options.observer?.actionCompleted(
                        stage.id,
                        action,
                        result,
                    );
                }

                const match = await this.driver.waitFor(
                    stage.detectors.map((detector) =>
                        bindDetector(detector, invocation.inputs),
                    ),
                    this.options.stageTimeoutMs ?? 15_000,
                );
                for (const extraction of stage.extractions)
                    outputs[extraction.name] =
                        await this.driver.extract(extraction);
                if (match !== null)
                    await this.options.observer?.checkpoint(
                        stage.id,
                        match.detectorId,
                    );
                const destination = selectDestination(
                    stage,
                    match?.detectorId ?? null,
                );
                if (destination.type === "stage") {
                    stageId = destination.stageId;
                    continue;
                }
                switch (destination.outcome.type) {
                    case "success":
                        return { type: "success", outputs };
                    case "business-outcome":
                        return {
                            type: "business-outcome",
                            code: destination.outcome.code,
                            details: outputs,
                        };
                    case "intervention-required":
                        return {
                            type: "intervention-required",
                            requestId: `${artifact.id}:${stage.id}`,
                            code: destination.outcome.code,
                        };
                    case "failure":
                        return failure(
                            stage.id,
                            destination.outcome.code,
                            stage.detectors.map((d) => d.id).join(", "),
                            match?.detectorId ?? "unrecognized state",
                            [],
                        );
                }
            } catch (error) {
                const evidence = await this.driver
                    .captureEvidence(`failure-${stage.id}`)
                    .then((item) => [item])
                    .catch(() => []);
                return failure(
                    stage.id,
                    "stage-execution-failed",
                    stage.description,
                    error instanceof Error ? error.message : String(error),
                    evidence,
                );
            }
        }
        return failure(
            stageId,
            "stage-cycle",
            "terminating graph",
            "stage limit exceeded",
            [],
        );
    }
}

/**
 * Resolve `{{input.NAME}}` placeholders against the invocation's inputs.
 *
 * Binding is textual and total: an unbound placeholder is an error rather than an
 * empty string, because a half-resolved target would silently act on the wrong
 * control while still looking like a faithful replay of the reviewed artifact.
 *
 * The three functions below exist because a placeholder can appear in three
 * shapes: inside a detector signal, inside a target candidate nested in a
 * detector's count signal, and inside an action's own target. Each shape needs
 * its own traversal, but they share this one substitution rule.
 */
function bindDetector(
    detector: import("../surfaces/surface-driver.js").StateDetector,
    inputs: Record<string, unknown>,
): import("../surfaces/surface-driver.js").StateDetector {
    const bind = (value: string): string =>
        value.replaceAll(
            /\{\{input\.([a-zA-Z0-9_-]+)\}\}/g,
            (_match, name: string) => {
                if (!(name in inputs))
                    throw new Error(`Missing invocation input: ${name}`);
                return String(inputs[name]);
            },
        );
    return {
        ...detector,
        signals: detector.signals.map((signal) => {
            switch (signal.kind) {
                case "url":
                    return { ...signal, pattern: bind(signal.pattern) };
                case "text":
                    return { ...signal, value: bind(signal.value) };
                case "role":
                    return { ...signal, name: bind(signal.name) };
                case "count":
                    return {
                        ...signal,
                        target: bindTarget(signal.target, bind),
                    };
                case "response-status":
                case "timeout":
                    return signal;
            }
        }),
    };
}

function bindTarget(
    target: import("../surfaces/surface-driver.js").TargetDescriptor,
    bind: (value: string) => string,
): import("../surfaces/surface-driver.js").TargetDescriptor {
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

/** Bind an action's own target and value, leaving action types without either alone. */
function bindAction(
    action: SurfaceAction,
    inputs: Record<string, unknown>,
): SurfaceAction {
    const bind = (value: string): string =>
        value.replaceAll(
            /\{\{input\.([a-zA-Z0-9_-]+)\}\}/g,
            (_match, name: string) => {
                if (!(name in inputs))
                    throw new Error(`Missing invocation input: ${name}`);
                return String(inputs[name]);
            },
        );
    if (action.type === "navigate") return { ...action, url: bind(action.url) };
    if (action.type === "fill" || action.type === "select")
        return {
            ...action,
            target: bindTarget(action.target, bind),
            value: bind(action.value),
        };
    if (action.type === "activate")
        return { ...action, target: bindTarget(action.target, bind) };
    return action;
}

/**
 * Check the origin an action would actually touch.
 *
 * A navigation is judged by where it is going; every other action is judged by
 * the page it is already on. An action with no determinable URL is refused rather
 * than allowed, so a driver that cannot report its location cannot widen the
 * allowlist by omission.
 */
function validateOrigin(
    action: SurfaceAction,
    allowedOrigins: readonly string[],
    currentUrl?: string,
): string | null {
    const url = action.type === "navigate" ? action.url : currentUrl;
    if (url === undefined) return "unknown origin";
    const origin = new URL(url).origin;
    return allowedOrigins.includes(origin) ? null : origin;
}

/** Build the unrecoverable result every refusal path returns. */
function failure(
    stageId: string,
    code: string,
    expected: string,
    observed: string,
    evidence: Awaited<ReturnType<SurfaceDriver["captureEvidence"]>>[],
): RunResult {
    return {
        type: "failure",
        code,
        detail: { stageId, expected, observed, evidence },
    };
}
