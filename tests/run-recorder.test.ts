import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileTestRunRecorder } from "../src/authoring/run-recorder.js";

test("persists a completed test run and its brief README", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );

  const timestamps = ["2026-09-15T14:00:00.000Z", "2026-09-15T14:01:00.000Z"];
  const recorder = await FileTestRunRecorder.start({
    rootDirectory,
    runId: "run-001",
    goal: "Find the customer balance",
    situation: "Known customer in the baseline fixture",
    targetProfile: "ledgersmb",
    targetVersion: "1.13",
    fixtureId: "baseline-v1",
    now: () => timestamps.shift() ?? "2026-09-15T14:01:00.000Z",
  });

  await recorder.append({
    type: "checkpoint",
    recordedAt: "2026-09-15T14:00:30.000Z",
    name: "customer-balance-visible",
    satisfied: true,
  });
  await recorder.finalize({
    status: "satisfied",
    summary: "The requested balance was visible and matched the customer.",
    checkpoint: "customer-balance-visible",
  });

  const manifest = JSON.parse(
    await readFile(join(rootDirectory, "run-001", "run.json"), "utf8"),
  ) as Record<string, unknown>;
  const readme = await readFile(
    join(rootDirectory, "run-001", "README.md"),
    "utf8",
  );
  const events = await readFile(
    join(rootDirectory, "run-001", "events.jsonl"),
    "utf8",
  );

  assert.equal(manifest.status, "satisfied");
  assert.equal(manifest.finishedAt, "2026-09-15T14:01:00.000Z");
  assert.match(readme, /Status: `satisfied`/);
  assert.match(readme, /Known customer in the baseline fixture/);
  assert.match(readme, /The requested balance was visible/);
  assert.equal(events.trim().split("\n").length, 1);
});

test("rejects events after a run is finalized", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );

  const recorder = await FileTestRunRecorder.start({
    rootDirectory,
    runId: "run-002",
    goal: "Exercise a missing customer",
    situation: "Customer ID does not exist",
    targetProfile: "dolibarr",
    targetVersion: "unknown",
    fixtureId: "missing-customer-v1",
  });

  await recorder.finalize({
    status: "error",
    summary: "The target returned no matching customer.",
    code: "customer-not-found",
  });

  const manifest = await readFile(recorder.manifestPath, "utf8");
  const readme = await readFile(recorder.readmePath, "utf8");
  assert.match(manifest, /"status": "error"/);
  assert.match(readme, /Status: `error`/);
  assert.match(readme, /Error code: `customer-not-found`/);

  await assert.rejects(
    recorder.append({
      type: "checkpoint",
      recordedAt: "2026-09-15T14:00:30.000Z",
      name: "late-event",
      satisfied: false,
    }),
    /already finalized/,
  );
});
