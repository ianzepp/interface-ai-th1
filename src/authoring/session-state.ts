/**
 * How a caller finds the live session it is allowed to drive.
 *
 * The session is a long-lived process and its callers are short-lived ones, so
 * a state file is their rendezvous: the session writes it once it is accepting
 * commands, and every caller reads it to learn the socket path and the run it
 * is talking to. The path is per lane and comes from the environment, so each
 * launcher decides which session its caller's shell reaches, and concurrent
 * lanes never share a session.
 *
 * INVARIANTS
 * - The file is written only after the socket is listening, so its presence
 *   means "reachable" rather than "intended".
 * - A state file naming a dead process is treated as absent, so a crash cannot
 *   leave callers permanently pointed at a socket nobody serves.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { isNodeError } from "../common/errors.js";
import type { ObservationIdentity } from "./event-recorder.js";

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
    controller: "automation" | "human";
    controlEpoch: number;
    currentObservationIdentity?: ObservationIdentity | null;
}

/** Where this lane's session state lives, honoring the launcher's override. */
export function resolveSessionStatePath(lane?: string): string {
    const configured = process.env.CAPABILITY_SESSION_STATE;
    if (configured !== undefined && configured !== "")
        return resolve(configured);
    return join("tmp", "session", `${lane ?? "default"}.json`);
}

/** Write the state file, creating its directory. */
export async function writeSessionState(
    statePath: string,
    state: SessionState,
): Promise<void> {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Remove the state file; a missing file is not an error. */
export async function clearSessionState(statePath: string): Promise<void> {
    await rm(statePath, { force: true });
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
 * Validate a state file before trusting it. The file can be truncated by a
 * killed process, left by another version, or edited by hand, so every field a
 * caller depends on is narrowed here rather than failing confusingly later.
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
        controller,
        controlEpoch,
        currentObservationIdentity,
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
        typeof goal !== "string" ||
        (controller !== "automation" && controller !== "human")
    ) {
        throw new Error("Session state is missing a required string field");
    }
    if (typeof pid !== "number" || typeof controlEpoch !== "number") {
        throw new Error("Session state is missing a required numeric field");
    }
    if (!isOptionalObservationIdentity(currentObservationIdentity)) {
        throw new Error(
            "Session state is missing a valid observation identity",
        );
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
        controller,
        controlEpoch,
        ...(currentObservationIdentity === undefined
            ? {}
            : { currentObservationIdentity }),
        pid,
    };
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

/** An observation identity, or `null`/absent when none is recorded. */
function isOptionalObservationIdentity(
    value: unknown,
): value is ObservationIdentity | null | undefined {
    if (value === null || value === undefined) return true;
    if (typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const identity = value as Record<string, unknown>;
    return (
        typeof identity.sequence === "number" &&
        typeof identity.hash === "string"
    );
}
