import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const targetScript = join(process.cwd(), "scripts", "target");

test("documents the common target lifecycle without requiring Docker", async () => {
    const { stdout } = await execFileAsync(targetScript, ["--help"]);

    assert.match(stdout, /fresh <ledgersmb\|dolibarr>/);
    assert.match(stdout, /snapshot <ledgersmb\|dolibarr> <name>/);
    assert.match(stdout, /reset <ledgersmb\|dolibarr> <name>/);
    assert.match(stdout, /Delete only this target's current volumes/);
});

test("prints the pinned browser origins without requiring Docker", async () => {
    const ledgerSmb = await execFileAsync(targetScript, ["url", "ledgersmb"]);
    const dolibarr = await execFileAsync(targetScript, ["url", "dolibarr"]);

    assert.equal(ledgerSmb.stdout.trim(), "http://127.0.0.1:5762");
    assert.equal(dolibarr.stdout.trim(), "http://127.0.0.1:8080");
});

test("rejects an unknown target before invoking Docker", async () => {
    await assert.rejects(
        execFileAsync(targetScript, ["fresh", "unknown"]),
        /unknown target 'unknown'/,
    );
});

test("rejects unsafe snapshot names before invoking Docker", async () => {
    await assert.rejects(
        execFileAsync(targetScript, ["snapshot", "ledgersmb", "../escape"]),
        /invalid snapshot name/,
    );
});

test("derives an isolated port for a lane", async () => {
    const targetScript = join(process.cwd(), "scripts", "target");
    const defaultPort = await execFileAsync(targetScript, ["port", "dolibarr"]);
    const alpha = await execFileAsync(targetScript, [
        "port",
        "--lane",
        "alpha",
        "dolibarr",
    ]);
    const beta = await execFileAsync(targetScript, [
        "port",
        "--lane",
        "beta",
        "dolibarr",
    ]);

    assert.equal(defaultPort.stdout.trim(), "8080");
    // A lane must not land on the default instance's port, and two lanes must
    // not land on each other's.
    assert.notEqual(alpha.stdout.trim(), "8080");
    assert.notEqual(beta.stdout.trim(), "8080");
    assert.notEqual(alpha.stdout.trim(), beta.stdout.trim());
});

test("applies the lane port to the origin the session will allow", async () => {
    const targetScript = join(process.cwd(), "scripts", "target");
    const { stdout } = await execFileAsync(targetScript, [
        "url",
        "--lane",
        "alpha",
        "dolibarr",
    ]);
    const { stdout: port } = await execFileAsync(targetScript, [
        "port",
        "--lane",
        "alpha",
        "dolibarr",
    ]);

    assert.equal(stdout.trim(), `http://127.0.0.1:${port.trim()}`);
});

test("accepts an explicit lane port and rejects an unusable one", async () => {
    const targetScript = join(process.cwd(), "scripts", "target");
    const { stdout } = await execFileAsync(targetScript, [
        "port",
        "--lane",
        "alpha",
        "--port",
        "9301",
        "dolibarr",
    ]);
    assert.equal(stdout.trim(), "9301");

    await assert.rejects(
        execFileAsync(targetScript, [
            "port",
            "--lane",
            "alpha",
            "--port",
            "not-a-port",
            "dolibarr",
        ]),
        /--port must be a number/,
    );
});

test("rejects a lane name that would break a container or volume name", async () => {
    const targetScript = join(process.cwd(), "scripts", "target");

    // A lane name becomes part of a Compose project, container, and volume name,
    // so anything outside lowercase letters, digits, and hyphens is refused.
    for (const lane of ["Bad_Lane", "-lead", "has.dot", "_under"]) {
        await assert.rejects(
            execFileAsync(targetScript, ["port", "--lane", lane, "dolibarr"]),
            /invalid lane name/,
            `expected ${lane} to be rejected`,
        );
    }

    // A leading digit is fine, matching how snapshot names already work.
    const { stdout } = await execFileAsync(targetScript, [
        "port",
        "--lane",
        "9",
        "dolibarr",
    ]);
    assert.match(stdout.trim(), /^[0-9]+$/);
});
