import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicEngine } from "../src/runtime/engine.js";
import { ArtifactPolicy } from "../src/runtime/policy.js";
import type { CapabilityArtifact } from "../src/runtime/state-machine.js";
import type { SurfaceDriver } from "../src/surfaces/surface-driver.js";

const artifact: CapabilityArtifact = {
    schemaVersion: "1",
    capabilityVersion: "1",
    id: "test.flow",
    title: "Test flow",
    targetProfile: "test",
    contract: {
        goal: "Test",
        inputs: {},
        outputs: {},
        successCondition: "Done",
    },
    entryStageId: "open",
    stages: [
        {
            id: "open",
            description: "Open the page",
            risk: "safe",
            action: { type: "navigate", url: "{{input.baseUrl}}/start" },
            detectors: [
                {
                    id: "ready",
                    description: "Ready",
                    scope: "capability",
                    signals: [{ kind: "text", value: "Ready", exact: true }],
                },
            ],
            transitions: [
                {
                    detectorId: "ready",
                    destination: {
                        type: "terminal",
                        outcome: { type: "success" },
                    },
                },
            ],
            otherwise: {
                type: "terminal",
                outcome: { type: "failure", code: "unexpected" },
            },
            extractions: [],
        },
    ],
    policy: {
        allowedOrigins: ["http://local.test"],
        allowedActionTypes: ["navigate"],
        riskyActionMode: "block",
    },
    provenance: {
        discoveryRunId: "run-1",
        createdAt: "2026-09-15T00:00:00.000Z",
    },
};

test("binds invocation inputs and returns success for a recognized state", async () => {
    let navigated = "";
    const driver = fakeDriver({
        act: (action) => {
            if (action.type === "navigate") navigated = action.url;
            return Promise.resolve({
                completed: true,
                observation: { url: navigated, title: "Ready" },
            });
        },
        waitFor: () =>
            Promise.resolve({
                detectorId: "ready",
                observedAt: new Date().toISOString(),
            }),
    });
    const engine = new DeterministicEngine(
        driver,
        new ArtifactPolicy(artifact.policy),
    );
    assert.deepEqual(
        await engine.run(artifact, {
            capabilityId: artifact.id,
            inputs: { baseUrl: "http://local.test" },
        }),
        { type: "success", outputs: {}, recoveries: [] },
    );
    assert.equal(navigated, "http://local.test/start");
});

test("blocks navigation outside the artifact origin", async () => {
    const engine = new DeterministicEngine(
        fakeDriver(),
        new ArtifactPolicy(artifact.policy),
    );
    const result = await engine.run(artifact, {
        capabilityId: artifact.id,
        inputs: { baseUrl: "https://outside.test" },
    });
    assert.equal(result.type, "failure");
    assert.equal(result.code, "origin-blocked");
});

test("binds inputs in action targets and detector targets", async () => {
    const baseStage = artifact.stages[0];
    assert.ok(baseStage);
    const targetArtifact: CapabilityArtifact = {
        ...artifact,
        policy: {
            ...artifact.policy,
            allowedActionTypes: ["activate"],
        },
        stages: [
            {
                ...baseStage,
                action: {
                    type: "activate",
                    target: {
                        candidates: [
                            {
                                kind: "text",
                                text: "{{input.name}}",
                                exact: true,
                            },
                        ],
                        require: "exactly-one",
                    },
                },
                detectors: [
                    {
                        id: "ready",
                        description: "One exact result",
                        scope: "capability",
                        signals: [
                            {
                                kind: "count",
                                target: {
                                    candidates: [
                                        {
                                            kind: "text",
                                            text: "{{input.name}}",
                                            exact: true,
                                        },
                                    ],
                                    require: "exactly-one",
                                },
                                operator: "equal",
                                value: 1,
                            },
                        ],
                    },
                ],
            },
        ],
    };
    let actionText = "";
    let detectorText = "";
    const driver = fakeDriver({
        act: (action) => {
            if (action.type === "activate") {
                const candidate = action.target.candidates[0];
                if (candidate?.kind === "text") actionText = candidate.text;
            }
            return Promise.resolve({
                completed: true,
                observation: { url: "http://local.test", title: "Ready" },
            });
        },
        waitFor: (detectors) => {
            const signal = detectors[0]?.signals[0];
            if (signal?.kind === "count") {
                const candidate = signal.target.candidates[0];
                if (candidate?.kind === "text") detectorText = candidate.text;
            }
            return Promise.resolve({
                detectorId: "ready",
                observedAt: new Date().toISOString(),
            });
        },
    });

    const result = await new DeterministicEngine(
        driver,
        new ArtifactPolicy(targetArtifact.policy),
    ).run(targetArtifact, {
        capabilityId: targetArtifact.id,
        inputs: { name: "Book Keeping Company" },
    });

    assert.equal(result.type, "success");
    assert.equal(actionText, "Book Keeping Company");
    assert.equal(detectorText, "Book Keeping Company");
});

function fakeDriver(overrides: Partial<SurfaceDriver> = {}): SurfaceDriver {
    return {
        observe: () =>
            Promise.resolve({ url: "http://local.test", title: "Test" }),
        locate: () =>
            Promise.resolve({
                candidateIndex: 0,
                matchCount: 1,
                description: "test",
            }),
        act: () =>
            Promise.resolve({
                completed: true,
                observation: { url: "http://local.test", title: "Test" },
            }),
        waitFor: () => Promise.resolve(null),
        extract: () => Promise.resolve(undefined),
        captureEvidence: () =>
            Promise.resolve({
                kind: "screenshot",
                path: "failure.png",
                redacted: false,
            }),
        ...overrides,
    };
}

test("reports declared recoveries and stops before an exhausted recovery action", async () => {
    const initialStage = artifact.stages[0];
    assert.ok(initialStage);
    const recoveryArtifact: CapabilityArtifact = {
        ...artifact,
        stages: [
            {
                ...initialStage,
                detectors: [
                    {
                        id: "interstitial",
                        description: "Password expiry interstitial",
                        scope: "capability",
                        signals: [
                            {
                                kind: "text",
                                value: "Password expired",
                                exact: true,
                            },
                        ],
                    },
                ],
                transitions: [
                    {
                        detectorId: "interstitial",
                        recovery: {
                            id: "dismiss-password-expiry",
                            condition: "Password expiry interstitial",
                            sourceRunId: "run-password-expiry",
                            maxAttempts: 1,
                        },
                        destination: { type: "stage", stageId: "dismiss" },
                    },
                ],
            },
            {
                id: "dismiss",
                description: "Dismiss the observed interstitial",
                risk: "reversible",
                action: { type: "press", key: "Enter" },
                detectors: [
                    {
                        id: "interstitial-cleared",
                        description: "Return to the initial page",
                        scope: "capability",
                        signals: [
                            { kind: "text", value: "Start", exact: true },
                        ],
                    },
                ],
                transitions: [
                    {
                        detectorId: "interstitial-cleared",
                        destination: { type: "stage", stageId: "open" },
                    },
                ],
                otherwise: {
                    type: "terminal",
                    outcome: { type: "failure", code: "dismiss-failed" },
                },
                extractions: [],
            },
        ],
        policy: {
            ...artifact.policy,
            allowedActionTypes: ["navigate", "press"],
        },
    };
    let pressCount = 0;
    const reports: unknown[] = [];
    const driver = fakeDriver({
        act: (action) => {
            if (action.type === "press") pressCount += 1;
            return Promise.resolve({
                completed: true,
                observation: { url: "http://local.test", title: "Test" },
            });
        },
        waitFor: (detectors) => {
            const detector = detectors[0];
            assert.ok(detector);
            return Promise.resolve({
                detectorId: detector.id,
                observedAt: "2026-09-17T00:00:00.000Z",
            });
        },
    });

    const result = await new DeterministicEngine(
        driver,
        new ArtifactPolicy(recoveryArtifact.policy),
        {
            observer: {
                actionCompleted: () => Promise.resolve(),
                checkpoint: () => Promise.resolve(),
                recoveryOccurred: (report) => {
                    reports.push(report);
                    return Promise.resolve();
                },
            },
        },
    ).run(recoveryArtifact, {
        capabilityId: recoveryArtifact.id,
        inputs: { baseUrl: "http://local.test" },
    });

    assert.equal(result.type, "failure");
    assert.equal(result.code, "recovery-exhausted");
    assert.deepEqual(result.detail.recovery, {
        recoveryId: "dismiss-password-expiry",
        condition: "Password expiry interstitial",
    });
    assert.equal(result.recoveries.length, 1);
    assert.deepEqual(reports, result.recoveries);
    assert.equal(pressCount, 1);
});
