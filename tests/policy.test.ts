import assert from "node:assert/strict";
import test from "node:test";

import { executePolicyBoundAction } from "../src/authoring/playwright-run-capture.js";
import { ArtifactPolicy } from "../src/runtime/policy.js";

const policy = new ArtifactPolicy({
    allowedOrigins: ["http://localhost:5762"],
    allowedActionTypes: ["navigate", "activate"],
    riskyActionMode: "require-confirmation",
});

test("blocks action types outside the allowlist", () => {
    assert.equal(
        policy.evaluate({ type: "press", key: "Enter" }).type,
        "block",
    );
});

test("requires confirmation for an allowlisted irreversible action", () => {
    assert.equal(
        policy.evaluate(
            {
                type: "activate",
                target: { candidates: [], require: "exactly-one" },
            },
            "irreversible",
        ).type,
        "require-confirmation",
    );
});

test("refuses a scripted action before its browser operation executes", async () => {
    let executed = false;

    await assert.rejects(
        executePolicyBoundAction(
            policy,
            {
                type: "fill",
                target: { candidates: [], require: "exactly-one" },
                value: "x",
            },
            () => {
                executed = true;
                return Promise.resolve();
            },
        ),
        /Action type fill is not allowlisted/,
    );

    assert.equal(executed, false);
});
