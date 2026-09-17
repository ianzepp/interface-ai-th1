import assert from "node:assert/strict";
import test from "node:test";

import { parseSessionCommand } from "../src/authoring/interactive-playwright-session.js";

test("parses an external controller action command with its observation identity", () => {
    const observationIdentity = { sequence: 3, hash: "observation-hash" };
    const command = parseSessionCommand(
        JSON.stringify({
            type: "act",
            risk: "safe",
            rationale: "Open the list.",
            action: {
                type: "navigate",
                url: "http://127.0.0.1:8080/societe/list.php",
            },
            observationIdentity,
            controlEpoch: 0,
        }),
    );

    assert.equal(command.type, "act");
    assert.deepEqual(command.observationIdentity, observationIdentity);
});

test("keeps an action without an observation identity parseable for the handler", () => {
    const command = parseSessionCommand(
        JSON.stringify({
            type: "act",
            risk: "safe",
            rationale: "Open the list.",
            action: {
                type: "navigate",
                url: "http://127.0.0.1:8080/societe/list.php",
            },
            controlEpoch: 0,
        }),
    );

    assert.equal(command.type, "act");
    assert.equal(command.observationIdentity, undefined);
});

test("rejects unknown controller commands", () => {
    assert.throws(
        () => parseSessionCommand('{"type":"guess"}'),
        /Unknown session command type/,
    );
});

test("rejects producer metadata on action commands", () => {
    for (const field of [
        "producer",
        "model",
        "receipt",
        "nonce",
        "sessionNonce",
        "sequence",
        "receiptHash",
        "commandHash",
        "priorObservationHash",
        "priorObservationSequence",
    ]) {
        const command = {
            type: "act",
            risk: "safe",
            rationale: "Open the list.",
            action: {
                type: "navigate",
                url: "http://127.0.0.1:8080/societe/list.php",
            },
            [field]: "controller-supplied",
        };
        assert.throws(
            () => parseSessionCommand(JSON.stringify(command)),
            new RegExp(
                `Producer metadata is sealed by the launcher and cannot be sent by a controller: ${field}`,
            ),
            `expected ${field} to be rejected`,
        );
    }
});

test("rejects producer metadata on non-action commands", () => {
    assert.throws(
        () => parseSessionCommand('{"type":"observe","model":"gpt-5.6-sol"}'),
        /cannot be sent by a controller/,
    );
    assert.throws(
        () =>
            parseSessionCommand(
                '{"type":"finish","outcome":{"status":"satisfied","summary":"x","checkpoint":"c"},"receipt":{}}',
            ),
        /cannot be sent by a controller/,
    );
});

test("refuses an action without a bound control lease epoch", () => {
    assert.throws(
        () =>
            parseSessionCommand(
                JSON.stringify({
                    type: "act",
                    risk: "safe",
                    rationale: "Open the list.",
                    action: {
                        type: "navigate",
                        url: "http://127.0.0.1:8080/societe/list.php",
                    },
                }),
            ),
        /Act requires the current control lease epoch/,
    );
});

test("parses human-control commands only with a current lease epoch", () => {
    const action = {
        type: "navigate",
        url: "http://127.0.0.1:8080/societe/list.php",
    };
    const observationIdentity = { sequence: 4, hash: "human-observation" };

    const command = parseSessionCommand(
        JSON.stringify({
            type: "human-act",
            action,
            rationale: "Inspect the matching record.",
            observationIdentity,
            controlEpoch: 1,
        }),
    );
    assert.equal(command.type, "human-act");
    assert.deepEqual(command.observationIdentity, observationIdentity);

    for (const type of [
        "take-control",
        "human-observe",
        "human-act",
        "resume",
        "release-control",
    ]) {
        assert.throws(
            () =>
                parseSessionCommand(
                    JSON.stringify({
                        type,
                        ...(type === "human-act"
                            ? {
                                  action,
                                  rationale: "Inspect the matching record.",
                              }
                            : {}),
                    }),
                ),
            new RegExp(`${type} requires the current control lease epoch`),
        );
    }
});
