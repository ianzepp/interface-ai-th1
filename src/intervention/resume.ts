import type { Observation } from "../surfaces/surface-driver.js";

/**
 * Whether a run may continue after a person has intervened.
 *
 * STATUS: not implemented. Recovery validation belongs to the phase after
 * capture, so only the decision shape is defined here.
 *
 * Resume is a decision, not an assumption. The automation has to confirm the
 * session sits in a state the artifact knows how to continue from, rather than
 * picking up mid-flow wherever the operator happened to stop. `reject` exists so
 * a run can end deliberately instead of failing several stages later and
 * blaming the wrong step.
 */

/** The state a run expects to find, and what the session actually shows. */
export interface ResumeCheckpoint {
    expectedState: string;
    observation: Observation;
}

/** The three answers: continue at a stage, finish, or decline to continue. */
export type ResumeDecision =
    | { type: "resume"; stageId: string }
    | { type: "complete" }
    | { type: "reject"; reason: string };

export function evaluateResume(
    _checkpoint: ResumeCheckpoint,
): Promise<ResumeDecision> {
    return Promise.reject(new Error("evaluateResume is not implemented"));
}
