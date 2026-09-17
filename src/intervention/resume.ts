import type {
    CapabilityStage,
    StageDestination,
} from "../runtime/state-machine.js";
import { selectDestination } from "../runtime/state-machine.js";
import type { Observation } from "../surfaces/surface-driver.js";

/**
 * Whether a run may continue after a person has intervened.
 *
 * Resume is a decision, not an assumption. Automation verifies a fresh
 * observation against a reviewed checkpoint before it can take the session
 * back from the person.
 */

/** A reviewed artifact stage admitted as a state from which a run can resume. */
export interface ResumeCheckpoint {
    stage: CapabilityStage;
    observation: Observation;
    detectorId: string | null;
}

/** The three answers: continue at a stage, finish, or decline to continue. */
export type ResumeDecision =
    | { type: "resume"; stageId: string }
    | { type: "complete"; checkpoint: string }
    | { type: "reject"; reason: string };

/**
 * Resolve a detector result only when it belongs to the reviewed checkpoint.
 *
 * The browser driver obtains the detector result; this function keeps the
 * artifact routing rule shared with deterministic replay and refuses an
 * unrecognized state rather than selecting a stage by assertion.
 */
export function evaluateResume(
    checkpoint: ResumeCheckpoint,
): Promise<ResumeDecision> {
    if (
        checkpoint.detectorId === null ||
        !checkpoint.stage.detectors.some(
            (detector) => detector.id === checkpoint.detectorId,
        )
    ) {
        return Promise.resolve({
            type: "reject",
            reason: `No admitted detector matched resume checkpoint ${checkpoint.stage.id}.`,
        });
    }

    return Promise.resolve(
        decisionForDestination(
            checkpoint.stage.id,
            selectDestination(checkpoint.stage, checkpoint.detectorId),
        ),
    );
}

function decisionForDestination(
    checkpoint: string,
    destination: StageDestination,
): ResumeDecision {
    if (destination.type === "stage") {
        return { type: "resume", stageId: destination.stageId };
    }
    if (destination.outcome.type === "success") {
        return { type: "complete", checkpoint };
    }
    return {
        type: "reject",
        reason: `Resume checkpoint ${checkpoint} reached non-completing outcome ${destination.outcome.type}.`,
    };
}
