import type { Observation } from "../surfaces/surface-driver.js";

export interface ResumeCheckpoint {
  expectedState: string;
  observation: Observation;
}

export type ResumeDecision =
  | { type: "resume"; stageId: string }
  | { type: "complete" }
  | { type: "reject"; reason: string };

export async function evaluateResume(
  _checkpoint: ResumeCheckpoint,
): Promise<ResumeDecision> {
  throw new Error("evaluateResume is not implemented");
}
