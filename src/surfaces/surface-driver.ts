export type LocatorCandidate =
  | { kind: "role"; role: string; name: string }
  | { kind: "label"; text: string }
  | { kind: "text"; text: string; exact: boolean }
  | { kind: "css"; selector: string }
  | { kind: "relative"; anchor: string; relation: string };

export interface TargetDescriptor {
  candidates: readonly LocatorCandidate[];
  require: "exactly-one";
}

export type ActionRisk = "safe" | "reversible" | "irreversible";

export type SurfaceAction =
  | { type: "navigate"; url: string }
  | { type: "activate"; target: TargetDescriptor }
  | { type: "fill"; target: TargetDescriptor; value: string }
  | { type: "select"; target: TargetDescriptor; value: string }
  | { type: "press"; key: string };

export interface ObservationRequest {
  includeAccessibility: boolean;
  includeScreenshot: boolean;
}

export interface Observation {
  url: string;
  title: string;
  accessibility?: unknown;
  screenshotPath?: string;
}

export interface TargetResolution {
  candidateIndex: number;
  matchCount: number;
  description: string;
}

export interface ActionResult {
  completed: boolean;
  observation: Observation;
}

export type DetectorSignal =
  | { kind: "url"; pattern: string }
  | { kind: "text"; value: string; exact: boolean }
  | { kind: "role"; role: string; name: string }
  | { kind: "response-status"; status: number }
  | { kind: "timeout" };

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

export interface ExtractionSpec {
  name: string;
  type: "string" | "number" | "money" | "boolean";
  target: TargetDescriptor;
}

export interface EvidenceReference {
  kind: "screenshot" | "trace" | "snapshot" | "log";
  path: string;
  redacted: boolean;
}

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
