import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    FileTestRunRecorder,
    type ProducerRecord,
} from "../src/authoring/run-recorder.js";
import type { DiscoveryEvent } from "../src/authoring/event-recorder.js";

const NAVIGATE_ACTION = {
    type: "navigate",
    url: "http://127.0.0.1:8080/societe/list.php",
} as const;

const SEALED_PRODUCER: ProducerRecord = {
    kind: "external-llm",
    provider: "codex",
    model: "gpt-5.6-sol",
    sessionNonce: "nonce-1234",
    sealPath: "tmp/discovery/lane-a/producer-seal.json",
};

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
    assert.deepEqual(manifest.files, {
        readme: "README.md",
        events: "events.jsonl",
        trace: "trace.zip",
        screenshots: "screenshots/",
    });
    assert.match(readme, /Status: `satisfied`/);
    assert.match(readme, /Known customer in the baseline fixture/);
    assert.match(readme, /The requested balance was visible/);
    assert.match(readme, /`screenshots\/`/);
    assert.equal(events.trim().split("\n").length, 1);
});

test("round-trips handoff events through the file ledger", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "run-handoff-events",
        goal: "Recover a customer lookup",
        situation: "The lookup needs a human to continue",
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
    });
    const events = [
        {
            type: "intervention-request",
            recordedAt: "2026-09-17T00:00:00.000Z",
            request: {
                id: "intervention:run-handoff-events:0",
                capabilityId: "dolibarr.third-party-lookup",
                goal: "Recover a customer lookup",
                stageId: "lookup",
                reason: "The target requires a human decision.",
                requestedAt: "2026-09-17T00:00:00.000Z",
                controlEpoch: 0,
                session: {
                    runId: "run-handoff-events",
                    runDirectory: recorder.directory,
                    socketPath: "tmp/session/handoff.sock",
                },
                evidence: [
                    {
                        kind: "screenshot",
                        path: "screenshots/intervention.png",
                        redacted: true,
                    },
                ],
            },
        },
        {
            type: "control-transfer",
            recordedAt: "2026-09-17T00:00:01.000Z",
            from: { controller: "automation", epoch: 0 },
            to: { controller: "human", epoch: 1 },
            requestId: "intervention:run-handoff-events:0",
        },
        {
            type: "resume-validated",
            recordedAt: "2026-09-17T00:00:02.000Z",
            observation: {
                url: "http://127.0.0.1:8080/societe/list.php",
                title: "Third parties",
            },
            decision: { type: "resume", stageId: "lookup-results" },
        },
        {
            type: "resume-rejected",
            recordedAt: "2026-09-17T00:00:03.000Z",
            observation: {
                url: "http://127.0.0.1:8080/societe/list.php",
                title: "Third parties",
            },
            reason: "The fresh observation did not match an admitted checkpoint.",
        },
    ] satisfies readonly DiscoveryEvent[];

    for (const event of events) await recorder.append(event);

    assert.deepEqual(await recorder.readAll(), events);
});

test("rejects malformed handoff events when reading the file ledger", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const malformedEvents = [
        {
            type: "intervention-request",
            recordedAt: "2026-09-17T00:00:00.000Z",
            request: {},
        },
        {
            type: "control-transfer",
            recordedAt: "2026-09-17T00:00:00.000Z",
            from: { controller: "automation" },
            to: { controller: "human", epoch: 1 },
        },
        {
            type: "resume-validated",
            recordedAt: "2026-09-17T00:00:00.000Z",
            observation: { url: "http://127.0.0.1:8080/", title: "Home" },
            decision: { type: "reject", reason: "not admitted" },
        },
        {
            type: "resume-rejected",
            recordedAt: "2026-09-17T00:00:00.000Z",
            observation: { url: "http://127.0.0.1:8080/" },
            reason: "not admitted",
        },
    ];

    for (const [index, event] of malformedEvents.entries()) {
        const recorder = await FileTestRunRecorder.start({
            rootDirectory,
            runId: `run-malformed-handoff-${String(index)}`,
            goal: "Read a handoff ledger",
            situation: "Malformed event fixture",
            targetProfile: "dolibarr",
            targetVersion: "23.0.4",
            fixtureId: "dolibarr/demo-install-smoke",
        });
        await writeFile(recorder.eventsPath, `${JSON.stringify(event)}\n`);
        await assert.rejects(
            recorder.readAll(),
            /Event ledger line must be a recognized discovery event/,
        );
    }
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

test("seals the producer record and receipt chain into the finalized manifest", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );

    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "run-003",
        goal: "Look up a third party by exact name",
        situation: "Authenticated demo fixture",
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
        producer: SEALED_PRODUCER,
    });

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
    assert.equal(receipt.priorObservationSequence, observation.sequence);
    assert.equal(receipt.priorObservationHash, observation.hash);

    // A controller-supplied receipt is overwritten, not trusted.
    const forged = { ...receipt, sequence: 42, receiptHash: "forged" };
    await recorder.append({
        type: "proposal",
        recordedAt: "2026-09-16T14:00:05.000Z",
        action: NAVIGATE_ACTION,
        risk: "safe",
        rationale: "Open the third-party list.",
        policyDecision: { type: "allow" },
        receipt: forged,
    });
    await recorder.finalize({
        status: "satisfied",
        summary: "The list was reachable.",
        checkpoint: "third-party-list-visible",
    });

    const manifest = JSON.parse(
        await readFile(join(rootDirectory, "run-003", "run.json"), "utf8"),
    ) as {
        producer?: ProducerRecord;
        decisionReceipts?: { count: number; digest: string };
    };
    assert.deepEqual(manifest.producer, SEALED_PRODUCER);
    assert.equal(manifest.decisionReceipts?.count, 1);
    assert.match(manifest.decisionReceipts.digest, /^[0-9a-f]{64}$/);

    const events = (
        await readFile(join(rootDirectory, "run-003", "events.jsonl"), "utf8")
    )
        .trimEnd()
        .split("\n");
    const proposal = JSON.parse(events[1] ?? "{}") as {
        receipt: {
            sessionNonce: string;
            sequence: number;
            receiptHash: string;
            commandHash: string;
        };
    };
    assert.equal(proposal.receipt.sessionNonce, "nonce-1234");
    assert.equal(proposal.receipt.sequence, 0);
    assert.match(proposal.receipt.receiptHash, /^[0-9a-f]{64}$/);
    assert.match(proposal.receipt.commandHash, /^[0-9a-f]{64}$/);
});

test("a receipt is unbound until an observation is recorded", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );

    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "run-004",
        goal: "Act only on a seen screen",
        situation: "No observation yet",
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
        producer: SEALED_PRODUCER,
    });

    const unbound = recorder.buildDecisionReceipt({
        action: NAVIGATE_ACTION,
        risk: "safe",
        rationale: "Jump straight to the list.",
    });
    assert.equal(unbound.priorObservationSequence, null);
    assert.equal(unbound.priorObservationHash, null);
});

test("receipt-bearing events are refused without a sealed producer", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );

    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "run-005",
        goal: "No producer was sealed",
        situation: "Unsealed session",
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "dolibarr/demo-install-smoke",
    });
    await recorder.append({
        type: "observation",
        recordedAt: "2026-09-16T14:00:00.000Z",
        observation: { url: "http://127.0.0.1:8080/", title: "Home" },
    });

    // No receipt can be authored at all, so no decision is attestable.
    assert.throws(
        () =>
            recorder.buildDecisionReceipt({
                action: NAVIGATE_ACTION,
                risk: "safe",
                rationale: "Should not be attestable.",
            }),
        /no sealed producer record/,
    );

    // A hand-made receipt does not get past the recorder either.
    await assert.rejects(
        recorder.append({
            type: "proposal",
            recordedAt: "2026-09-16T14:00:05.000Z",
            action: NAVIGATE_ACTION,
            risk: "safe",
            rationale: "Should not be attestable.",
            policyDecision: { type: "allow" },
            receipt: {
                sessionNonce: "attacker-nonce",
                priorObservationSequence: 0,
                priorObservationHash: "0".repeat(64),
                commandHash: "0".repeat(64),
                sequence: 0,
                receiptHash: "0".repeat(64),
            },
        }),
        /no sealed producer record/,
    );
});

test("redacts declared sensitive values from the ledger and summary files", async (context) => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "interface-ai-run-"));
    context.after(async () =>
        rm(rootDirectory, { recursive: true, force: true }),
    );
    const sentinel = "synthetic-sensitive-sentinel";
    const recorder = await FileTestRunRecorder.start({
        rootDirectory,
        runId: "declared-sensitive-value",
        goal: "Fill the account field",
        situation: sentinel,
        targetProfile: "dolibarr",
        targetVersion: "23.0.4",
        fixtureId: "demo",
        sensitiveInputValues: [sentinel],
    });
    await recorder.append({
        type: "action",
        action: {
            type: "fill",
            target: {
                candidates: [{ kind: "label", text: "Any field" }],
                require: "exactly-one",
            },
            value: sentinel,
        },
        result: {
            completed: true,
            observation: { url: "http://127.0.0.1/", title: sentinel },
        },
        rationale: sentinel,
        recordedAt: "2026-09-17T00:00:00.000Z",
    });
    await recorder.finalize({
        status: "error",
        code: "test",
        summary: sentinel,
    });

    for (const path of [
        recorder.eventsPath,
        recorder.manifestPath,
        recorder.readmePath,
    ]) {
        const content = await readFile(path, "utf8");
        assert.doesNotMatch(content, new RegExp(sentinel));
        assert.match(content, /\[REDACTED\]/);
    }
});
