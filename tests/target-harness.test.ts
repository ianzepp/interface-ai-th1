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
