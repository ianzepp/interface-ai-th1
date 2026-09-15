/**
 * The surface seam: everything this system perceives, and every way it acts.
 *
 * A capability is recorded against a surface, never against a browser API. The
 * discovery agent and the replay engine both drive one `SurfaceDriver`, and a
 * human handoff takes over that same live session rather than a fresh one. The
 * effect is that a recorded flow outlives the technology that recorded it.
 * Playwright is the first adapter, not the assumption: a legacy web app behind
 * framesets, a desktop accessibility tree, or screenshot-plus-coordinate control
 * can implement this interface without touching the artifact schema or the
 * replay engine.
 *
 * INVARIANTS
 * - Targets are described by ordered candidate locators, never by position.
 * - Resolution requires exactly one match. Zero matches is a missing target and
 *   several is an ambiguous one; neither may fall back to a first match.
 * - Risk is declared by the stage that performs an action and passed to policy
 *   beside it, so a guardrail decision never depends on which surface technology
 *   is underneath.
 */

/**
 * One way of finding a control.
 *
 * The capability-author skill ranks target information from user-visible
 * identity down to raw structure, and treats CSS as a last resort. These kinds
 * cover the user-visible families and structural relationships; the test
 * identifier the skill ranks third has no kind here yet. Ordering is a property
 * of `TargetDescriptor.candidates` rather than of this union, and a candidate
 * has to be recorded from a run that actually resolved it.
 */
export type LocatorCandidate =
  | { kind: "role"; role: string; name: string }
  | { kind: "label"; text: string }
  | { kind: "text"; text: string; exact: boolean }
  | { kind: "css"; selector: string }
  | { kind: "relative"; anchor: string; relation: string };

/**
 * How a stage names the control it acts on.
 *
 * `require` is pinned to a single match on purpose. An ambiguous target is a
 * defect in the recorded capability, and resolving it silently would make
 * replay non-deterministic.
 */
export interface TargetDescriptor {
  candidates: readonly LocatorCandidate[];
  require: "exactly-one";
}

/**
 * How much damage an action can do if the surface is not where we think it is.
 *
 * `safe` and `reversible` actions may proceed unattended; `irreversible` is the
 * only class policy treats specially.
 */
export type ActionRisk = "safe" | "reversible" | "irreversible";

/**
 * The action vocabulary shared by discovery, replay, and policy.
 *
 * Deliberately small: a new capability should need a new target or value rather
 * than a new verb, because expanding this union widens what every allowlist has
 * to consider.
 */
export type SurfaceAction =
  | { type: "navigate"; url: string }
  | { type: "activate"; target: TargetDescriptor }
  | { type: "fill"; target: TargetDescriptor; value: string }
  | { type: "select"; target: TargetDescriptor; value: string }
  | { type: "press"; key: string };

/**
 * Which observation signals a caller wants back.
 *
 * The expensive signals are requested rather than assumed, so a replay that
 * only needs the URL does not pay for a screenshot.
 */
export interface ObservationRequest {
  includeAccessibility: boolean;
  includeScreenshot: boolean;
}

/**
 * What the surface looked like at one point in time.
 *
 * The accessibility tree is the preferred signal because it survives
 * non-semantic legacy markup, and because it is what a human operator perceives
 * from the same screen. `screenshotPath` is an evidence pointer, not an input to
 * a decision.
 */
export interface Observation {
  url: string;
  title: string;
  accessibility?: unknown;
  screenshotPath?: string;
}

/**
 * The outcome of resolving a target, reported so a caller can see which
 * candidate matched and how many elements competed for it.
 */
export interface TargetResolution {
  candidateIndex: number;
  matchCount: number;
  description: string;
}

export interface ActionResult {
  completed: boolean;
  observation: Observation;
}

/**
 * The observable evidence that a state was reached.
 *
 * `timeout` is a signal like any other: failing to see any expected state is
 * itself a recognized condition that a stage can route on.
 */
export type DetectorSignal =
  | { kind: "url"; pattern: string }
  | { kind: "text"; value: string; exact: boolean }
  | { kind: "role"; role: string; name: string }
  | { kind: "response-status"; status: number }
  | { kind: "timeout" };

/**
 * A named state the system can recognize.
 *
 * `scope` is the reuse lever. `runtime` states such as session expiry or a
 * failed load belong to the engine, `target` states belong to one application
 * and version, and `capability` states belong to one recorded flow. Recording
 * capabilities against shared target detectors is what lets a second
 * institution running the same vendor product inherit a flow instead of
 * re-recording it.
 */
export interface StateDetector {
  id: string;
  description: string;
  scope: "runtime" | "target" | "capability";
  signals: readonly DetectorSignal[];
}

export interface StateMatch {
  detectorId: string;
  observedAt: string;
}

/**
 * A declared output: a value the caller receives, not text a model reads.
 *
 * `money` exists as a distinct type because amounts in back-office systems
 * arrive formatted for display, and the caller needs a value rather than a
 * string that has to be re-parsed downstream.
 */
export interface ExtractionSpec {
  name: string;
  type: "string" | "number" | "money" | "boolean";
  target: TargetDescriptor;
}

/**
 * A pointer to something captured during a run.
 *
 * `redacted` records whether the artifact was sanitized before it was stored,
 * so a reviewer can tell "nothing sensitive was present" apart from "nothing
 * sensitive survived".
 */
export interface EvidenceReference {
  kind: "screenshot" | "trace" | "snapshot" | "log";
  path: string;
  redacted: boolean;
}

/**
 * The operations a surface must support to be recordable and replayable.
 *
 * `waitFor` takes detectors rather than a bare timeout so that "ready" means a
 * recognized state instead of an elapsed duration. `extract` and
 * `captureEvidence` are separate because they serve different consumers:
 * outputs are data the caller asked for, while evidence is diagnostic material
 * a human reads when something went wrong.
 */
export interface SurfaceDriver {
  observe(request: ObservationRequest): Promise<Observation>;
  locate(target: TargetDescriptor): Promise<TargetResolution>;
  act(action: SurfaceAction): Promise<ActionResult>;
  waitFor(
    detectors: readonly StateDetector[],
    timeoutMs: number,
  ): Promise<StateMatch | null>;
  extract(spec: ExtractionSpec): Promise<unknown>;
  captureEvidence(reason: string): Promise<EvidenceReference>;
}
