import type { SurfaceDriver } from "../surfaces/surface-driver.js";
import type { ArtifactPolicy } from "./policy.js";
import type { RunResult } from "./result.js";
import type { CapabilityArtifact } from "./state-machine.js";

export interface CapabilityInvocation {
  capabilityId: string;
  inputs: Record<string, unknown>;
}

export class DeterministicEngine {
  public constructor(
    private readonly driver: SurfaceDriver,
    private readonly policy: ArtifactPolicy,
  ) {}

  public async run(
    _artifact: CapabilityArtifact,
    _invocation: CapabilityInvocation,
  ): Promise<RunResult> {
    void this.driver;
    void this.policy;
    throw new Error("DeterministicEngine.run is not implemented");
  }
}
