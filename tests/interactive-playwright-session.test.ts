import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionCommand } from "../src/authoring/interactive-playwright-session.js";

test("parses an external controller action command", () => {
    const command = parseSessionCommand(
        JSON.stringify({
            type: "act",
            risk: "safe",
            rationale: "Open the list.",
            action: {
                type: "navigate",
                url: "http://127.0.0.1:8080/societe/list.php",
            },
        }),
    );

    assert.equal(command.type, "act");
});

test("rejects unknown controller commands", () => {
    assert.throws(
        () => parseSessionCommand('{"type":"guess"}'),
        /Unknown session command type/,
    );
});
