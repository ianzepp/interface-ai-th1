import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PlaywrightTestRunCapture,
  type TraceController,
  type TraceStartOptions,
  type TraceStopOptions,
} from "../src/authoring/playwright-run-capture.js";
import { FileTestRunRecorder } from "../src/authoring/run-recorder.js";

class FakeTraceController implements TraceController {
  public startOptions?: TraceStartOptions;
  public stopOptions?: TraceStopOptions;

  public start(options: TraceStartOptions): Promise<void> {
    this.startOptions = options;
    return Promise.resolve();
  }

  public async stop(options: TraceStopOptions): Promise<void> {
    this.stopOptions = options;
    await writeFile(options.path, "fake Playwright trace", "utf8");
  }
}

test("saves one Playwright trace inside the finalized run", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );

  const recorder = await FileTestRunRecorder.start({
    rootDirectory,
    runId: "run-with-trace",
    goal: "Find an account",
    situation: "Baseline fixture",
    targetProfile: "ledgersmb",
    targetVersion: "1.13",
    fixtureId: "baseline-v1",
  });
  const tracing = new FakeTraceController();
  const capture = await PlaywrightTestRunCapture.start(tracing, recorder);

  await capture.finish({
    status: "satisfied",
    summary: "The account was found.",
    checkpoint: "account-visible",
  });

  assert.deepEqual(tracing.startOptions, {
    screenshots: true,
    snapshots: true,
    sources: false,
    title: recorder.directory,
  });
  assert.equal(tracing.stopOptions?.path, recorder.tracePath);
  assert.equal(
    await readFile(recorder.tracePath, "utf8"),
    "fake Playwright trace",
  );
});

test("finalizes the run as an error when trace persistence fails", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );

  const recorder = await FileTestRunRecorder.start({
    rootDirectory,
    runId: "failed-trace",
    goal: "Find an account",
    situation: "Trace storage is unavailable",
    targetProfile: "ledgersmb",
    targetVersion: "1.13",
    fixtureId: "baseline-v1",
  });
  const tracing: TraceController = {
    start: () => Promise.resolve(),
    stop: () => Promise.reject(new Error("disk unavailable")),
  };
  const capture = await PlaywrightTestRunCapture.start(tracing, recorder);

  await assert.rejects(
    capture.finish({
      status: "satisfied",
      summary: "The account was found.",
      checkpoint: "account-visible",
    }),
    /disk unavailable/,
  );

  const manifest = await readFile(recorder.manifestPath, "utf8");
  const readme = await readFile(recorder.readmePath, "utf8");
  assert.match(manifest, /"code": "trace-stop-failed"/);
  assert.match(readme, /Status: `error`/);
  assert.match(readme, /disk unavailable/);
});
