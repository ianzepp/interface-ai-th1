import type { EventRecorder } from "./event-recorder.js";
import type { SurfaceDriver } from "../surfaces/surface-driver.js";

/**
 * Discovery: the one place a model is allowed to decide.
 *
 * STATUS: not implemented. The boundary is drawn, a goal contract and hard
 * limits in and an event ledger out, but the observe-decide-act loop itself is
 * still to be written.
 *
 * The asymmetry with replay is deliberate. Discovery may be slow, expensive,
 * and occasionally wrong, because a person reviews its output once. Replay runs
 * unattended for as long as the capability is useful, so it must be neither.
 */

/**
 * What discovery is asked to accomplish, agreed before the run starts.
 *
 * Typed inputs, typed outputs, and a success condition are required up front
 * because a run that ends without a declared checkpoint cannot become a
 * capability: "it looked finished" is not something replay can verify.
 */
export interface GoalContract {
  goal: string;
  targetProfile: string;
  inputs: Record<string, unknown>;
  outputTypes: Record<string, string>;
  successCondition: string;
}

/**
 * The stopping conditions for a run that is not converging.
 *
 * Bounded exploration is a safety property, not only a cost control. A run that
 * reaches its step or time budget has to end rather than keep acting on a live
 * application.
 */
export interface DiscoveryLimits {
  maximumSteps: number;
  timeoutMs: number;
}

/** Runs one discovery attempt against a live surface. */
export interface DiscoveryAgent {
  discover(contract: GoalContract, limits: DiscoveryLimits): Promise<void>;
}

export class ComputerUseDiscoveryAgent implements DiscoveryAgent {
  public constructor(
    public readonly driver: SurfaceDriver,
    public readonly recorder: EventRecorder,
  ) {}

  public discover(
    _contract: GoalContract,
    _limits: DiscoveryLimits,
  ): Promise<void> {
    return Promise.reject(
      new Error("ComputerUseDiscoveryAgent.discover is not implemented"),
    );
  }
}
