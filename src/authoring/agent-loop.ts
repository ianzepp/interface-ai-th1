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
    private readonly driver: SurfaceDriver,
    private readonly recorder: EventRecorder,
  ) {}

  public async discover(
    _contract: GoalContract,
    _limits: DiscoveryLimits,
  ): Promise<void> {
    void this.driver;
    void this.recorder;
    throw new Error("ComputerUseDiscoveryAgent.discover is not implemented");
  }
}
