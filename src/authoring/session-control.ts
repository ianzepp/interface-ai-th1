import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createServer, connect, type Server, type Socket } from "node:net";

import {
    parseSessionCommand,
    type SessionCommand,
} from "./interactive-playwright-session.js";

/**
 * How a separate process drives a live discovery session.
 *
 * A session holds the one Playwright browser context, the run recorder, the
 * policy gate, and the trace, so it cannot be restarted per action. It therefore
 * needs a control channel that outlives any single caller, and every caller — an
 * operator, a shell script, or an LLM's shell tool — has to reach the same
 * session.
 *
 * The channel is a Unix stream socket carrying one JSON line per request. A
 * request *is* a `SessionCommand`, parsed by the same validator the stdin
 * transport uses, so the two transports cannot diverge in what they accept. There
 * is deliberately no request envelope: a wrapper would add a second parse and a
 * second place for the accepted vocabulary to drift. Only the response needs an
 * envelope, because it has to carry failure as well as a record.
 *
 * Unix sockets were chosen over a FIFO or a polled file because they correlate
 * request to response for free and fail fast when nothing is listening, which is
 * the condition a caller most needs to see immediately.
 *
 * INVARIANTS
 * - One request in flight per session. Requests are serialized through a single
 *   chain, so a control message can never interleave with an action already
 *   running in the browser.
 * - Every request resolves. A dispatch that overruns its budget fails that request
 *   rather than leaving the caller blocked forever.
 * - "Nothing is listening" and "the session refused me" are reported differently,
 *   because the caller's next move depends on which one happened.
 */

/** The session's answer. `record` is the session's own emitted JSON record. */
export type SessionControlResponse =
    { ok: true; record: unknown } | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 120_000;

export interface SessionControlServerOptions {
    socketPath: string;
    /** Apply one command and resolve with the record the session emitted. */
    dispatch(command: SessionCommand): Promise<unknown>;
    timeoutMs?: number;
}

/** Serves one live session's control channel. */
export class SessionControlServer {
    #chain: Promise<unknown> = Promise.resolve();
    #server: Server | undefined;

    public constructor(private readonly options: SessionControlServerOptions) {}

    /** Bind the socket, creating its directory and replacing any stale file. */
    public async listen(): Promise<void> {
        await mkdir(dirname(this.options.socketPath), { recursive: true });
        await rm(this.options.socketPath, { force: true });

        const server = createServer((socket) => {
            this.#serveConnection(socket);
        });
        this.#server = server;

        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(this.options.socketPath, () => {
                server.removeListener("error", reject);
                resolve();
            });
        });
    }

    public async close(): Promise<void> {
        const server = this.#server;
        this.#server = undefined;
        if (server !== undefined) {
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        }
        await rm(this.options.socketPath, { force: true });
        await this.#chain.catch(() => undefined);
    }

    /**
     * Answer one connection, which carries exactly one request.
     *
     * Serialization is by chaining onto the previous request, so an action
     * already running in the browser finishes before the next one starts.
     */
    #serveConnection(socket: Socket): void {
        let buffer = "";
        let delivered = false;

        // Chunks are handled directly rather than through readline, which
        // re-emits an input-stream error as an unhandled interface error.
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            const newline = buffer.indexOf("\n");
            if (newline === -1 || delivered) return;
            delivered = true;

            const line = buffer.slice(0, newline);
            this.#chain = this.#chain
                .catch(() => undefined)
                .then(() => this.#handle(socket, line));
        });

        socket.on("error", () => {
            socket.destroy();
        });
    }

    async #handle(socket: Socket, line: string): Promise<void> {
        let command: SessionCommand;
        try {
            command = parseSessionCommand(line);
        } catch (error) {
            respond(socket, { ok: false, error: describeError(error) });
            return;
        }

        const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let timer: NodeJS.Timeout | undefined;
        const expiry = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                reject(
                    new Error(
                        `Session did not answer ${command.type} within ${String(timeoutMs)}ms`,
                    ),
                );
            }, timeoutMs);
        });

        try {
            const record = await Promise.race([
                this.options.dispatch(command),
                expiry,
            ]);
            respond(socket, { ok: true, record });
        } catch (error) {
            respond(socket, { ok: false, error: describeError(error) });
        } finally {
            clearTimeout(timer);
        }
    }
}

/**
 * Send one command to a session and return its answer.
 *
 * Connection failures become responses rather than thrown errors, because the
 * caller's next move depends on telling "no session is listening" apart from "the
 * session answered and refused".
 */
export function requestSessionControl(
    socketPath: string,
    command: SessionCommand,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SessionControlResponse> {
    return new Promise((resolve) => {
        const socket = connect(socketPath);
        let settled = false;
        let buffer = "";

        const finish = (response: SessionControlResponse): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(response);
        };

        const timer = setTimeout(() => {
            finish({
                ok: false,
                error: `No answer from session within ${String(timeoutMs)}ms`,
            });
        }, timeoutMs);

        socket.setEncoding("utf8");
        socket.on("connect", () => {
            socket.write(`${JSON.stringify(command)}\n`);
        });
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            const newline = buffer.indexOf("\n");
            if (newline === -1) return;
            try {
                finish(parseControlResponse(buffer.slice(0, newline)));
            } catch (error) {
                finish({ ok: false, error: describeError(error) });
            }
        });
        socket.on("error", (error: NodeJS.ErrnoException) => {
            finish({
                ok: false,
                error:
                    error.code === "ENOENT" || error.code === "ECONNREFUSED"
                        ? `No session is listening at ${socketPath}`
                        : describeError(error),
            });
        });
        socket.on("close", () => {
            finish({
                ok: false,
                error: "Session closed the control channel without answering",
            });
        });
    });
}

/** Validate a response line, since it crosses a process boundary. */
export function parseControlResponse(source: string): SessionControlResponse {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Control response must be a JSON object");
    }
    const response = value as Record<string, unknown>;
    if (response.ok === true) return { ok: true, record: response.record };
    if (response.ok === false && typeof response.error === "string") {
        return { ok: false, error: response.error };
    }
    throw new Error("Control response must carry ok and its payload");
}

function respond(socket: Socket, response: SessionControlResponse): void {
    socket.end(`${JSON.stringify(response)}\n`);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
