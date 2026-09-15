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
    public readonly driver: SurfaceDriver,
    public readonly policy: ArtifactPolicy,
  ) {}

  public run(
    _artifact: CapabilityArtifact,
    _invocation: CapabilityInvocation,
  ): Promise<RunResult> {
    return Promise.reject(
      new Error("DeterministicEngine.run is not implemented"),
    );
  }
}
