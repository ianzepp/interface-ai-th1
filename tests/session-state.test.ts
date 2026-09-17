import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
    clearSessionState,
    parseSessionState,
    readSessionState,
    resolveSessionStatePath,
    writeSessionState,
    type SessionState,
} from "../src/authoring/session-state.js";

const state: SessionState = {
    lane: "lane-a",
    socketPath: "/tmp/lane-a.sock",
    runDirectory: "/tmp/runs/run-a",
    runId: "run-a",
    pid: process.pid,
    target: "dolibarr",
    targetVersion: "23.0.4",
    fixtureId: "dolibarr/demo-install-smoke",
    goal: "Look up a third party.",
    controller: "automation",
    controlEpoch: 0,
    currentObservationIdentity: { sequence: 0, hash: "observation-hash" },
};

test("round-trips a session state file and clears it", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-state-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));
    const statePath = join(directory, "session.json");

    assert.equal(await readSessionState(statePath), null);

    await writeSessionState(statePath, state);
    assert.deepEqual(await readSessionState(statePath), state);

    await clearSessionState(statePath);
    assert.equal(await readSessionState(statePath), null);
});

test("treats a state file naming a dead process as no session", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-state-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));
    const statePath = join(directory, "session.json");
    await writeSessionState(statePath, state);

    // A pid that cannot be alive, so a crashed session cannot leave callers
    // permanently pointed at a socket nobody serves.
    await writeSessionState(statePath, { ...state, pid: 2_147_483_646 });

    assert.equal(await readSessionState(statePath), null);
    assert.match(await readFile(statePath, "utf8"), /2147483646/);
});

test("rejects a state file that is missing a field a caller depends on", () => {
    const { goal: _goal, ...withoutGoal } = state;

    assert.throws(
        () => parseSessionState(withoutGoal),
        /missing a required string field/,
    );
    assert.throws(
        () => parseSessionState({ ...state, pid: "1" }),
        /missing a required numeric field/,
    );
    assert.throws(
        () => parseSessionState({ ...state, controlEpoch: "0" }),
        /missing a required numeric field/,
    );
    assert.throws(
        () => parseSessionState({ ...state, currentObservationIdentity: {} }),
        /missing a valid observation identity/,
    );
    assert.throws(() => parseSessionState([]), /must be a JSON object/);
});

test("resolves the state path from the launcher's override", () => {
    const configured = process.env.CAPABILITY_SESSION_STATE;
    try {
        delete process.env.CAPABILITY_SESSION_STATE;
        assert.equal(
            resolveSessionStatePath("lane-b"),
            join("tmp", "session", "lane-b.json"),
        );

        // The override is what lets concurrent authoring runs stay separate.
        process.env.CAPABILITY_SESSION_STATE = "tmp/discovery/lane-c.json";
        assert.equal(
            resolveSessionStatePath("ignored"),
            resolve("tmp/discovery/lane-c.json"),
        );
    } finally {
        if (configured === undefined)
            delete process.env.CAPABILITY_SESSION_STATE;
        else process.env.CAPABILITY_SESSION_STATE = configured;
    }
});
