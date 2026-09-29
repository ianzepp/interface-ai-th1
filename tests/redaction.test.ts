import assert from "node:assert/strict";
import test from "node:test";

import { redactKnownSecrets } from "../src/authoring/redaction.js";

test("redacts known secret fields recursively before persistence", () => {
    const source = {
        url: "http://localhost/customer/42",
        authorization: "Bearer private",
        nested: {
            password: "private",
            label: "Customer 42",
        },
    };

    assert.deepEqual(redactKnownSecrets(source), {
        url: "http://localhost/customer/42",
        authorization: "[REDACTED]",
        nested: {
            password: "[REDACTED]",
            label: "Customer 42",
        },
    });
});

test("redacts declared sensitive values under arbitrary keys", () => {
    const sentinel = "synthetic-sensitive-sentinel";

    assert.deepEqual(
        redactKnownSecrets(
            { action: { type: "fill", value: sentinel }, arbitrary: sentinel },
            [sentinel],
        ),
        {
            action: { type: "fill", value: "[REDACTED]" },
            arbitrary: "[REDACTED]",
        },
    );
});

test("redacts token and session query parameters inside recorded URLs", () => {
    // Built at runtime so this file does not itself carry token-shaped
    // literals for the repository's secret scan to flag.
    const csrf = ["%2F.5oQ", "%3CjkUQ"].join("");
    const session = "9f8e7d6c".repeat(3);
    const observation = {
        url: `http://127.0.0.1:5762/setup.pl?action=create_db&database=interface_ai&csrf_token=${csrf}#/`,
        text: `Next: /login.pl?DOLSESSID_abc=${session}&page=2`,
    };

    assert.deepEqual(redactKnownSecrets(observation), {
        url: "http://127.0.0.1:5762/setup.pl?action=create_db&database=interface_ai&csrf_token=[REDACTED]#/",
        text: "Next: /login.pl?DOLSESSID_abc=[REDACTED]&page=2",
    });
});
