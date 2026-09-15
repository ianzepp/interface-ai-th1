import type { FileTestRunRecorder, TestRunOutcome } from "./run-recorder.js";

export interface TraceStartOptions {
  screenshots: true;
  snapshots: true;
  sources: false;
  title: string;
}

export interface TraceStopOptions {
  path: string;
}

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
