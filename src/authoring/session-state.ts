import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * How a caller finds the live session it is allowed to drive.
 *
 * The session is a long-lived process while the callers are short-lived ones, so
 * the two need a rendezvous. A state file is that rendezvous: the session writes
 * it once it is accepting commands, and every caller reads it to learn the socket
 * path and which run it is talking to.
 *
 * The path is per-lane and resolved from the environment so the launcher decides
 * which session a caller reaches. That is what makes concurrent authoring
 * possible: each launcher exports its own state path, so an LLM's shell tool
 * resolves to its own session without the caller ever naming a socket. Lanes are
 * otherwise identical, which is why nothing here assumes a single session exists.
 *
 * INVARIANTS
 * - The file is written only after the socket is listening, so its presence means
 *   "reachable" rather than "intended".
 * - A state file naming a dead process is treated as absent, so a crash cannot
 *   leave callers permanently pointed at a socket nobody serves.
 */

/** Everything a caller needs to reach one live session. */
export interface SessionState {
    lane: string;
    socketPath: string;
    runDirectory: string;
    runId: string;
    pid: number;
    target: string;
    targetVersion: string;
    fixtureId: string;
    goal: string;
}

/** Where this lane's session state lives, honoring the launcher's override. */
export function resolveSessionStatePath(lane?: string): string {
    const configured = process.env.CAPABILITY_SESSION_STATE;
    if (configured !== undefined && configured !== "")
        return resolve(configured);
    return join("tmp", "session", `${lane ?? "default"}.json`);
}

export async function writeSessionState(
    statePath: string,
    state: SessionState,
): Promise<void> {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Read the state file, or `null` when no live session is recorded there. */
export async function readSessionState(
    statePath: string,
): Promise<SessionState | null> {
    let source: string;
    try {
        source = await readFile(statePath, "utf8");
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return null;
        throw error;
    }

    const state = parseSessionState(JSON.parse(source));
    if (!isProcessAlive(state.pid)) return null;
    return state;
}

/**
 * Validate a state file before trusting it.
 *
 * The file is written by this code, but it is still a file: it can be truncated
 * by a killed process, left behind by a different version, or edited by hand.
 * Every field a caller depends on is therefore narrowed rather than cast, so an
 * incomplete file fails loudly here instead of producing a confusing failure
 * somewhere downstream.
 */
export function parseSessionState(value: unknown): SessionState {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Session state must be a JSON object");
    }
    const {
        lane,
        socketPath,
        runDirectory,
        runId,
        target,
        targetVersion,
        fixtureId,
        goal,
        pid,
    } = value as Record<string, unknown>;

    if (
        typeof lane !== "string" ||
        typeof socketPath !== "string" ||
        typeof runDirectory !== "string" ||
        typeof runId !== "string" ||
        typeof target !== "string" ||
        typeof targetVersion !== "string" ||
        typeof fixtureId !== "string" ||
        typeof goal !== "string"
    ) {
        throw new Error("Session state is missing a required string field");
    }
    if (typeof pid !== "number") {
        throw new Error("Session state is missing numeric field pid");
    }

    return {
        lane,
        socketPath,
        runDirectory,
        runId,
        target,
        targetVersion,
        fixtureId,
        goal,
        pid,
    };
}

export async function clearSessionState(statePath: string): Promise<void> {
    await rm(statePath, { force: true });
}

/** Signal liveness without killing: signal 0 performs the permission check only. */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
