import type { BrowserContext, Page } from "playwright";

import type {
  ActionResult,
  EvidenceReference,
  ExtractionSpec,
  Observation,
  ObservationRequest,
  StateDetector,
  StateMatch,
  SurfaceAction,
  SurfaceDriver,
  TargetDescriptor,
  TargetResolution,
} from "./surface-driver.js";

export class PlaywrightBrowserDriver implements SurfaceDriver {
  public constructor(
    public readonly context: BrowserContext,
    public readonly page: Page,
  ) {}

  public async observe(_request: ObservationRequest): Promise<Observation> {
    return this.notImplemented("observe");
  }

  public async locate(_target: TargetDescriptor): Promise<TargetResolution> {
    return this.notImplemented("locate");
  }

  public async act(_action: SurfaceAction): Promise<ActionResult> {
    return this.notImplemented("act");
  }

  public async waitFor(
    _detectors: readonly StateDetector[],
    _timeoutMs: number,
  ): Promise<StateMatch | null> {
    return this.notImplemented("waitFor");
  }

  public async extract(_spec: ExtractionSpec): Promise<unknown> {
    return this.notImplemented("extract");
  }

  public async captureEvidence(_reason: string): Promise<EvidenceReference> {
    return this.notImplemented("captureEvidence");
  }

  private notImplemented(operation: string): never {
    throw new Error(`PlaywrightBrowserDriver.${operation} is not implemented`);
  }
}
