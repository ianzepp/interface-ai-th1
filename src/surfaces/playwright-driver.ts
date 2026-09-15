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

/**
 * The first `SurfaceDriver`: a browser page driven through Playwright.
 *
 * STATUS: no method is implemented yet. The class exists to fix the adapter
 * shape early, so the surface vocabulary can be reviewed without Playwright's
 * API leaking into it.
 *
 * Once implemented, Playwright supplies locating, waiting, extraction, and
 * tracing, and this adapter translates in both directions between that API and
 * the surface-neutral vocabulary. Nothing in the artifact schema names
 * Playwright, so adding a second surface changes no recorded flow.
 */

export class PlaywrightBrowserDriver implements SurfaceDriver {
  public constructor(
    public readonly context: BrowserContext,
    public readonly page: Page,
  ) {}

  public observe(_request: ObservationRequest): Promise<Observation> {
    return this.notImplemented("observe");
  }

  public locate(_target: TargetDescriptor): Promise<TargetResolution> {
    return this.notImplemented("locate");
  }

  public act(_action: SurfaceAction): Promise<ActionResult> {
    return this.notImplemented("act");
  }

  public waitFor(
    _detectors: readonly StateDetector[],
    _timeoutMs: number,
  ): Promise<StateMatch | null> {
    return this.notImplemented("waitFor");
  }

  public extract(_spec: ExtractionSpec): Promise<unknown> {
    return this.notImplemented("extract");
  }

  public captureEvidence(_reason: string): Promise<EvidenceReference> {
    return this.notImplemented("captureEvidence");
  }

  private notImplemented(operation: string): Promise<never> {
    return Promise.reject(
      new Error(`PlaywrightBrowserDriver.${operation} is not implemented`),
    );
  }
}
