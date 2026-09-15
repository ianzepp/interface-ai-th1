import type { SurfaceDriver } from "../surfaces/surface-driver.js";
import type { ArtifactPolicy } from "./policy.js";
import type { RunResult } from "./result.js";
import type { CapabilityArtifact } from "./state-machine.js";

/**
 * Replay: the production path, with no model in the decision loop.
 *
 * STATUS: not implemented. The capability-author skill defers replay until the
 * capture corpus is useful, so what exists here is the invocation contract and
 * the result the engine must eventually return.
 *
 * The engine's job, once written, is to walk the artifact's stages, apply the
 * recorded policy to each action, match the resulting state against that
 * stage's detectors, and return a terminal outcome. Determinism is the whole
 * point: the same artifact against the same target version with the same inputs
 * must produce the same result and the same outputs, which is what makes a
 * capability safe to invoke unattended and cheap enough to invoke often.
 *
 * The engine is also where runtime conditions are expected rather than
 * exceptional. An expired session, a validation error, or a "record not found"
 * page is a state to detect and route on, not a crash to propagate.
 */

/** One call: which capability, and the values for its declared inputs. */
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
