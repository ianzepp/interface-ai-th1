import assert from "node:assert/strict";
import test from "node:test";

import {
    selectDestination,
    type CapabilityStage,
} from "../src/runtime/state-machine.js";

const stage: CapabilityStage = {
    id: "search",
    description: "Search for a customer",
    risk: "safe",
    detectors: [],
    extractions: [],
    transitions: [
        {
            detectorId: "customer-found",
            destination: { type: "stage", stageId: "customer-detail" },
        },
    ],
    otherwise: {
        type: "terminal",
        outcome: { type: "intervention-required", code: "unknown-state" },
    },
};

test("selects the declared transition for a known state", () => {
    assert.deepEqual(selectDestination(stage, "customer-found"), {
        type: "stage",
        stageId: "customer-detail",
    });
});

test("routes an unknown state to the declared fallback", () => {
    assert.deepEqual(
        selectDestination(stage, "unexpected-dialog"),
        stage.otherwise,
    );
});

import { evaluateResume } from "../src/intervention/resume.js";

const observation = {
    url: "http://127.0.0.1:8080/customers",
    title: "Customers",
};

const resumeStage: CapabilityStage = {
    ...stage,
    id: "recovered-search",
    detectors: [
        {
            id: "search-ready",
            description: "The reviewed search form is visible",
            scope: "capability",
            signals: [{ kind: "url", pattern: "/customers$" }],
        },
    ],
    transitions: [
        {
            detectorId: "search-ready",
            destination: { type: "stage", stageId: "fill-name" },
        },
    ],
};

test("resumes only through a detector admitted by the reviewed checkpoint", async () => {
    assert.deepEqual(
        await evaluateResume({
            stage: resumeStage,
            observation,
            detectorId: "search-ready",
        }),
        { type: "resume", stageId: "fill-name" },
    );
});

test("completes when an admitted checkpoint reaches the approved success outcome", async () => {
    const completedStage: CapabilityStage = {
        ...resumeStage,
        id: "completed-search",
        transitions: [
            {
                detectorId: "search-ready",
                destination: { type: "terminal", outcome: { type: "success" } },
            },
        ],
    };

    assert.deepEqual(
        await evaluateResume({
            stage: completedStage,
            observation,
            detectorId: "search-ready",
        }),
        { type: "complete", checkpoint: "completed-search" },
    );
});

test("rejects an observation that matches no admitted resume detector", async () => {
    assert.deepEqual(
        await evaluateResume({
            stage: resumeStage,
            observation,
            detectorId: null,
        }),
        {
            type: "reject",
            reason: "No admitted detector matched resume checkpoint recovered-search.",
        },
    );
});
