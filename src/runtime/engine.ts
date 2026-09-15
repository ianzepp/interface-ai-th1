import type {
    ActionResult,
    SurfaceAction,
    SurfaceDriver,
} from "../surfaces/surface-driver.js";
import type { ArtifactPolicy } from "./policy.js";
import type { RunResult } from "./result.js";
import { selectDestination, type CapabilityArtifact } from "./state-machine.js";

/**
 * Replay: the production path, with no model in the decision loop.
 *
 * The engine walks the artifact's stages, applies the
 * recorded policy to each action, match the resulting state against that
 * stage's detectors, and return a terminal outcome. Determinism is the whole
 * point: the same artifact against the same target version with the same inputs
 * must produce the same result and the same outputs, which is what makes a
 * capability safe to invoke unattended and cheap enough to invoke often.
 *
 * Runtime conditions are expected rather than
 * exceptional. An expired session, a validation error, or a "record not found"
 * page is a state to detect and route on, not a crash to propagate.
 */

/** One call: which capability, and the values for its declared inputs. */
export interface CapabilityInvocation {
    capabilityId: string;
    inputs: Record<string, unknown>;
}

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
                    stage.detectors,
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
        return { ...action, value: bind(action.value) };
    return action;
}

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
