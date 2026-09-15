import type {
    ActionRisk,
    ActionResult,
    Observation,
    SurfaceAction,
} from "../surfaces/surface-driver.js";
import type { PolicyDecision } from "../runtime/policy.js";

/**
 * The event ledger: the only account of what actually happened.
 *
 * The ledger is where a discovery run records observations, decided actions, and
 * checkpoints. Draft extraction and reviewed artifact authoring consume that
 * stream and reject steps they cannot trace back to it. That grounding rule is
 * what keeps a recorded capability honest, because a run that was not recorded
 * cannot be claimed.
 *
 * Actions carry their rationale because a reviewable artifact needs more than
 * an action list. A reviewer asking "why did it click that" needs the reason
 * that was true at the time, not a plausible reconstruction afterwards.
 */

/** One recorded moment: what was seen, what was done and why, or a checkpoint. */
export type DiscoveryEvent =
    | {
          type: "observation";
          recordedAt: string;
          observation: Observation;
      }
    | {
          type: "proposal";
          recordedAt: string;
          action: SurfaceAction;
          risk: ActionRisk;
          rationale: string;
          policyDecision: PolicyDecision;
      }
    | {
          type: "action";
          recordedAt: string;
          action: SurfaceAction;
          result: ActionResult;
          rationale: string;
      }
    | {
          type: "checkpoint";
          recordedAt: string;
          name: string;
          satisfied: boolean;
      };

/**
 * The ledger's read and write surface.
 *
 * Both operations are asynchronous so a file-backed recorder can honour the
 * same contract as the in-memory one without changing its callers.
 */
export interface EventRecorder {
    append(event: DiscoveryEvent): Promise<void>;
    readAll(): Promise<readonly DiscoveryEvent[]>;
}

/** Keeps the ledger in memory; `FileTestRunRecorder` is the durable form. */
export class InMemoryEventRecorder implements EventRecorder {
    readonly #events: DiscoveryEvent[] = [];

    public append(event: DiscoveryEvent): Promise<void> {
        this.#events.push(event);
        return Promise.resolve();
    }

    public readAll(): Promise<readonly DiscoveryEvent[]> {
        return Promise.resolve([...this.#events]);
    }
}
