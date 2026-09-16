import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    SessionControlServer,
    parseControlResponse,
    requestSessionControl,
} from "../src/authoring/session-control.js";
import type { SessionCommand } from "../src/authoring/interactive-playwright-session.js";

test("sends a command to a session and returns the record it emitted", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-control-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));

    const seen: string[] = [];
    const observationIdentity = { sequence: 0, hash: "observation-hash" };
    const server = new SessionControlServer({
        socketPath: join(directory, "session.sock"),
        dispatch: (command) => {
            seen.push(command.type);
            return Promise.resolve({
                type: "observation",
                url: "http://local.test",
                observationIdentity,
            });
        },
    });
    await server.listen();
    context.after(async () => server.close());

    const response = await requestSessionControl(
        join(directory, "session.sock"),
        { type: "observe", screenshot: false },
    );

    assert.deepEqual(seen, ["observe"]);
    assert.equal(response.ok, true);
    assert.deepEqual(response.record, {
        type: "observation",
        url: "http://local.test",
        observationIdentity,
    });
});

test("carries an observation identity through the socket response path", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-control-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));

    const observationIdentity = { sequence: 2, hash: "observation-hash" };
    const seen: SessionCommand[] = [];
    const server = new SessionControlServer({
        socketPath: join(directory, "session.sock"),
        dispatch: (command) => {
            seen.push(command);
            return Promise.resolve(
                command.type === "observe"
                    ? { type: "observation", observationIdentity }
                    : { type: "action-completed" },
            );
        },
    });
    await server.listen();
    context.after(async () => server.close());

    const socketPath = join(directory, "session.sock");
    await requestSessionControl(socketPath, { type: "observe" });
    const action = {
        type: "act" as const,
        action: {
            type: "navigate" as const,
            url: "http://local.test/list",
        },
        risk: "safe" as const,
        rationale: "Open the list.",
        observationIdentity,
    };
    const response = await requestSessionControl(socketPath, action);

    assert.deepEqual(seen[1], action);
    assert.deepEqual(response, {
        ok: true,
        record: { type: "action-completed" },
    });
});

test("serializes concurrent requests so one action never overlaps another", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-control-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));

    let running = 0;
    let peak = 0;
    const server = new SessionControlServer({
        socketPath: join(directory, "session.sock"),
        dispatch: async () => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 20));
            running -= 1;
            return { type: "finished" };
        },
    });
    await server.listen();
    context.after(async () => server.close());

    const socketPath = join(directory, "session.sock");
    await Promise.all([
        requestSessionControl(socketPath, { type: "observe" }),
        requestSessionControl(socketPath, { type: "observe" }),
        requestSessionControl(socketPath, { type: "observe" }),
    ]);

    assert.equal(peak, 1);
});

test("reports an unreachable session instead of waiting for it", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-control-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));

    const response = await requestSessionControl(
        join(directory, "absent.sock"),
        { type: "observe" },
        1_000,
    );

    assert.equal(response.ok, false);
    assert.match(response.error, /No session is listening/);
});

test("reports a slow session as a timeout rather than blocking forever", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-control-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));

    const server = new SessionControlServer({
        socketPath: join(directory, "session.sock"),
        dispatch: () => new Promise(() => undefined),
        timeoutMs: 50,
    });
    await server.listen();
    context.after(async () => server.close());

    const response = await requestSessionControl(
        join(directory, "session.sock"),
        { type: "observe" },
        5_000,
    );

    assert.equal(response.ok, false);
    assert.match(response.error, /did not answer observe/);
});

test("refuses a command the session vocabulary does not accept", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "interface-ai-control-"));
    context.after(async () => rm(directory, { recursive: true, force: true }));

    let dispatched = 0;
    const server = new SessionControlServer({
        socketPath: join(directory, "session.sock"),
        dispatch: () => {
            dispatched += 1;
            return Promise.resolve({});
        },
    });
    await server.listen();
    context.after(async () => server.close());

    const response = await requestSessionControl(
        join(directory, "session.sock"),
        { type: "guess" } as never,
    );

    assert.equal(response.ok, false);
    assert.match(response.error, /Unknown session command type/);
    assert.equal(dispatched, 0);
});

test("validates a response that crosses the process boundary", () => {
    assert.deepEqual(parseControlResponse('{"ok":true,"record":{"a":1}}'), {
        ok: true,
        record: { a: 1 },
    });
    assert.deepEqual(parseControlResponse('{"ok":false,"error":"nope"}'), {
        ok: false,
        error: "nope",
    });
    assert.throws(() => parseControlResponse("[]"), /must be a JSON object/);
    assert.throws(() => parseControlResponse('{"ok":"yes"}'), /must carry ok/);
});
