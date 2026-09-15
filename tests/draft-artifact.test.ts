import assert from "node:assert/strict";
import test from "node:test";

import {
    buildDraftArtifact,
    compareArtifacts,
    type TraceSummary,
} from "../src/authoring/draft-artifact.js";
import type { DiscoveryEvent } from "../src/authoring/event-recorder.js";
import type { TestRunManifest } from "../src/authoring/run-recorder.js";

const trace: TraceSummary = {
    playwrightVersion: "1.63.0",
    entryCount: 12,
    actionCount: 3,
    actionMethods: { goto: 1, fill: 1, click: 1 },
    snapshotCount: 3,
    screenshotCount: 3,
};

const manifest: TestRunManifest = {
    runId: "run-1",
    status: "satisfied",
    goal: "Create the record.",
    situation: "A clean fixture.",
    targetProfile: "test",
    targetVersion: "1.0.0",
    fixtureId: "test/clean",
    startedAt: "2026-09-15T00:00:00.000Z",
    finishedAt: "2026-09-15T00:00:03.000Z",
    outcome: {
        status: "satisfied",
        summary: "The record was created.",
        checkpoint: "record-created",
    },
    files: {
        readme: "README.md",
        events: "events.jsonl",
        trace: "trace.zip",
        screenshots: "screenshots/",
    },
};

const events: readonly DiscoveryEvent[] = [
    {
        type: "action",
        recordedAt: "2026-09-15T00:00:00.100Z",
        action: { type: "navigate", url: "http://local.test/start" },
        result: {
            completed: true,
            observation: {
                url: "http://local.test/start",
                title: "Start",
            },
        },
        rationale: "Open the record form.",
    },
    {
        type: "action",
        recordedAt: "2026-09-15T00:00:01.100Z",
        action: {
            type: "fill",
            target: {
                candidates: [{ kind: "css", selector: "#name" }],
                require: "exactly-one",
            },
            value: "Ada",
        },
        result: {
            completed: true,
            observation: {
                url: "http://local.test/start",
                title: "Start",
            },
        },
        rationale: "Enter the record name.",
    },
    {
        type: "action",
        recordedAt: "2026-09-15T00:00:02.100Z",
        action: {
            type: "activate",
            target: {
                candidates: [{ kind: "role", role: "button", name: "Save" }],
                require: "exactly-one",
            },
        },
        result: {
            completed: true,
            observation: {
                url: "http://local.test/records/123",
                title: "Record",
            },
        },
        rationale: "Save the record.",
    },
    {
        type: "checkpoint",
        recordedAt: "2026-09-15T00:00:03.000Z",
        name: "record-created",
        satisfied: true,
    },
];

test("builds a draft from recorded actions and trace metadata", () => {
    const draft = buildDraftArtifact({
        manifest,
        events,
        trace,
        capabilityId: "test.create-record",
    });

    assert.equal(draft.status, "draft");
    assert.equal(draft.artifact.stages.length, 3);
    assert.equal(draft.artifact.contract.inputs.baseUrl, "string");
    const firstStage = draft.artifact.stages[0];
    assert.ok(firstStage?.action);
    assert.equal(firstStage.action.type, "navigate");
    assert.equal(firstStage.action.url, "{{input.baseUrl}}/start");
    assert.deepEqual(draft.artifact.stages[1]?.detectors[0]?.signals, [
        { kind: "role", role: "button", name: "Save" },
    ]);
    assert.deepEqual(draft.source.trace, trace);
    assert.ok(draft.warnings.length > 0);
});

test("compares a draft and current artifact by observed stage order", () => {
    const draft = buildDraftArtifact({
        manifest,
        events,
        trace,
        capabilityId: "test.create-record",
    }).artifact;
    const comparison = compareArtifacts(draft, {
        ...draft,
        id: "test.current-record",
        stages: draft.stages.map((stage, index) =>
            index === 1
                ? {
                      ...stage,
                      risk: "reversible",
                  }
                : stage,
        ),
    });

    assert.equal(comparison.draftStageCount, 3);
    assert.equal(comparison.currentStageCount, 3);
    assert.equal(comparison.exactActionMatches, 3);
    assert.equal(comparison.exactDetectorMatches, 3);
    assert.deepEqual(comparison.stageComparisons[1]?.differentFields, ["risk"]);
});
