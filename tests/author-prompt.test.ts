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

/** Assert an instruction survived the prompt's line wrapping. */
function mentions(fragment: string): void {
    // Escape first, then open up the whitespace runs. Doing it the other way
    // round escapes the `\s+` this inserts and matches nothing.
    const pattern = fragment
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
    assert.match(
        prompt,
        new RegExp(pattern),
        `the prompt no longer says: ${fragment}`,
    );
}

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
    assert.match(prompt, /budget for the happy path plus the experiments/);
});

test("makes the session CLI the only permitted browser mechanism", () => {
    assert.match(prompt, /`scripts\/session` is the only permitted way/);
    assert.match(prompt, /Do not use any browser or computer-use tooling/);
    mentions("rather than falling back to another browser mechanism");
});

test("keeps the operations the launcher owns out of the model's hands", () => {
    // The repository rule is about live captures, not about never touching the
    // fixture: reset and snapshot are the author's, fresh and destroy are not.
    assert.match(
        prompt,
        /`scripts\/target fresh` and `scripts\/target destroy` are not yours/,
    );
    assert.match(
        prompt,
        /Lane\s+provisioning and teardown belong to the launcher/,
    );
    assert.match(prompt, /Do not commit\./);
    assert.match(prompt, /Do not modify anything under `evidence\/`/);
});

test("hands the model the fixture operations the method needs", () => {
    mentions("This is yours to run, and you should run it yourself");
    mentions("scripts/target snapshot <target> <name>");
    mentions("Snapshot placement is an authoring judgment");
    // A deliberately broken snapshot is the only way to reach a failure that
    // depends on persisted state rather than on the scenario.
    mentions(
        "a deliberately broken state when a failure depends on persisted data",
    );
});

test("states the rule the target script enforces rather than a stricter one", () => {
    mentions("No fixture operation while a session is live");
    assert.match(prompt, /will refuse; finish or stop the session first/);
    // The old prompt forbade snapshot outright, which denied the model a tool the
    // skill's method depends on.
    assert.doesNotMatch(
        prompt,
        /Do not run `scripts\/target fresh`, `snapshot`, or `destroy`/,
    );
});

test("restores the failure-discovery phase the first prompt omitted", () => {
    mentions("Build a small failure matrix");
    mentions("This phase is not optional and is not deferred");
    // The candidate classes the skill names.
    mentions("no matching record or a duplicate");
    mentions("session or authentication expiry");
    mentions("weak, missing, or ambiguous targets");
});

test("requires each experiment to be attributable", () => {
    mentions("Capture each selected experiment as its own run");
    mentions(
        "Change one relevant condition at a time so the divergence stays attributable",
    );
    mentions("reset before each one");
});

test("covers recovery authoring and its limits", () => {
    mentions("Recover inside the run when recovery is bounded and safe");
    mentions("Never infer a recovery edge from an error-only run");
    mentions("never retry a mutating action whose commit status is uncertain");
});

test("requires classification before modelling", () => {
    mentions("Classify before you model");
    mentions(
        "a business outcome, a recoverable condition, an intervention requirement",
    );
    mentions("an authoring or instrumentation defect in your own harness");
});

test("lets the model choose between exploring and isolating", () => {
    mentions(
        "You decide how much to explore inside a run and how much to isolate",
    );
    mentions("Exploring inside one run");
    mentions("One clean condition per run, after a reset");
    // A branch that grounds the artifact still has to be the attributable shape.
    mentions("must be the second shape: reset first, one condition changed");
});

test("still requires a corpus rather than a single run", () => {
    mentions(
        "Capture at least two successful runs from the same reset fixture",
    );
    mentions("Never encode a branch you did not observe");
    mentions("One successful replay is not validation");
});

test("keeps credentials out of the recorded run", () => {
    assert.match(prompt, /Never write a credential into an event ledger/);
    assert.doesNotMatch(prompt, /FIXTURE_PASSWORD/);
});
