import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { promoteTestRuns } from "../src/authoring/evidence-promotion.js";
import {
    FileTestRunRecorder,
    type ProducerRecord,
    type TestRunOutcome,
} from "../src/authoring/run-recorder.js";

const SEALED_PRODUCER: ProducerRecord = {
    kind: "external-llm",
    provider: "codex",
    model: "gpt-5.6-sol",
    sessionNonce: "promotion-nonce",
    sealPath: "tmp/discovery/lane-a/producer-seal.json",
};

const NAVIGATE_ACTION = {
    type: "navigate",
    url: "http://127.0.0.1:8080/societe/list.php",
} as const;

test("promotes multiple completed runs without changing the raw runs", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
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

test("promotes a finalized run containing an intervention and control transfer", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const runsDirectory = join(rootDirectory, "runs");
    const evidenceDirectory = join(rootDirectory, "evidence");
    await createHandoffRun(runsDirectory, "handoff-run");

    const promoted = await promoteTestRuns({
        runsDirectory,
        evidenceDirectory,
        runIds: ["handoff-run"],
    });

    assert.deepEqual(
        promoted.map(({ runId, status }) => ({ runId, status })),
        [{ runId: "handoff-run", status: "satisfied" }],
    );
    const events = await readFile(
        join(evidenceDirectory, "runs", "handoff-run", "events.jsonl"),
        "utf8",
    );
    assert.match(events, /"type":"intervention-request"/);
    assert.match(events, /"type":"control-transfer"/);
});

test("refuses to promote a running or already-promoted run", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
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
        producer: SEALED_PRODUCER,
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

test("refuses runs without a launcher-sealed producer record", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const runsDirectory = join(rootDirectory, "runs");
    const evidenceDirectory = join(rootDirectory, "evidence");
    await createCompletedRun(runsDirectory, "missing-producer", {
        status: "satisfied",
        summary: "The balance was visible.",
        checkpoint: "balance-visible",
    });
    await createCompletedRun(runsDirectory, "invalid-producer", {
        status: "satisfied",
        summary: "The balance was visible.",
        checkpoint: "balance-visible",
    });

    const missingManifest = await readManifest(
        join(runsDirectory, "missing-producer", "run.json"),
    );
    delete missingManifest.producer;
    await writeManifest(
        join(runsDirectory, "missing-producer", "run.json"),
        missingManifest,
    );
    const invalidManifest = await readManifest(
        join(runsDirectory, "invalid-producer", "run.json"),
    );
    invalidManifest.producer = { ...SEALED_PRODUCER, sessionNonce: "" };
    await writeManifest(
        join(runsDirectory, "invalid-producer", "run.json"),
        invalidManifest,
    );

    await assert.rejects(
        promoteTestRuns({
            runsDirectory,
            evidenceDirectory,
            runIds: ["missing-producer"],
        }),
        /launcher-sealed producer/,
    );
    await assert.rejects(
        promoteTestRuns({
            runsDirectory,
            evidenceDirectory,
            runIds: ["invalid-producer"],
        }),
        /launcher-sealed producer/,
    );
});

test("refuses a broken, mismatched, or unbound decision receipt chain", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const runsDirectory = join(rootDirectory, "runs");
    const evidenceDirectory = join(rootDirectory, "evidence");
    await createReceiptedRun(runsDirectory, "broken-chain");
    await createReceiptedRun(runsDirectory, "mismatched-receipt");
    await createUnboundRun(runsDirectory, "unbound-receipt");

    const eventsPath = join(runsDirectory, "broken-chain", "events.jsonl");
    const events = (await readFile(eventsPath, "utf8")).trimEnd().split("\n");
    const proposal = JSON.parse(events[1] ?? "{}") as {
        receipt?: Record<string, unknown>;
    };
    proposal.receipt = {
        ...proposal.receipt,
        receiptHash: "f".repeat(64),
    };
    events[1] = JSON.stringify(proposal);
    await writeFile(eventsPath, `${events.join("\n")}\n`, "utf8");

    const mismatchedEventsPath = join(
        runsDirectory,
        "mismatched-receipt",
        "events.jsonl",
    );
    const mismatchedEvents = (await readFile(mismatchedEventsPath, "utf8"))
        .trimEnd()
        .split("\n");
    const mismatchedProposal = JSON.parse(mismatchedEvents[1] ?? "{}") as {
        receipt?: Record<string, unknown>;
    };
    mismatchedProposal.receipt = {
        ...mismatchedProposal.receipt,
        priorObservationHash: "0".repeat(64),
    };
    mismatchedEvents[1] = JSON.stringify(mismatchedProposal);
    await writeFile(
        mismatchedEventsPath,
        `${mismatchedEvents.join("\n")}\n`,
        "utf8",
    );

    await assert.rejects(
        promoteTestRuns({
            runsDirectory,
            evidenceDirectory,
            runIds: ["broken-chain"],
        }),
        /receipt chain is broken/,
    );
    await assert.rejects(
        promoteTestRuns({
            runsDirectory,
            evidenceDirectory,
            runIds: ["mismatched-receipt"],
        }),
        /receipt does not match the earlier observation it claims/,
    );
    await assert.rejects(
        promoteTestRuns({
            runsDirectory,
            evidenceDirectory,
            runIds: ["unbound-receipt"],
        }),
        /earlier observation/,
    );
});

test("refuses a run finalized with a sensitive-evidence outcome", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const runsDirectory = join(rootDirectory, "runs");
    const evidenceDirectory = join(rootDirectory, "evidence");
    await createCompletedRun(runsDirectory, "sensitive-run", {
        status: "error",
        summary: "The trace contained a declared sensitive value.",
        code: "sensitive-evidence-detected",
    });

    await assert.rejects(
        promoteTestRuns({
            runsDirectory,
            evidenceDirectory,
            runIds: ["sensitive-run"],
        }),
        /sensitive-evidence-detected/,
    );
    await assert.rejects(
        readFile(join(evidenceDirectory, "runs", "sensitive-run", "run.json")),
        /ENOENT/,
    );
});

test("preflights a batch before copying any requested run", async (context) => {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "interface-ai-evidence-"),
    );
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

async function createHandoffRun(
    runsDirectory: string,
    runId: string,
): Promise<void> {
    const recorder = await FileTestRunRecorder.start({
        rootDirectory: runsDirectory,
        runId,
        goal: "Recover a customer lookup",
        situation: "The lookup needs a human to continue",
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
        producer: SEALED_PRODUCER,
    });
    await writeFile(recorder.tracePath, `trace for ${runId}`, "utf8");
    await recorder.append({
        type: "intervention-request",
        recordedAt: "2026-09-17T00:00:00.000Z",
        request: {
            id: `intervention:${runId}:0`,
            capabilityId: "dolibarr.third-party-lookup",
            goal: "Recover a customer lookup",
            stageId: "lookup",
            reason: "The target requires a human decision.",
            requestedAt: "2026-09-17T00:00:00.000Z",
            controlEpoch: 0,
            session: {
                runId,
                runDirectory: recorder.directory,
            },
            evidence: [
                {
                    kind: "screenshot",
                    path: "screenshots/intervention.png",
                    redacted: true,
                },
            ],
        },
    });
    await recorder.append({
        type: "control-transfer",
        recordedAt: "2026-09-17T00:00:01.000Z",
        from: { controller: "automation", epoch: 0 },
        to: { controller: "human", epoch: 1 },
        requestId: `intervention:${runId}:0`,
    });
    await recorder.finalize({
        status: "satisfied",
        summary: "The human handoff completed the lookup.",
        checkpoint: "lookup-complete",
    });
}

async function createReceiptedRun(
    runsDirectory: string,
    runId: string,
): Promise<void> {
    const recorder = await FileTestRunRecorder.start({
        rootDirectory: runsDirectory,
        runId,
        goal: "Find a customer balance",
        situation: `Scenario for ${runId}`,
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
        producer: SEALED_PRODUCER,
    });
    await writeFile(recorder.tracePath, `trace for ${runId}`, "utf8");
    const observation = await recorder.append({
        type: "observation",
        recordedAt: "2026-09-16T14:00:00.000Z",
        observation: { url: "http://127.0.0.1:8080/", title: "Home" },
    });
    const receipt = recorder.buildDecisionReceipt({
        action: NAVIGATE_ACTION,
        risk: "safe",
        rationale: "Open the third-party list.",
    });
    if (receipt.priorObservationSequence !== observation.sequence) {
        throw new Error(
            "Test setup did not bind its decision to the observation",
        );
    }
    await recorder.append({
        type: "proposal",
        recordedAt: "2026-09-16T14:00:05.000Z",
        action: NAVIGATE_ACTION,
        risk: "safe",
        rationale: "Open the third-party list.",
        policyDecision: { type: "allow" },
        receipt,
    });
    await recorder.append({
        type: "action",
        recordedAt: "2026-09-16T14:00:06.000Z",
        action: NAVIGATE_ACTION,
        result: {
            completed: true,
            observation: {
                url: NAVIGATE_ACTION.url,
                title: "Third parties",
            },
        },
        rationale: "Open the third-party list.",
        receipt,
    });
    await recorder.finalize({
        status: "satisfied",
        summary: "The list was reachable.",
        checkpoint: "third-party-list-visible",
    });
}

async function createUnboundRun(
    runsDirectory: string,
    runId: string,
): Promise<void> {
    const recorder = await FileTestRunRecorder.start({
        rootDirectory: runsDirectory,
        runId,
        goal: "Find a customer balance",
        situation: `Scenario for ${runId}`,
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
        producer: SEALED_PRODUCER,
    });
    await writeFile(recorder.tracePath, `trace for ${runId}`, "utf8");
    await recorder.append({
        type: "proposal",
        recordedAt: "2026-09-16T14:00:05.000Z",
        action: NAVIGATE_ACTION,
        risk: "safe",
        rationale: "Open the third-party list without observing.",
        policyDecision: { type: "allow" },
        receipt: recorder.buildDecisionReceipt({
            action: NAVIGATE_ACTION,
            risk: "safe",
            rationale: "Open the third-party list without observing.",
        }),
    });
    await recorder.finalize({
        status: "error",
        summary: "The decision was not bound to an observation.",
        code: "unbound-decision",
    });
}

async function readManifest(path: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeManifest(
    path: string,
    manifest: Record<string, unknown>,
): Promise<void> {
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

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
        producer: SEALED_PRODUCER,
    });
    await writeFile(recorder.tracePath, `trace for ${runId}`, "utf8");
    await recorder.finalize(outcome);
}
