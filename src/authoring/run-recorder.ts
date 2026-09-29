/**
 * The on-disk unit of discovery evidence: one directory per run.
 *
 * A run directory has to be reviewable without the process that produced it, so
 * it carries the run in these files:
 *
 * - `run.json` — goal, situation, target, fixture, producer, and outcome
 * - `events.jsonl` — the sanitized ledger, one event per line
 * - `README.md` — those facts rendered for a person
 * - `trace.zip` — the Playwright trace, when capture completed
 * - `screenshots/` — checkpoint or terminal screenshots, when captured
 *
 * INVARIANTS
 * - Events are redacted on the way in. The ledger is append-only, so redacting
 *   after the fact would mean the secret had already been written.
 * - Appends are serialized through one chain, so concurrent writers cannot
 *   interleave into a torn line in the jsonl file.
 * - A run finalizes exactly once and the manifest is rewritten at that point, so
 *   a crashed process leaves a recognizable `running` run rather than an
 *   unexplained trace file.
 * - Decision receipts are computed here, from what this recorder observed. A
 *   receipt-bearing event is refused without a sealed producer record, so
 *   controller-supplied producer metadata can never reach the ledger or the
 *   manifest.
 * - The recorder and `validateRunAttestation` build the event chain, the
 *   receipt chain, and their genesis values through the same helpers, and the
 *   manifest, ledger, and README bytes are an on-disk contract that committed
 *   evidence depends on.
 */

import { createHash, randomUUID } from "node:crypto";
import {
    appendFile,
    mkdir,
    readFile,
    readdir,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "../common/records.js";
import type { ControlLeaseState } from "../intervention/control-lease.js";
import type { InterventionRequest } from "../intervention/request.js";
import type { ResumeDecision } from "../intervention/resume.js";
import type {
    ActionRisk,
    EvidenceReference,
    Observation,
    SurfaceAction,
} from "../surfaces/surface-driver.js";
import type { CodexRunStatus } from "./codex-run.js";
import type {
    DecisionReceipt,
    EventIdentity,
    EventRecorder,
    RunEvent,
} from "./event-recorder.js";
import { redactKnownSecrets } from "./redaction.js";

const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** What a run needs to identify itself before it starts. */
export interface RunStart {
    rootDirectory: string;
    runId?: string;
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    /** Producer identity, sealed by the launcher that started the session. */
    producer?: ProducerRecord | undefined;
    now?: () => string;
    /** Exact values that must never be persisted in run evidence. */
    sensitiveInputValues?: readonly string[] | undefined;
    /** Reviewed artifact stages that may return automation after a handoff. */
    resumeBinding?: ReviewedResumeBinding | undefined;
}

/** The committed artifact authority for human-handoff resume validation. */
export interface ReviewedResumeBinding {
    artifactId: string;
    checkpoints: readonly {
        stageId: string;
        detectorIds: readonly string[];
    }[];
}

/**
 * Who produced a run's decisions, as the launcher sealed it.
 *
 * Every field comes from a record the launcher wrote before the host ran; the
 * controller cannot supply one, because a free-text identity it can set is
 * forgeable and cannot bind a decision to the observation before it.
 */
export interface ProducerRecord {
    kind: "external-llm" | "human";
    provider: string;
    /** The model the host reported, or null when the host reported no model. */
    model: string | null;
    /** Harness-generated nonce binding decisions to this producer. */
    sessionNonce: string;
    /** Lane-directory path of the launcher-sealed record this came from. */
    sealPath: string;
    /** External hosts attest these values after their captured stream closes. */
    hostSessionId?: string | null;
    streamDigest?: string;
    /** Digest over the host-attested fields folded into this manifest. */
    hostAttestationDigest?: string;
    hostExitStatus?: CodexRunStatus;
    hostExitCode?: number | null;
}

/** What an external host reported once its captured event stream closed. */
export interface HostProducerAttestation {
    sessionNonce: string;
    sessionId: string | null;
    resolvedModel: string | null;
    streamDigest: string;
    exitStatus: CodexRunStatus;
    exitCode: number | null;
}

/**
 * How a run ended.
 *
 * A satisfied run must name the checkpoint that proved it, and an error run
 * must name a code, so failures group by class instead of accumulating as prose
 * that has to be read one at a time.
 */
export type RunOutcome =
    | {
          status: "satisfied";
          summary: string;
          checkpoint: string;
      }
    | {
          status: "error";
          summary: string;
          code: string;
      };

/** The machine-readable index of one run directory. */
export interface RunManifest {
    runId: string;
    status: "running" | RunOutcome["status"];
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    /** The launcher-sealed producer of this run's decisions, when sealed. */
    producer?: ProducerRecord | undefined;
    /** Terminal state of the append-only decision-receipt chain, at finalize. */
    decisionReceipts?: { count: number; digest: string } | undefined;
    /** Reviewed artifact authority configured before this session started. */
    resumeBinding?: ReviewedResumeBinding | undefined;
    startedAt: string;
    finishedAt?: string;
    outcome?: RunOutcome;
    files: {
        readme: "README.md";
        events: "events.jsonl";
        trace: "trace.zip";
        screenshots: "screenshots/";
    };
}

type DecisionEvent = Extract<
    RunEvent,
    { type: "proposal" } | { type: "decision-rejected" }
>;

// --- Recorder ---------------------------------------------------------------

/** The durable event ledger: one run directory, written as the run happens. */
export class FileRunRecorder implements EventRecorder {
    public readonly manifestPath: string;
    public readonly eventsPath: string;
    public readonly readmePath: string;
    public readonly tracePath: string;
    readonly #manifest: RunManifest;
    readonly #producer: ProducerRecord | undefined;
    readonly #now: () => string;
    readonly #sensitiveInputValues: readonly string[];
    #finalized = false;
    #writeQueue: Promise<void> = Promise.resolve();
    #eventChainHash: string;
    #receiptChainHash: string;
    #eventSequence = 0;
    #receiptCount = 0;
    #lastObservation: EventIdentity | null = null;
    /** The sealed receipt of the proposal an executed action must match. */
    #pendingReceipt: DecisionReceipt | null = null;

    private constructor(
        public readonly directory: string,
        manifest: RunManifest,
        now: () => string,
        sensitiveInputValues: readonly string[],
    ) {
        this.manifestPath = join(directory, "run.json");
        this.eventsPath = join(directory, manifest.files.events);
        this.readmePath = join(directory, manifest.files.readme);
        this.tracePath = join(directory, manifest.files.trace);
        this.#manifest = manifest;
        this.#producer = manifest.producer;
        this.#now = now;
        this.#sensitiveInputValues = sensitiveInputValues;
        this.#eventChainHash = eventChainGenesis(
            manifest.runId,
            manifest.startedAt,
        );
        this.#receiptChainHash = receiptChainGenesis(
            manifest.runId,
            manifest.producer?.sessionNonce ?? "unsealed",
        );
    }

    /**
     * Create a run directory and its empty ledger.
     *
     * The non-recursive create and the exclusive ledger write are what make a run
     * directory collision-proof: two runs cannot silently share a directory and
     * interleave their evidence.
     */
    public static async start(options: RunStart): Promise<FileRunRecorder> {
        const now = options.now ?? (() => new Date().toISOString());
        const startedAt = now();
        const runId = options.runId ?? createRunId(startedAt);
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new Error(`Invalid run ID: ${runId}`);
        }

        const directory = join(options.rootDirectory, runId);
        await mkdir(options.rootDirectory, { recursive: true });
        await mkdir(directory);

        const manifest: RunManifest = {
            runId,
            status: "running",
            goal: options.goal,
            situation: options.situation,
            targetProfile: options.targetProfile,
            targetVersion: options.targetVersion,
            fixtureId: options.fixtureId,
            producer: options.producer,
            ...(options.resumeBinding === undefined
                ? {}
                : { resumeBinding: options.resumeBinding }),
            startedAt,
            files: {
                readme: "README.md",
                events: "events.jsonl",
                trace: "trace.zip",
                screenshots: "screenshots/",
            },
        };
        const recorder = new FileRunRecorder(
            directory,
            manifest,
            now,
            options.sensitiveInputValues ?? [],
        );

        await writeFile(recorder.eventsPath, "", { flag: "wx" });
        await recorder.#writeSummaryFiles();
        return recorder;
    }

    /**
     * Record one event, redacted, in arrival order.
     *
     * Late writes are rejected so a stray event cannot land in a closed run and
     * leave its evidence disagreeing with its own manifest. Receipt-bearing
     * decisions have their receipt sealed here — sequence and chain hash are
     * always computed by this recorder, overwriting whatever a caller supplied.
     */
    public append(event: RunEvent): Promise<EventIdentity> {
        if (this.#finalized) {
            return Promise.reject(
                new Error(`Run ${this.#manifest.runId} is already finalized`),
            );
        }

        const appended = this.#writeQueue.then(async () => {
            const sealed = this.#sealEvent(event);
            await appendFile(
                this.eventsPath,
                `${JSON.stringify(sealed.event)}\n`,
            );
            return { sequence: sealed.sequence, hash: sealed.hash };
        });
        // The caller sees the rejection; the queue itself proceeds, so one
        // refused event cannot poison the appends behind it or sit unhandled.
        this.#writeQueue = appended.then(
            () => undefined,
            () => undefined,
        );
        return appended;
    }

    /**
     * Bind one proposed command to the observation it followed.
     *
     * This is the only place a decision receipt is authored: the command hash
     * covers exactly what the harness received, and the prior observation is
     * whatever this ledger last recorded. An unbound decision is still
     * receipt-carrying — the null binding is what a review reads as "acted
     * without looking".
     */
    public buildDecisionReceipt(command: {
        action: SurfaceAction;
        risk: ActionRisk;
        rationale: string;
    }): DecisionReceipt {
        if (this.#producer === undefined) {
            throw new Error(
                `Run ${this.#manifest.runId} has no sealed producer record; decisions cannot be attested`,
            );
        }
        const prior = this.#lastObservation;
        return {
            sessionNonce: this.#producer.sessionNonce,
            priorObservationSequence: prior?.sequence ?? null,
            priorObservationHash: prior?.hash ?? null,
            commandHash: hashDecisionCommand(command),
            sequence: -1,
            receiptHash: "",
        };
    }

    public async readAll(): Promise<readonly RunEvent[]> {
        await this.#writeQueue;
        return parseEventLedger(await readFile(this.eventsPath, "utf8"));
    }

    /**
     * Close the run and write its manifest and README.
     *
     * Queued appends are awaited first, so the summary never describes a run whose
     * last events are still in flight.
     */
    public async finalize(outcome: RunOutcome): Promise<void> {
        if (this.#finalized) {
            throw new Error(`Run ${this.#manifest.runId} is already finalized`);
        }
        this.#finalized = true;
        await this.#writeQueue;

        this.#manifest.status = outcome.status;
        this.#manifest.finishedAt = this.#now();
        this.#manifest.outcome = outcome;
        if (this.#producer !== undefined) {
            this.#manifest.decisionReceipts = {
                count: this.#receiptCount,
                digest: this.#receiptChainHash,
            };
        }
        await this.#writeSummaryFiles();
    }

    /**
     * Redact an event and advance the chains over it.
     *
     * Runs inside the write queue, so chain state advances in arrival order.
     */
    #sealEvent(event: RunEvent): {
        sequence: number;
        hash: string;
        event: RunEvent;
    } {
        const clean = redactKnownSecrets(
            event,
            this.#sensitiveInputValues,
        ) as RunEvent;
        this.#bindReceipt(clean);
        const sequence = this.#eventSequence;
        const hash = hashEvent(this.#eventChainHash, sequence, clean);
        this.#eventChainHash = hash;
        this.#eventSequence = sequence + 1;
        if (clean.type === "observation") {
            this.#lastObservation = { sequence, hash };
        }
        return { sequence, hash, event: clean };
    }

    /**
     * Seal a decision's receipt, or check an executed action's receipt against
     * the proposal it claims. Rewrites `event.receipt` in place.
     */
    #bindReceipt(event: RunEvent): void {
        switch (event.type) {
            case "proposal":
                event.receipt = this.#sealReceipt(event.receipt);
                this.#pendingReceipt = event.receipt;
                return;
            case "decision-rejected":
                event.receipt = this.#sealReceipt(event.receipt);
                this.#pendingReceipt = null;
                return;
            case "action":
                if (event.receipt !== undefined) {
                    // A refused action leaves the proposal pending, so the
                    // matching action can still follow it.
                    const pending = this.#pendingReceipt;
                    if (pending?.commandHash !== event.receipt.commandHash) {
                        throw new Error(
                            `Run ${this.#manifest.runId} action receipt has no matching proposal`,
                        );
                    }
                    event.receipt = pending;
                }
                this.#pendingReceipt = null;
                return;
            default:
                return;
        }
    }

    #sealReceipt(receipt: DecisionReceipt): DecisionReceipt {
        if (this.#producer === undefined) {
            throw new Error(
                `Run ${this.#manifest.runId} has no sealed producer record; receipt-bearing events are refused`,
            );
        }
        const core = {
            sessionNonce: this.#producer.sessionNonce,
            priorObservationSequence: receipt.priorObservationSequence,
            priorObservationHash: receipt.priorObservationHash,
            commandHash: receipt.commandHash,
            sequence: this.#receiptCount,
        };
        const receiptHash = hashReceipt(this.#receiptChainHash, core);
        this.#receiptChainHash = advanceReceiptChain(
            this.#receiptChainHash,
            receiptHash,
        );
        this.#receiptCount += 1;
        return { ...core, receiptHash };
    }

    async #writeSummaryFiles(): Promise<void> {
        const redacted = redactKnownSecrets(
            this.#manifest,
            this.#sensitiveInputValues,
        ) as RunManifest;
        await writeFile(
            this.manifestPath,
            `${JSON.stringify(redacted, null, 2)}\n`,
            "utf8",
        );
        await writeFile(this.readmePath, renderReadme(redacted), "utf8");
    }
}

function createRunId(startedAt: string): string {
    const timestamp = startedAt.replaceAll(/[^0-9]/g, "").slice(0, 17);
    return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

// --- Producer attestation ---------------------------------------------------

/** Refuse a human seal where this process records LLM discovery decisions. */
export function assertDiscoveryProducer(producer: ProducerRecord): void {
    if (producer.kind !== "external-llm") {
        throw new Error(
            "A discovery run requires an external-llm producer; human producers are only valid for handoff replays",
        );
    }
}

/**
 * Fold one host stream attestation into every finalized run bearing its nonce.
 *
 * The manifest, not a lane-local sidecar that promotion never reads, is the
 * reviewed record of what the host actually reported.
 */
export async function attestDiscoveryRuns(
    rootDirectory: string,
    attestation: HostProducerAttestation,
): Promise<readonly string[]> {
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const attestedRunIds: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name)) continue;
        const manifestPath = join(rootDirectory, entry.name, "run.json");
        const manifest = await readManifestRecord(manifestPath);
        if (manifest === null) continue;
        const producer = manifest.producer;
        if (
            !isLauncherSealedProducer(producer) ||
            producer.kind !== "external-llm" ||
            producer.sessionNonce !== attestation.sessionNonce ||
            (manifest.status !== "satisfied" && manifest.status !== "error")
        )
            continue;
        const attestedProducer: ProducerRecord = {
            ...producer,
            model: attestation.resolvedModel,
            hostSessionId: attestation.sessionId,
            streamDigest: attestation.streamDigest,
            hostAttestationDigest: digestHostAttestation(attestation),
            hostExitStatus: attestation.exitStatus,
            hostExitCode: attestation.exitCode,
        };
        await writeFile(
            manifestPath,
            `${JSON.stringify({ ...manifest, producer: attestedProducer }, null, 2)}\n`,
            "utf8",
        );
        attestedRunIds.push(entry.name);
    }
    return attestedRunIds;
}

/**
 * Verify the persisted producer and decision evidence before promotion.
 *
 * The recorder is the authority for the two genesis values and the receipt
 * construction. Replaying those calculations here makes a copied run prove the
 * same event and receipt history that the recorder wrote, rather than merely
 * carrying plausible metadata.
 */
export function validateRunAttestation(
    manifest: Record<string, unknown>,
    eventsSource: string,
): void {
    const runId = manifest.runId;
    const startedAt = manifest.startedAt;
    const producer = manifest.producer;
    if (typeof runId !== "string" || typeof startedAt !== "string") {
        throw new Error("Run manifest is missing its recorder identity");
    }
    // A producer attests model and human decisions. A deterministic replay
    // makes none — the reviewed artifact decided everything — so it may omit
    // one, but only if it carries no receipt summary and its ledger holds no
    // decision or handoff event that would need attesting.
    const sealed = isLauncherSealedProducer(producer);
    if (!sealed && producer !== undefined && producer !== null) {
        throw new Error(
            `Run ${runId} has no valid launcher-sealed producer record`,
        );
    }
    if (
        sealed &&
        producer.kind === "external-llm" &&
        !isHostAttestedProducer(producer)
    ) {
        throw new Error(
            `Run ${runId} has no valid host attestation for its external discovery producer`,
        );
    }

    // The recorder writes no receipt summary for a producer-less run, because
    // it has no decisions to summarize; an unsealed run carrying one was sealed
    // once and had its producer removed.
    const decisionReceipts = manifest.decisionReceipts;
    if (!sealed && decisionReceipts !== undefined) {
        throw unattestedRunError(runId);
    }
    if (sealed && !isDecisionReceiptSummary(decisionReceipts)) {
        throw new Error(`Run ${runId} has no valid decision receipt summary`);
    }

    const replayed = replayEventLedger(
        runId,
        startedAt,
        sealed ? producer.sessionNonce : null,
        parseEventLedger(eventsSource),
    );

    if (!isDecisionReceiptSummary(decisionReceipts)) return;
    if (replayed.count !== decisionReceipts.count) {
        throw new Error(
            `Run ${runId} receipt count does not match its manifest digest`,
        );
    }
    if (replayed.digest !== decisionReceipts.digest) {
        throw new Error(`Run ${runId} decision receipt digest does not match`);
    }
}

/** The run manifest at `path` as a record, or null when unreadable. */
async function readManifestRecord(
    path: string,
): Promise<Record<string, unknown> | null> {
    try {
        const parsed = parseJson(await readFile(path, "utf8"));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isLauncherSealedProducer(value: unknown): value is ProducerRecord {
    return (
        isRecord(value) &&
        (value.kind === "external-llm" || value.kind === "human") &&
        typeof value.provider === "string" &&
        value.provider !== "" &&
        (typeof value.model === "string" || value.model === null) &&
        typeof value.sessionNonce === "string" &&
        value.sessionNonce !== "" &&
        typeof value.sealPath === "string" &&
        value.sealPath !== ""
    );
}

function digestHostAttestation(attestation: HostProducerAttestation): string {
    return sha256Hex(
        JSON.stringify({
            sessionNonce: attestation.sessionNonce,
            sessionId: attestation.sessionId,
            resolvedModel: attestation.resolvedModel,
            streamDigest: attestation.streamDigest,
            exitStatus: attestation.exitStatus,
            exitCode: attestation.exitCode,
        }),
    );
}

function isHostAttestedProducer(producer: ProducerRecord): boolean {
    return (
        (typeof producer.hostSessionId === "string" ||
            producer.hostSessionId === null) &&
        typeof producer.streamDigest === "string" &&
        SHA256_HEX_PATTERN.test(producer.streamDigest) &&
        typeof producer.hostAttestationDigest === "string" &&
        producer.hostAttestationDigest ===
            digestHostAttestation({
                sessionNonce: producer.sessionNonce,
                sessionId: producer.hostSessionId,
                resolvedModel: producer.model,
                streamDigest: producer.streamDigest,
                exitStatus: producer.hostExitStatus ?? "failed",
                exitCode: producer.hostExitCode ?? null,
            }) &&
        (producer.hostExitStatus === "exited" ||
            producer.hostExitStatus === "timeout" ||
            producer.hostExitStatus === "failed") &&
        (typeof producer.hostExitCode === "number" ||
            producer.hostExitCode === null)
    );
}

function unattestedRunError(runId: string): Error {
    return new Error(
        `Run ${runId} has no valid launcher-sealed producer record; only a decision-free replay may omit one`,
    );
}

function isDecisionReceiptSummary(
    value: unknown,
): value is { count: number; digest: string } {
    return (
        isRecord(value) &&
        typeof value.count === "number" &&
        Number.isInteger(value.count) &&
        value.count >= 0 &&
        typeof value.digest === "string" &&
        SHA256_HEX_PATTERN.test(value.digest)
    );
}

/**
 * Recompute both chains over a persisted ledger and return the terminal state
 * of the receipt chain. `sessionNonce` is null for an unsealed run, whose
 * ledger may then hold no decision or handoff event.
 */
function replayEventLedger(
    runId: string,
    startedAt: string,
    sessionNonce: string | null,
    events: readonly RunEvent[],
): { count: number; digest: string } {
    const receiptNonce = sessionNonce ?? "unsealed";
    let eventChainHash = eventChainGenesis(runId, startedAt);
    let receiptChainHash = receiptChainGenesis(runId, receiptNonce);
    let receiptCount = 0;
    const observations = new Map<number, string>();
    let previousProposal: Extract<RunEvent, { type: "proposal" }> | null = null;

    for (const [sequence, event] of events.entries()) {
        eventChainHash = hashEvent(eventChainHash, sequence, event);

        if (event.type === "observation") {
            observations.set(sequence, eventChainHash);
            previousProposal = null;
            continue;
        }

        if (sessionNonce === null && recordsDecision(event)) {
            throw unattestedRunError(runId);
        }

        if (event.type === "proposal" || event.type === "decision-rejected") {
            verifyDecisionReceipt(
                runId,
                receiptNonce,
                event,
                sequence,
                observations,
                receiptCount,
                receiptChainHash,
            );
            receiptChainHash = advanceReceiptChain(
                receiptChainHash,
                event.receipt.receiptHash,
            );
            receiptCount += 1;
            previousProposal = event.type === "proposal" ? event : null;
            continue;
        }

        if (
            event.type === "action" &&
            event.receipt !== undefined &&
            !matchesProposal(event, previousProposal)
        ) {
            throw new Error(
                `Run ${runId} action receipt does not match an earlier proposal`,
            );
        }
        previousProposal = null;
    }

    return { count: receiptCount, digest: receiptChainHash };
}

/** Whether a ledger event is a decision or handoff that a producer must attest. */
function recordsDecision(event: RunEvent): boolean {
    switch (event.type) {
        case "proposal":
        case "decision-rejected":
        case "intervention-request":
        case "control-transfer":
        case "control-rejected":
        case "resume-validated":
        case "resume-rejected":
            return true;
        case "action":
            return event.receipt !== undefined;
        default:
            return false;
    }
}

function verifyDecisionReceipt(
    runId: string,
    sessionNonce: string,
    event: DecisionEvent,
    eventSequence: number,
    observations: ReadonlyMap<number, string>,
    expectedSequence: number,
    previousChainHash: string,
): void {
    const receipt = event.receipt;
    const priorObservationSequence = receipt.priorObservationSequence;
    if (
        priorObservationSequence === null &&
        receipt.priorObservationHash === null
    ) {
        throw new Error(
            `Run ${runId} decision receipt is not bound to an earlier observation`,
        );
    }
    if (
        receipt.sessionNonce !== sessionNonce ||
        !Number.isInteger(receipt.sequence) ||
        receipt.sequence !== expectedSequence ||
        typeof priorObservationSequence !== "number" ||
        !Number.isInteger(priorObservationSequence) ||
        priorObservationSequence < 0 ||
        priorObservationSequence >= eventSequence ||
        typeof receipt.priorObservationHash !== "string" ||
        typeof receipt.commandHash !== "string" ||
        typeof receipt.receiptHash !== "string"
    ) {
        throw new Error(`Run ${runId} contains an invalid decision receipt`);
    }

    const observationHash = observations.get(priorObservationSequence);
    if (observationHash === undefined) {
        throw new Error(
            `Run ${runId} decision receipt is not bound to an earlier observation`,
        );
    }
    if (observationHash !== receipt.priorObservationHash) {
        throw new Error(
            `Run ${runId} decision receipt does not match the earlier observation it claims`,
        );
    }
    if (hashDecisionCommand(event) !== receipt.commandHash) {
        throw new Error(`Run ${runId} decision command digest does not match`);
    }
    if (hashReceipt(previousChainHash, receipt) !== receipt.receiptHash) {
        throw new Error(`Run ${runId} decision receipt chain is broken`);
    }
}

/** Whether an executed action repeats the proposal it claims, receipt and all. */
function matchesProposal(
    action: Extract<RunEvent, { type: "action" }>,
    proposal: Extract<RunEvent, { type: "proposal" }> | null,
): boolean {
    return (
        proposal !== null &&
        action.receipt !== undefined &&
        sameDecisionReceipt(action.receipt, proposal.receipt) &&
        JSON.stringify(action.action) === JSON.stringify(proposal.action) &&
        action.rationale === proposal.rationale
    );
}

function sameDecisionReceipt(
    left: DecisionReceipt,
    right: DecisionReceipt,
): boolean {
    return (
        left.sessionNonce === right.sessionNonce &&
        left.priorObservationSequence === right.priorObservationSequence &&
        left.priorObservationHash === right.priorObservationHash &&
        left.commandHash === right.commandHash &&
        left.sequence === right.sequence &&
        left.receiptHash === right.receiptHash
    );
}

// --- Chain construction -----------------------------------------------------

// Shared by the recorder and the validator. Every input string and object key
// order here is part of the committed evidence format.

function sha256Hex(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

function eventChainGenesis(runId: string, startedAt: string): string {
    return sha256Hex(`events:${runId}:${startedAt}`);
}

/** `sessionNonce` is `"unsealed"` for a run without a producer record. */
function receiptChainGenesis(runId: string, sessionNonce: string): string {
    return sha256Hex(`decision-receipts:${runId}:${sessionNonce}`);
}

function hashEvent(
    previousChainHash: string,
    sequence: number,
    event: RunEvent,
): string {
    return sha256Hex(
        `${previousChainHash}|${String(sequence)}|${JSON.stringify(event)}`,
    );
}

function hashDecisionCommand(command: {
    action: SurfaceAction;
    risk: ActionRisk;
    rationale: string;
}): string {
    return sha256Hex(
        JSON.stringify({
            action: command.action,
            risk: command.risk,
            rationale: command.rationale,
        }),
    );
}

/** The receipt hash, over every receipt field except the hash itself. */
function hashReceipt(
    previousChainHash: string,
    receipt: Omit<DecisionReceipt, "receiptHash">,
): string {
    return sha256Hex(
        `${previousChainHash}|${JSON.stringify({
            sessionNonce: receipt.sessionNonce,
            priorObservationSequence: receipt.priorObservationSequence,
            priorObservationHash: receipt.priorObservationHash,
            commandHash: receipt.commandHash,
            sequence: receipt.sequence,
        })}`,
    );
}

function advanceReceiptChain(
    previousChainHash: string,
    receiptHash: string,
): string {
    return sha256Hex(`${previousChainHash}|${receiptHash}`);
}

// --- Ledger parsing ---------------------------------------------------------

function parseEventLedger(source: string): readonly RunEvent[] {
    if (source.trim() === "") return [];
    return source.trimEnd().split("\n").map(parseRunEventLine);
}

/** This module's single `JSON.parse` site; every caller narrows the result. */
function parseJson(source: string): unknown {
    return JSON.parse(source);
}

function parseRunEventLine(line: string): RunEvent {
    const value = parseJson(line);
    if (!isRunEvent(value)) {
        throw new Error(
            "Event ledger line must be a recognized discovery event",
        );
    }
    return value;
}

function isRunEvent(value: unknown): value is RunEvent {
    if (!isRecord(value)) return false;
    if (typeof value.recordedAt !== "string") return false;
    switch (value.type) {
        case "observation":
            return isObservation(value.observation);
        case "proposal":
            return (
                "action" in value &&
                "risk" in value &&
                typeof value.rationale === "string" &&
                "policyDecision" in value &&
                "receipt" in value
            );
        case "decision-rejected":
            return (
                "action" in value &&
                "risk" in value &&
                typeof value.rationale === "string" &&
                typeof value.reason === "string" &&
                "receipt" in value
            );
        case "action":
            return (
                "action" in value &&
                "result" in value &&
                typeof value.rationale === "string"
            );
        case "intervention-request":
            return isInterventionRequest(value.request);
        case "control-transfer":
            return (
                isControlLeaseState(value.from) &&
                isControlLeaseState(value.to) &&
                (value.requestId === undefined ||
                    typeof value.requestId === "string")
            );
        case "control-rejected":
            return (
                (value.command === "take-control" ||
                    value.command === "human-observe" ||
                    value.command === "human-act" ||
                    value.command === "resume" ||
                    value.command === "escalate" ||
                    value.command === "finish") &&
                typeof value.reason === "string"
            );
        case "resume-validated":
            return (
                isObservation(value.observation) &&
                isValidatedResumeDecision(value.decision)
            );
        case "resume-rejected":
            return (
                isObservation(value.observation) &&
                typeof value.reason === "string"
            );
        case "checkpoint":
            return (
                typeof value.name === "string" &&
                typeof value.satisfied === "boolean"
            );
        case "terminal":
            return isRunOutcome(value.outcome);
        default:
            return false;
    }
}

function isObservation(value: unknown): value is Observation {
    return (
        isRecord(value) &&
        typeof value.url === "string" &&
        typeof value.title === "string"
    );
}

function isInterventionRequest(value: unknown): value is InterventionRequest {
    if (!isRecord(value)) return false;
    if (
        typeof value.id !== "string" ||
        typeof value.capabilityId !== "string" ||
        typeof value.goal !== "string" ||
        typeof value.stageId !== "string" ||
        typeof value.reason !== "string" ||
        typeof value.requestedAt !== "string" ||
        !isNonNegativeInteger(value.controlEpoch) ||
        !isRecord(value.session) ||
        !Array.isArray(value.evidence)
    ) {
        return false;
    }
    const session = value.session;
    return (
        typeof session.runId === "string" &&
        typeof session.runDirectory === "string" &&
        (session.socketPath === undefined ||
            typeof session.socketPath === "string") &&
        value.evidence.every(isEvidenceReference)
    );
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isEvidenceReference(value: unknown): value is EvidenceReference {
    return (
        isRecord(value) &&
        (value.kind === "screenshot" ||
            value.kind === "trace" ||
            value.kind === "snapshot" ||
            value.kind === "log") &&
        typeof value.path === "string" &&
        typeof value.redacted === "boolean"
    );
}

function isControlLeaseState(value: unknown): value is ControlLeaseState {
    return (
        isRecord(value) &&
        (value.controller === "automation" || value.controller === "human") &&
        isNonNegativeInteger(value.epoch)
    );
}

function isValidatedResumeDecision(
    value: unknown,
): value is Exclude<ResumeDecision, { type: "reject" }> {
    if (!isRecord(value)) return false;
    if (value.type === "resume") return typeof value.stageId === "string";
    return value.type === "complete" && typeof value.checkpoint === "string";
}

function isRunOutcome(value: unknown): value is RunOutcome {
    if (
        !isRecord(value) ||
        typeof value.status !== "string" ||
        typeof value.summary !== "string"
    ) {
        return false;
    }
    return (
        (value.status === "satisfied" &&
            typeof value.checkpoint === "string") ||
        (value.status === "error" && typeof value.code === "string")
    );
}

// --- README rendering -------------------------------------------------------

function renderReadme(manifest: RunManifest): string {
    const outcome = manifest.outcome;
    const outcomeBody =
        outcome === undefined
            ? "The run is still in progress."
            : outcome.status === "satisfied"
              ? `${outcome.summary}\n\nCheckpoint: \`${outcome.checkpoint}\``
              : `${outcome.summary}\n\nError code: \`${outcome.code}\``;

    return `# Test Run ${manifest.runId}

- Status: \`${manifest.status}\`
- Target: \`${manifest.targetProfile}\` \`${manifest.targetVersion}\`
- Fixture: \`${manifest.fixtureId}\`
${renderProducerLine(manifest)}${renderReceiptLine(manifest)}- Started: \`${manifest.startedAt}\`
${manifest.finishedAt === undefined ? "" : `- Finished: \`${manifest.finishedAt}\`\n`}
## Goal

${quote(manifest.goal)}

## Situation

${manifest.situation}

## Outcome

${outcomeBody}

## Files

- \`run.json\` — structured run metadata and outcome
- \`events.jsonl\` — sanitized observations, decisions, and executed actions
- \`trace.zip\` — Playwright trace when capture completed
- \`screenshots/\` — meaningful checkpoint or terminal screenshots when captured
`;
}

function renderProducerLine(manifest: RunManifest): string {
    const producer = manifest.producer;
    return producer === undefined
        ? ""
        : `- Producer: \`${producer.kind}/${producer.provider}\` model \`${producer.model ?? "not reported"}\` sealed nonce \`${producer.sessionNonce}\`\n`;
}

function renderReceiptLine(manifest: RunManifest): string {
    const receipts = manifest.decisionReceipts;
    return receipts === undefined
        ? ""
        : `- Decision receipts: \`${String(receipts.count)}\` sealed, terminal digest \`${receipts.digest}\`\n`;
}

/** Quote a block of text so it cannot break out of the surrounding document. */
function quote(value: string): string {
    return value
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}
