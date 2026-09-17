import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    createInteractiveSession,
    parseSessionCommand,
} from "../src/authoring/interactive-playwright-session.js";

test("the handler accepts one action bound to a fresh observation", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-session-"));

    const server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<button>Open</button>");
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    context.after(
        () =>
            new Promise<void>((resolve) =>
                server.close(() => {
                    resolve();
                }),
            ),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("The test server did not bind a TCP port");
    }
    const origin = `http://127.0.0.1:${String(address.port)}`;

    const session = await createInteractiveSession({
        rootDirectory: directory,
        goal: "Open the fixture control.",
        situation: "A local page is ready for a handler test.",
        targetProfile: "handler-test",
        targetVersion: "1",
        fixtureId: "handler-test/fresh",
        producer: {
            kind: "external-llm",
            provider: "test",
            model: "test",
            sessionNonce: "test-session-nonce",
            sealPath: "test-producer-seal",
        },
        policy: {
            allowedOrigins: [origin],
            allowedActionTypes: ["activate"],
            riskyActionMode: "block",
        },
        prepare: async (page) => {
            await page.goto(origin);
        },
    });
    context.after(async () => {
        await session.close();
        await rm(directory, { recursive: true, force: true });
    });

    const observed = await session.handle({ type: "observe" });
    const observationIdentity = (
        observed.record as {
            observationIdentity: { sequence: number; hash: string };
        }
    ).observationIdentity;
    const action = {
        type: "activate" as const,
        target: {
            candidates: [
                { kind: "role" as const, role: "button", name: "Open" },
            ],
            require: "exactly-one" as const,
        },
    };
    const completed = await session.handle({
        type: "act",
        action,
        risk: "safe",
        rationale: "Open the fixture control.",
        observationIdentity,
        controlEpoch: 0,
    });
    assert.equal(
        (completed.record as { type: string }).type,
        "action-completed",
    );

    const reused = await session.handle({
        type: "act",
        action,
        risk: "safe",
        rationale: "Try the same observation again.",
        observationIdentity,
        controlEpoch: 0,
    });
    assert.equal((reused.record as { type: string }).type, "action-rejected");

    const fresh = await session.handle({ type: "observe" });
    const freshIdentity = (
        fresh.record as {
            observationIdentity: { sequence: number; hash: string };
        }
    ).observationIdentity;
    const stale = await session.handle({
        type: "act",
        action,
        risk: "safe",
        rationale: "Try the previous observation.",
        observationIdentity,
        controlEpoch: 0,
    });
    assert.equal((stale.record as { type: string }).type, "action-rejected");

    const missing = await session.handle({
        type: "act",
        action,
        risk: "safe",
        rationale: "Try without an identity.",
        controlEpoch: 0,
    });
    assert.equal((missing.record as { type: string }).type, "action-rejected");
    assert.notDeepEqual(freshIdentity, observationIdentity);
});

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
