import type { CapabilityArtifact } from "../runtime/state-machine.js";
import type { DiscoveryEvent } from "./event-recorder.js";

export interface ArtifactCompiler {
  compile(events: readonly DiscoveryEvent[]): Promise<CapabilityArtifact>;
}

export class GroundedArtifactCompiler implements ArtifactCompiler {
  public compile(
    _events: readonly DiscoveryEvent[],
  ): Promise<CapabilityArtifact> {
    return Promise.reject(
      new Error("GroundedArtifactCompiler.compile is not implemented"),
    );
  }
}
