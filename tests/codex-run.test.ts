import assert from "node:assert/strict";
import test from "node:test";

import {
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
