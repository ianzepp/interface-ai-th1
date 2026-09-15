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
