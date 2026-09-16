import { createHash } from "node:crypto";

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
 *
 * Decisions carry a receipt because provenance has to be checkable, not
 * asserted. The harness computes each receipt from what it observed — the prior
 * observation event, the command it received, and the launcher-sealed session
 * nonce — so a controller cannot author its own attestation.
 */

/**
 * Harness-computed binding of one model decision to the observation it followed.
 *
 * `sequence` and `receiptHash` are stamped by the recorder when the receipt is
 * appended, which is what makes the receipt chain append-only.
 */
export interface DecisionReceipt {
    /** Nonce from the launcher-sealed producer record for this session. */
    sessionNonce: string;
    /** Ledger position of the observation this decision was bound to. */
    priorObservationSequence: number | null;
    /** Chain hash of that observation event. */
    priorObservationHash: string | null;
    /** sha256 over the command the harness received for this decision. */
    commandHash: string;
    /** Stamped by the recorder: position in the append-only receipt chain. */
    sequence: number;
    /** Stamped by the recorder: chain hash sealing this receipt. */
    receiptHash: string;
}

/** Where one appended event sits in the ledger's hash chain. */
export interface EventIdentity {
    sequence: number;
    hash: string;
}

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
          receipt: DecisionReceipt;
      }
    | {
          type: "decision-rejected";
          recordedAt: string;
          action: SurfaceAction;
          risk: ActionRisk;
          rationale: string;
          reason: string;
          receipt: DecisionReceipt;
      }
    | {
          type: "action";
          recordedAt: string;
          action: SurfaceAction;
          result: ActionResult;
          rationale: string;
          /** Present when the executed action was a model decision. */
          receipt?: DecisionReceipt;
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
    append(event: DiscoveryEvent): Promise<EventIdentity>;
    readAll(): Promise<readonly DiscoveryEvent[]>;
}

/** Keeps the ledger in memory; `FileTestRunRecorder` is the durable form. */
export class InMemoryEventRecorder implements EventRecorder {
    readonly #events: DiscoveryEvent[] = [];

    public append(event: DiscoveryEvent): Promise<EventIdentity> {
        const sequence = this.#events.length;
        const hash = createHash("sha256")
            .update(`${String(sequence)}|${JSON.stringify(event)}`)
            .digest("hex");
        this.#events.push(event);
        return Promise.resolve({ sequence, hash });
    }

    public readAll(): Promise<readonly DiscoveryEvent[]> {
        return Promise.resolve([...this.#events]);
    }
}
