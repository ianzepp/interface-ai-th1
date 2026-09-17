import type {
    ActionRisk,
    ExtractionSpec,
    StateDetector,
    SurfaceAction,
} from "../surfaces/surface-driver.js";
import type { PolicyConfiguration } from "./policy.js";

/**
 * The capability artifact: what a discovered flow becomes.
 *
 * The first reviewed artifact uses this shape and the deterministic engine now
 * walks it. Automatic synthesis and formal approval remain future work;
 * artifacts are currently reviewed TypeScript values grounded in run evidence.
 *
 * An artifact is a state graph, not a transcript. Each stage says what it
 * intends to do, which states count as success or trouble, and where control
 * goes in every case, and the engine is to walk that graph with no model in the
 * loop. A transcript cannot do this: it has no answer for a page that is not
 * where the recording left it.
 *
 * INVARIANTS
 * - Every stage declares an `otherwise` destination, so an unrecognized state
 *   can never fall through to "continue anyway".
 * - `risk` is declared per stage, making the guardrail decision reviewable
 *   before the capability ever runs.
 * - The graph is versioned and traceable to the run that produced it.
 *
 * The graph is deliberately the artifact rather than a linear step list,
 * because a step list pushes every runtime condition into the engine as a
 * special case.
 */

/**
 * The ways a capability can stop.
 *
 * Mirrors the invocation result, and is declared here so a transition can name
 * an ending without the artifact depending on the runtime.
 */
export type TerminalOutcome =
    | { type: "success" }
    | { type: "business-outcome"; code: string }
    | { type: "intervention-required"; code: string }
    | { type: "failure"; code: string };

export type StageDestination =
    | { type: "stage"; stageId: string }
    | { type: "terminal"; outcome: TerminalOutcome };

/** A bounded condition the artifact explicitly permits replay to absorb. */
export interface RecoveryDeclaration {
    id: string;
    condition: string;
    sourceRunId: string;
    maxAttempts: number;
}

/** The destination for one recognized state. */
export interface StageTransition {
    detectorId: string;
    destination: StageDestination;
    recovery?: RecoveryDeclaration;
}

/**
 * One step of the recorded flow.
 *
 * A stage performs at most one action and then reports the state it landed in.
 * `detectors` are the states it listens for, `transitions` decide where each
 * recognized state goes, `extractions` capture what the caller needs from that
 * state, and `otherwise` catches everything unrecognized. `description` is what
 * a reviewer reads to judge whether the stage does what its name claims.
 */
export interface CapabilityStage {
    id: string;
    description: string;
    risk: ActionRisk;
    action?: SurfaceAction;
    detectors: readonly StateDetector[];
    transitions: readonly StageTransition[];
    otherwise: StageDestination;
    extractions: readonly ExtractionSpec[];
}

/**
 * What a caller must supply and what it receives.
 *
 * This is the agent-facing surface of the artifact. `successCondition` states
 * the goal in words so a reviewer can judge whether the recorded flow actually
 * achieves what the capability claims, independently of the steps it takes.
 */
export interface CapabilityContract {
    goal: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    successCondition: string;
}

/**
 * Which runs produced and validated this artifact.
 *
 * `discoveryRunId` is the run that proved the flow works. `validatedRunIds` is
 * reserved for replays that confirm it afterwards, which is the difference
 * between a draft recorded once and a capability worth trusting unattended.
 * Only successful replays whose terminal and persisted state were checked
 * belong in this list.
 */
export interface ArtifactProvenance {
    discoveryRunId: string;
    createdAt: string;
    evidenceRunIds?: readonly string[];
    validatedRunIds?: readonly string[];
}

/** A complete, reviewable, replayable capability. */
export interface CapabilityArtifact {
    schemaVersion: string;
    capabilityVersion: string;
    id: string;
    title: string;
    targetProfile: string;
    contract: CapabilityContract;
    entryStageId: string;
    stages: readonly CapabilityStage[];
    policy: PolicyConfiguration;
    provenance: ArtifactProvenance;
}

/**
 * Resolve a stage's transition for an observed state.
 *
 * A null detector ID means nothing was recognized, which has no transition.
 * Duplicate transitions for one detector are rejected rather than ordered: with
 * two declarations either choice would be arbitrary, and the artifact is meant
 * to be the authority on what happens next.
 */
export function selectTransition(
    stage: CapabilityStage,
    detectorId: string | null,
): StageTransition | undefined {
    if (detectorId === null) return undefined;

    const matches = stage.transitions.filter(
        (transition) => transition.detectorId === detectorId,
    );

    if (matches.length > 1) {
        throw new Error(
            `Stage ${stage.id} has multiple transitions for detector ${detectorId}`,
        );
    }

    return matches[0];
}

/** Resolve a stage's next step for an observed state. */
export function selectDestination(
    stage: CapabilityStage,
    detectorId: string | null,
): StageDestination {
    return selectTransition(stage, detectorId)?.destination ?? stage.otherwise;
}
