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
  assert.deepEqual(selectDestination(stage, "unexpected-dialog"), stage.otherwise);
});
