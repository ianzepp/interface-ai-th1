import type { EventRecorder } from "./event-recorder.js";
import type { SurfaceDriver } from "../surfaces/surface-driver.js";

export interface GoalContract {
  goal: string;
  targetProfile: string;
  inputs: Record<string, unknown>;
  outputTypes: Record<string, string>;
  successCondition: string;
}

export interface DiscoveryLimits {
  maximumSteps: number;
  timeoutMs: number;
}

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
