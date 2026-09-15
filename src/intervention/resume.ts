import type { Observation } from "../surfaces/surface-driver.js";

export interface ResumeCheckpoint {
  expectedState: string;
  observation: Observation;
}

export type ResumeDecision =
  | { type: "resume"; stageId: string }
  | { type: "complete" }
  | { type: "reject"; reason: string };

export function evaluateResume(
  _checkpoint: ResumeCheckpoint,
): Promise<ResumeDecision> {
  return Promise.reject(new Error("evaluateResume is not implemented"));
}
