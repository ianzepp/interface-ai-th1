import assert from "node:assert/strict";
import test from "node:test";

import { ControlLease } from "../src/intervention/control-lease.js";

test("transfers control to a human and back to automation", () => {
    const lease = new ControlLease();

    assert.deepEqual(lease.transfer("automation", 0, "human"), {
        controller: "human",
        epoch: 1,
    });
    assert.deepEqual(lease.transfer("human", 1, "automation"), {
        controller: "automation",
        epoch: 2,
    });
});

test("rejects a transfer from a stale owner", () => {
    const lease = new ControlLease();

    assert.throws(
        () => lease.transfer("human", 0, "automation"),
        /Control is owned by automation/,
    );
});

test("rejects a stale epoch from the current owner", () => {
    const lease = new ControlLease();

    assert.throws(
        () => lease.transfer("automation", 1, "human"),
        /Control epoch is 0, not 1/,
    );
});

test("refuses automation after the human takeover", () => {
    const lease = new ControlLease();
    lease.transfer("automation", 0, "human");

    assert.throws(() => {
        lease.assertOwnedBy("automation", 0);
    }, /Control is owned by human, not automation/);
});

test("keeps human control when validation rejects a recovery state", () => {
    const lease = new ControlLease();
    lease.transfer("automation", 0, "human");

    lease.assertOwnedBy("human", 1);
    assert.throws(() => {
        lease.assertOwnedBy("automation", 1);
    }, /Control is owned by human, not automation/);
});
