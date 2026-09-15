import type {
  ActionRisk,
  ExtractionSpec,
  StateDetector,
  SurfaceAction,
} from "../surfaces/surface-driver.js";
import type { PolicyConfiguration } from "./policy.js";

export type TerminalOutcome =
  | { type: "success" }
  | { type: "business-outcome"; code: string }
  | { type: "intervention-required"; code: string }
  | { type: "failure"; code: string };

export type StageDestination =
  | { type: "stage"; stageId: string }
  | { type: "terminal"; outcome: TerminalOutcome };

export interface StageTransition {
  detectorId: string;
  destination: StageDestination;
}

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

export interface CapabilityContract {
  goal: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  successCondition: string;
}

export interface ArtifactProvenance {
  discoveryRunId: string;
  createdAt: string;
  validatedRunIds?: readonly string[];
}

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

export function selectDestination(
  stage: CapabilityStage,
  detectorId: string | null,
): StageDestination {
  if (detectorId === null) {
    return stage.otherwise;
  }

  const matches = stage.transitions.filter(
    (transition) => transition.detectorId === detectorId,
  );

  if (matches.length > 1) {
    throw new Error(
      `Stage ${stage.id} has multiple transitions for detector ${detectorId}`,
    );
  }

  return matches[0]?.destination ?? stage.otherwise;
}
