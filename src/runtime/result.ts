/**
 * What a capability invocation reports back.
 *
 * Business outcome and failure are separate variants. "No such member" is an
 * answer a caller acts on; a selector that matched nothing is a defect a
 * maintainer debugs. One error channel would force callers to parse prose to
 * tell them apart, and would hide real outages behind routine answers.
 */

import type { EvidenceReference } from "../surfaces/surface-driver.js";

/** One absorbed, artifact-declared condition during a replay. */
export interface RecoveryReport {
    recoveryId: string;
    condition: string;
    sourceRunId: string;
    detectorId: string;
    attempt: number;
    evidence: readonly EvidenceReference[];
}

/**
 * What a maintainer needs to diagnose a hard failure.
 *
 * `expected` and `observed` are recorded as text rather than structured values
 * because the useful information is the divergence between what the artifact
 * promised and what the surface actually did.
 */
export interface FailureDetail {
    stageId: string;
    expected: string;
    observed: string;
    evidence: readonly EvidenceReference[];
    recovery?: Pick<RecoveryReport, "recoveryId" | "condition">;
}

/**
 * The four ways an invocation ends.
 *
 * - `success` carries the outputs the caller asked for.
 * - `business-outcome` is a real answer with a code, not an error.
 * - `intervention-required` hands the live session to a person and leaves the
 *   run open, so the same session can continue afterwards.
 * - `failure` is unrecoverable and carries enough detail to debug it without
 *   reproducing the run.
 */
export type RunResult<
    Outputs extends Record<string, unknown> = Record<string, unknown>,
> =
    | {
          type: "success";
          outputs: Outputs;
          recoveries: readonly RecoveryReport[];
      }
    | {
          type: "business-outcome";
          code: string;
          details: Record<string, unknown>;
          recoveries: readonly RecoveryReport[];
      }
    | {
          type: "intervention-required";
          requestId: string;
          code: string;
          recoveries: readonly RecoveryReport[];
      }
    | {
          type: "failure";
          code: string;
          detail: FailureDetail;
          recoveries: readonly RecoveryReport[];
      };
