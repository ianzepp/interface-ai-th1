import type { EvidenceReference } from "../surfaces/surface-driver.js";

export interface InterventionRequest {
  id: string;
  capabilityId: string;
  goal: string;
  stageId: string;
  reason: string;
  requestedAt: string;
  evidence: readonly EvidenceReference[];
}

export function createInterventionRequest(
  request: Omit<InterventionRequest, "requestedAt">,
): InterventionRequest {
  return { ...request, requestedAt: new Date().toISOString() };
}
