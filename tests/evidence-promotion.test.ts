import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { promoteTestRuns } from "../src/authoring/evidence-promotion.js";
import {
  FileTestRunRecorder,
  type TestRunOutcome,
} from "../src/authoring/run-recorder.js";

test("promotes multiple completed runs without changing the raw runs", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-evidence-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );
  const runsDirectory = join(rootDirectory, "runs");
  const evidenceDirectory = join(rootDirectory, "evidence");

  await createCompletedRun(runsDirectory, "happy-run", {
    status: "satisfied",
    summary: "The balance was visible.",
    checkpoint: "balance-visible",
  });
  await createCompletedRun(runsDirectory, "failed-run", {
    status: "error",
    summary: "The customer did not exist.",
    code: "customer-not-found",
  });

  const promoted = await promoteTestRuns({
    runsDirectory,
    evidenceDirectory,
    runIds: ["happy-run", "failed-run"],
  });

  assert.deepEqual(
    promoted.map(({ runId, status }) => ({ runId, status })),
    [
      { runId: "happy-run", status: "satisfied" },
      { runId: "failed-run", status: "error" },
    ],
  );
  assert.equal(
    await readFile(
      join(evidenceDirectory, "runs", "happy-run", "trace.zip"),
      "utf8",
    ),
    "trace for happy-run",
  );
  assert.match(
    await readFile(
      join(evidenceDirectory, "runs", "failed-run", "README.md"),
      "utf8",
    ),
    /Status: `error`/,
  );
  assert.equal(
    await readFile(join(runsDirectory, "happy-run", "trace.zip"), "utf8"),
    "trace for happy-run",
  );
});

test("refuses to promote a running or already-promoted run", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-evidence-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );
  const runsDirectory = join(rootDirectory, "runs");
  const evidenceDirectory = join(rootDirectory, "evidence");
  const running = await FileTestRunRecorder.start({
    rootDirectory: runsDirectory,
    runId: "running-run",
    goal: "Find a balance",
    situation: "The browser is still active",
    targetProfile: "ledgersmb",
    targetVersion: "1.13",
    fixtureId: "baseline-v1",
  });
  await writeFile(running.tracePath, "incomplete trace", "utf8");

  await assert.rejects(
    promoteTestRuns({
      runsDirectory,
      evidenceDirectory,
      runIds: ["running-run"],
    }),
    /is not finalized/,
  );

  await running.finalize({
    status: "error",
    summary: "The run was stopped.",
    code: "stopped",
  });
  await promoteTestRuns({
    runsDirectory,
    evidenceDirectory,
    runIds: ["running-run"],
  });
  await assert.rejects(
    promoteTestRuns({
      runsDirectory,
      evidenceDirectory,
      runIds: ["running-run"],
    }),
    /already exists/,
  );
});

test("preflights a batch before copying any requested run", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-evidence-"));
  context.after(async () =>
    rm(rootDirectory, { recursive: true, force: true }),
  );
  const runsDirectory = join(rootDirectory, "runs");
  const evidenceDirectory = join(rootDirectory, "evidence");
  await createCompletedRun(runsDirectory, "valid-run", {
    status: "satisfied",
    summary: "The balance was visible.",
    checkpoint: "balance-visible",
  });

  await assert.rejects(
    promoteTestRuns({
      runsDirectory,
      evidenceDirectory,
      runIds: ["valid-run", "missing-run"],
    }),
    /ENOENT/,
  );
  await assert.rejects(
    readFile(join(evidenceDirectory, "runs", "valid-run", "run.json")),
    /ENOENT/,
  );
});

async function createCompletedRun(
  runsDirectory: string,
  runId: string,
  outcome: TestRunOutcome,
): Promise<void> {
  const recorder = await FileTestRunRecorder.start({
    rootDirectory: runsDirectory,
    runId,
    goal: "Find a customer balance",
    situation: `Scenario for ${runId}`,
    targetProfile: "ledgersmb",
    targetVersion: "1.13",
    fixtureId: "baseline-v1",
  });
  await writeFile(recorder.tracePath, `trace for ${runId}`, "utf8");
  await recorder.finalize(outcome);
}
