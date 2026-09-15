import type { CapabilityArtifact } from "../runtime/state-machine.js";
import type { DiscoveryEvent } from "./event-recorder.js";

/**
 * Turning a recorded run into a capability.
 *
 * STATUS: not implemented. Stage-graph synthesis is deferred by the
 * capability-author skill until a capture corpus is worth compiling.
 *
 * The rule this module exists to enforce: every stage, locator, output, and
 * checkpoint must correspond to something the ledger recorded, or to a change a
 * reviewer made deliberately. Inference is excluded rather than trusted,
 * because an artifact that silently guessed fails later, at replay time, in
 * production, with no model present to explain the guess.
 */

/** Compiles an event ledger into a versioned artifact. */
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
