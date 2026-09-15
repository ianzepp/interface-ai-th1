import assert from "node:assert/strict";
import test from "node:test";

import {
    hasFlag,
    parseFlags,
    requireFlag,
    requireNumberFlag,
} from "../src/authoring/flag-args.js";

test("keys are bare, without the dashes the caller typed", () => {
    // This convention is the contract between the CLIs that write flags into a
    // prompt and the CLIs that read them. A reader looking up "--lane" while the
    // parser stored "lane" does not fail; it silently takes the default.
    const flags = parseFlags(["--lane", "lane-7", "--goal", "Do the thing."]);

    assert.equal(flags.get("lane"), "lane-7");
    assert.equal(flags.get("goal"), "Do the thing.");
    assert.equal(flags.get("--lane"), undefined);
});

test("a flag with no value is a switch", () => {
    const flags = parseFlags(["--screenshot", "--lane", "a"]);

    assert.equal(hasFlag(flags, "screenshot"), true);
    assert.equal(flags.get("screenshot"), "true");
    assert.equal(flags.get("lane"), "a");
});

test("a switch does not swallow the flag that follows it", () => {
    const flags = parseFlags(["--exact", "--css", "#name"]);

    assert.equal(flags.get("exact"), "true");
    assert.equal(flags.get("css"), "#name");
});

test("rejects a positional argument rather than ignoring it", () => {
    assert.throws(() => parseFlags(["nonsense"]), /Unexpected argument/);
});

test("reports which required flag is missing", () => {
    const flags = parseFlags(["--goal", "g"]);

    assert.equal(requireFlag(flags, "goal"), "g");
    assert.throws(() => requireFlag(flags, "target"), /--target is required/);
});

test("reads a required flag from a different map when asked", () => {
    const flags = parseFlags(["--goal", "g"]);
    const target = parseFlags(["--role", "button", "--name", "Create"]);

    assert.equal(requireFlag(flags, "role", target), "button");
    assert.throws(() => requireFlag(flags, "role"), /--role is required/);
});

test("rejects a numeric flag that is not a number", () => {
    const flags = parseFlags(["--max-runs", "lots"]);

    assert.equal(requireNumberFlag(flags, "missing", 4), 4);
    assert.equal(
        requireNumberFlag(parseFlags(["--max-runs", "3"]), "max-runs", 4),
        3,
    );
    assert.throws(
        () => requireNumberFlag(flags, "max-runs", 4),
        /must be a number/,
    );
});
