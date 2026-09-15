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
        { type: "success", outputs: {} },
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
