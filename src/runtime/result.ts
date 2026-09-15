import type { EvidenceReference } from "../surfaces/surface-driver.js";

/**
 * What a capability invocation reports back.
 *
 * The distinction that carries the most weight is business outcome versus
 * failure. "No such member" is a legitimate answer a caller acts on; a selector
 * that matched nothing is a defect a maintainer debugs. Collapsing the two into
 * one error channel forces every caller to parse prose to tell them apart, and
 * it hides real outages behind answers that look routine.
 *
 * - `success` carries the outputs the caller asked for.
 * - `business-outcome` is a real answer with a code, not an error.
 * - `intervention-required` hands the live session to a person and leaves the
 *   run open, so the same session can continue afterwards.
 * - `failure` is unrecoverable and must carry enough detail to debug it without
 *   reproducing the run.
 */

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
}

export type RunResult<
    Outputs extends Record<string, unknown> = Record<string, unknown>,
> =
    | { type: "success"; outputs: Outputs }
    | {
          type: "business-outcome";
          code: string;
          details: Record<string, unknown>;
      }
    | { type: "intervention-required"; requestId: string; code: string }
    | { type: "failure"; code: string; detail: FailureDetail };
