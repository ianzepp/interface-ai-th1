/**
 * The handoff request a stuck run raises to a person.
 *
 * It carries what an operator needs to take over without reading logs: which
 * capability and goal, which stage stopped, why, and evidence from that moment.
 * It names where the live session can be reached, never the session itself:
 * this record describes the situation, and control of the session transfers
 * separately through the control lease.
 */

import type { EvidenceReference } from "../surfaces/surface-driver.js";

export interface InterventionRequest {
    id: string;
    capabilityId: string;
    goal: string;
    stageId: string;
    reason: string;
    requestedAt: string;
    controlEpoch: number;
    session: {
        runId: string;
        runDirectory: string;
        socketPath?: string;
    };
    evidence: readonly EvidenceReference[];
}

/** Stamp the request at creation so its age is visible to an operator. */
export function createInterventionRequest(
    request: Omit<InterventionRequest, "requestedAt">,
): InterventionRequest {
    return { ...request, requestedAt: new Date().toISOString() };
}
