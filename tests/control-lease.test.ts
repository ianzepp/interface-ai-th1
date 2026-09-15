import assert from "node:assert/strict";
import test from "node:test";

import { ControlLease } from "../src/intervention/control-lease.js";

test("transfers control to a human and back to automation", () => {
    const lease = new ControlLease();

    assert.deepEqual(lease.transfer("automation", "human"), {
        controller: "human",
        epoch: 1,
    });
    assert.deepEqual(lease.transfer("human", "automation"), {
        controller: "automation",
        epoch: 2,
    });
});

test("rejects a transfer from a stale owner", () => {
    const lease = new ControlLease();

    assert.throws(
        () => lease.transfer("human", "automation"),
        /Control is owned by automation/,
    );
});
