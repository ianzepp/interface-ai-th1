import type { FileTestRunRecorder, TestRunOutcome } from "./run-recorder.js";

/**
 * Couples a Playwright trace to a run directory.
 *
 * Trace capture fails in ways that matter. A trace that cannot be started or
 * stopped leaves a run whose evidence would otherwise look complete, with a
 * missing `trace.zip` that a reviewer has to guess about later. Both paths
 * therefore finalize the run as an error carrying a code, so the run's own
 * manifest explains the absence.
 *
 * The recorder is finalized before the failure is rethrown, so the evidence is
 * on disk by the time the caller sees the error.
 */

/** The trace settings this system records with. */
export interface TraceStartOptions {
  screenshots: true;
  snapshots: true;
  sources: false;
  title: string;
}

/** Where the trace is written when the run ends. */
export interface TraceStopOptions {
  path: string;
}

/**
 * The slice of Playwright tracing this system depends on.
 *
 * Narrowed to two methods so the capture logic can be exercised without a
 * browser, and so a different surface technology can supply its own recorder
 * without changing this file.
 */
export interface TraceController {
  start(options: TraceStartOptions): Promise<void>;
  stop(options: TraceStopOptions): Promise<void>;
}

export class PlaywrightTestRunCapture {
  #finished = false;

  private constructor(
    public readonly tracing: TraceController,
    public readonly recorder: FileTestRunRecorder,
  ) {}

  /** Start tracing for a run, or close the run as failed if that is impossible. */
  public static async start(
    tracing: TraceController,
    recorder: FileTestRunRecorder,
  ): Promise<PlaywrightTestRunCapture> {
    try {
      await tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
        title: recorder.directory,
      });
    } catch (error) {
      await recorder.finalize({
        status: "error",
        code: "trace-start-failed",
        summary: describeError(error),
      });
      throw error;
    }

    return new PlaywrightTestRunCapture(tracing, recorder);
  }

  /**
   * Stop tracing and close the run with the outcome it earned.
   *
   * A trace that fails to stop replaces the run's outcome with the capture
   * error, because the artifact a reviewer is meant to inspect is missing.
   */
  public async finish(outcome: TestRunOutcome): Promise<void> {
    if (this.#finished) {
      throw new Error("Playwright test run capture is already finished");
    }
    this.#finished = true;

    try {
      await this.tracing.stop({ path: this.recorder.tracePath });
    } catch (error) {
      await this.recorder.finalize({
        status: "error",
        code: "trace-stop-failed",
        summary: describeError(error),
      });
      throw error;
    }

    await this.recorder.finalize(outcome);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
