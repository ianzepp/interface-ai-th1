import type { EvidenceReference } from "../surfaces/surface-driver.js";

export interface FailureDetail {
  stageId: string;
  expected: string;
  observed: string;
  evidence: readonly EvidenceReference[];
}

export type RunResult<Outputs extends Record<string, unknown> = Record<string, unknown>> =
  | { type: "success"; outputs: Outputs }
  | { type: "business-outcome"; code: string; details: Record<string, unknown> }
  | { type: "intervention-required"; requestId: string; code: string }
  | { type: "failure"; code: string; detail: FailureDetail };
