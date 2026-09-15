import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthorPrompt } from "../src/authoring/author-prompt.js";

const prompt = buildAuthorPrompt({
    goal: "Look up a Dolibarr third party by exact name.",
    target: "dolibarr",
    fixtureId: "dolibarr/demo-install-smoke",
    lane: "lane-7",
    origin: "http://127.0.0.1:8106",
    maxRuns: 3,
    maxActionsPerRun: 45,
});

test("names the skill by path instead of restating the procedure", () => {
    assert.match(prompt, /skills\/capability-author\/SKILL\.md/);
    assert.match(prompt, /follow it end to end/);
});

test("carries the goal, target, fixture, and lane", () => {
    assert.match(prompt, /Look up a Dolibarr third party by exact name\./);
    assert.match(prompt, /dolibarr\/demo-install-smoke/);
    assert.match(prompt, /lane-7/);
});

test("tells the model which origin this lane answers on", () => {
    // A lane runs on its own port, so a session started without this origin
    // would be refused by the very allowlist the session enforces.
    assert.match(prompt, /http:\/\/127\.0\.0\.1:8106/);
    assert.match(prompt, /--origin http:\/\/127\.0\.0\.1:8106/);
});

test("restates the caps so a model cannot infer its own limits", () => {
    assert.match(prompt, /At most 3 recorded runs in total\./);
    assert.match(prompt, /At most 45 browser actions in any one run\./);
});

test("makes the session CLI the only permitted browser mechanism", () => {
    assert.match(prompt, /`scripts\/session` is the only permitted way/);
    assert.match(prompt, /Do not use any browser or computer-use tooling/);
    // The prompt is line-wrapped, so match the instruction, not its wrapping.
    assert.match(
        prompt,
        /rather\s+than\s+falling back to another browser mechanism/,
    );
});

test("forbids the operations the harness reserves for the operator", () => {
    assert.match(
        prompt,
        /Do not run `scripts\/target fresh`, `snapshot`, or `destroy`/,
    );
    assert.match(prompt, /Do not commit\./);
    assert.match(prompt, /Do not modify anything under `evidence\/`/);
});

test("requires the corpus loop rather than a single run", () => {
    assert.match(prompt, /at least two successful runs/);
    assert.match(prompt, /Never encode a branch you did not observe/);
});

test("keeps credentials out of the recorded run", () => {
    assert.match(prompt, /Never write a credential into an event ledger/);
    assert.doesNotMatch(prompt, /FIXTURE_PASSWORD/);
});
