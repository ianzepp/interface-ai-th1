import assert from "node:assert/strict";
import test from "node:test";

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
