import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
    runCodexSessionWithCapture,
    scanHostIdentityLine,
    type HostStreamIdentity,
} from "../src/authoring/codex-run.js";

test("captures the host session from the thread.started event codex emits", () => {
    const identity: HostStreamIdentity = {
        sessionId: null,
        resolvedModel: null,
    };
    scanHostIdentityLine(
        '{"type":"thread.started","thread_id":"01a0ed08-5fb3-7590-9ebe-e6dd06f2cffc"}',
        identity,
    );
    assert.deepEqual(identity, {
        sessionId: "01a0ed08-5fb3-7590-9ebe-e6dd06f2cffc",
        resolvedModel: null,
    });
});

test("keeps the first reported identity and ignores non-JSON output", () => {
    const identity: HostStreamIdentity = {
        sessionId: "first",
        resolvedModel: null,
    };
    scanHostIdentityLine("Shell cwd was reset", identity);
    scanHostIdentityLine(
        '{"type":"thread.started","thread_id":"second"}',
        identity,
    );
    assert.equal(identity.sessionId, "first");
});

test("survives host output that arrives after the timeout sealed the digest", async () => {
    // A stand-in `codex` that answers SIGTERM with one more line of output.
    const binDirectory = await mkdtemp(join(tmpdir(), "codex-run-"));
    const fakeCodex = join(binDirectory, "codex");
    await writeFile(
        fakeCodex,
        "#!/bin/sh\ntrap 'echo late; exit 0' TERM\nwhile :; do sleep 0.05; done\n",
    );
    await chmod(fakeCodex, 0o755);
    try {
        const result = await runCodexSessionWithCapture({
            prompt: "unused",
            workingDirectory: binDirectory,
            outputPath: join(binDirectory, "last-message.md"),
            sandbox: "read-only",
            timeoutMs: 200,
            extraEnv: {
                PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
            },
        });
        assert.equal(result.status, "timeout");
        assert.match(result.capture.streamDigest, /^[0-9a-f]{64}$/);
        // Let the late line arrive. Hashing it into the finalized digest would
        // throw from the stream handler as an uncaught exception.
        await sleep(300);
    } finally {
        await rm(binDirectory, { recursive: true, force: true });
    }
});
