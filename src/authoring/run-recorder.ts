import { createHash, randomUUID } from "node:crypto";
import {
    appendFile,
    mkdir,
    readFile,
    readdir,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
    ActionRisk,
    EvidenceReference,
    Observation,
    SurfaceAction,
} from "../surfaces/surface-driver.js";
import type { ControlLeaseState } from "../intervention/control-lease.js";
import type { InterventionRequest } from "../intervention/request.js";
import type {
    DecisionReceipt,
    DiscoveryEvent,
    EventIdentity,
    EventRecorder,
} from "./event-recorder.js";
import { redactKnownSecrets } from "./redaction.js";

/**
 * The on-disk unit of discovery evidence: one directory per test run.
 *
 * A run directory has to be reviewable without the process that produced it, so
 * it carries the run in four files:
 *
 * - `run.json` — goal, situation, target, fixture, and outcome
 * - `events.jsonl` — the sanitized ledger, one event per line
 * - `README.md` — those facts rendered for a person
 * - `trace.zip` — the Playwright trace, when capture completed
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
 */

/** What a run needs to identify itself before it starts. */
export interface TestRunStart {
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
    hostExitStatus?: CodexHostExitStatus;
    hostExitCode?: number | null;
}

export type CodexHostExitStatus = "exited" | "timeout" | "failed";

export interface HostProducerAttestation {
    sessionNonce: string;
    sessionId: string | null;
    resolvedModel: string | null;
    streamDigest: string;
    exitStatus: CodexHostExitStatus;
    exitCode: number | null;
}

/**
 * How a run ended.
 *
 * A satisfied run must name the checkpoint that proved it, and an error run
 * must name a code, so failures group by class instead of accumulating as prose
 * that has to be read one at a time.
 */
export type TestRunOutcome =
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
export interface TestRunManifest {
    runId: string;
    status: "running" | TestRunOutcome["status"];
    goal: string;
    situation: string;
    targetProfile: string;
    targetVersion: string;
    fixtureId: string;
    /** The launcher-sealed producer of this run's decisions, when sealed. */
    producer?: ProducerRecord | undefined;
    /** Terminal state of the append-only decision-receipt chain, at finalize. */
    decisionReceipts?: { count: number; digest: string } | undefined;
    startedAt: string;
    finishedAt?: string;
    outcome?: TestRunOutcome;
    files: {
        readme: "README.md";
        events: "events.jsonl";
        trace: "trace.zip";
        screenshots: "screenshots/";
    };
}

const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export class FileTestRunRecorder implements EventRecorder {
    readonly #now: () => string;
    #finalized = false;
    #writeQueue: Promise<void> = Promise.resolve();
    readonly #producer: ProducerRecord | undefined;
    readonly #sensitiveInputValues: readonly string[];
    #eventChainHash: string;
    #receiptChainHash: string;
    #eventSequence = 0;
    #receiptCount = 0;
    #lastObservation: EventIdentity | null = null;
    #pendingDecision: {
        action: SurfaceAction;
        rationale: string;
        receipt: DecisionReceipt;
    } | null = null;

    private constructor(
        public readonly directory: string,
        public readonly manifestPath: string,
        public readonly eventsPath: string,
        public readonly readmePath: string,
        public readonly tracePath: string,
        private readonly manifest: TestRunManifest,
        producer: ProducerRecord | undefined,
        eventChainGenesis: string,
        receiptChainGenesis: string,
        now: () => string,
        sensitiveInputValues: readonly string[],
    ) {
        this.#now = now;
        this.#sensitiveInputValues = sensitiveInputValues;
        this.#producer = producer;
        this.#eventChainHash = eventChainGenesis;
        this.#receiptChainHash = receiptChainGenesis;
    }

    /**
     * Create a run directory and its empty ledger.
     *
     * The non-recursive create and the exclusive ledger write are what make a run
     * directory collision-proof: two runs cannot silently share a directory and
     * interleave their evidence.
     */
    public static async start(
        options: TestRunStart,
    ): Promise<FileTestRunRecorder> {
        const now = options.now ?? (() => new Date().toISOString());
        const startedAt = now();
        const runId = options.runId ?? createRunId(startedAt);
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new Error(`Invalid run ID: ${runId}`);
        }

        const directory = join(options.rootDirectory, runId);
        await mkdir(options.rootDirectory, { recursive: true });
        await mkdir(directory);

        const manifest: TestRunManifest = {
            runId,
            status: "running",
            goal: options.goal,
            situation: options.situation,
            targetProfile: options.targetProfile,
            targetVersion: options.targetVersion,
            fixtureId: options.fixtureId,
            producer: options.producer,
            startedAt,
            files: {
                readme: "README.md",
                events: "events.jsonl",
                trace: "trace.zip",
                screenshots: "screenshots/",
            },
        };
        const recorder = new FileTestRunRecorder(
            directory,
            join(directory, "run.json"),
            join(directory, manifest.files.events),
            join(directory, manifest.files.readme),
            join(directory, manifest.files.trace),
            manifest,
            options.producer,
            createHash("sha256")
                .update(`events:${runId}:${startedAt}`)
                .digest("hex"),
            createHash("sha256")
                .update(
                    `decision-receipts:${runId}:${options.producer?.sessionNonce ?? "unsealed"}`,
                )
                .digest("hex"),
            now,
            options.sensitiveInputValues ?? [],
        );

        await writeFile(recorder.eventsPath, "", { flag: "wx" });
        await recorder.writeSummaryFiles();
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
    public append(event: DiscoveryEvent): Promise<EventIdentity> {
        if (this.#finalized) {
            return Promise.reject(
                new Error(`Run ${this.manifest.runId} is already finalized`),
            );
        }

        const appended = this.#writeQueue.then(() => {
            const identity = this.#appendSerialized(event);
            return appendFile(
                this.eventsPath,
                `${JSON.stringify(identity.event)}\n`,
            ).then(() => ({
                sequence: identity.sequence,
                hash: identity.hash,
            }));
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
                `Run ${this.manifest.runId} has no sealed producer record; decisions cannot be attested`,
            );
        }
        const prior = this.#lastObservation;
        return {
            sessionNonce: this.#producer.sessionNonce,
            priorObservationSequence: prior?.sequence ?? null,
            priorObservationHash: prior?.hash ?? null,
            commandHash: createHash("sha256")
                .update(
                    JSON.stringify({
                        action: command.action,
                        risk: command.risk,
                        rationale: command.rationale,
                    }),
                )
                .digest("hex"),
            sequence: -1,
            receiptHash: "",
        };
    }

    public async readAll(): Promise<readonly DiscoveryEvent[]> {
        await this.#writeQueue;
        const source = await readFile(this.eventsPath, "utf8");
        if (source.trim() === "") {
            return [];
        }
        return source.trimEnd().split("\n").map(parseDiscoveryEventLine);
    }

    /**
     * Close the run and write its manifest and README.
     *
     * Queued appends are awaited first, so the summary never describes a run whose
     * last events are still in flight.
     */
    public async finalize(outcome: TestRunOutcome): Promise<void> {
        if (this.#finalized) {
            throw new Error(`Run ${this.manifest.runId} is already finalized`);
        }
        this.#finalized = true;
        await this.#writeQueue;

        this.manifest.status = outcome.status;
        this.manifest.finishedAt = this.#now();
        this.manifest.outcome = outcome;
        if (this.#producer !== undefined) {
            this.manifest.decisionReceipts = {
                count: this.#receiptCount,
                digest: this.#receiptChainHash,
            };
        }
        await this.writeSummaryFiles();
    }

    /** Runs inside the write queue, so chain state advances in arrival order. */
    #appendSerialized(event: DiscoveryEvent): {
        sequence: number;
        hash: string;
        event: DiscoveryEvent;
    } {
        const clean = redactKnownSecrets(
            event,
            this.#sensitiveInputValues,
        ) as DiscoveryEvent;
        if (clean.type === "proposal") {
            const receipt = this.#sealReceipt(clean.receipt);
            clean.receipt = receipt;
            this.#pendingDecision = {
                action: clean.action,
                rationale: clean.rationale,
                receipt,
            };
            this.#receiptCount += 1;
        } else if (clean.type === "decision-rejected") {
            clean.receipt = this.#sealReceipt(clean.receipt);
            this.#pendingDecision = null;
            this.#receiptCount += 1;
        } else if (clean.type === "action") {
            if (clean.receipt !== undefined) {
                const pending = this.#pendingDecision;
                if (
                    pending?.receipt.commandHash !== clean.receipt.commandHash
                ) {
                    throw new Error(
                        `Run ${this.manifest.runId} action receipt has no matching proposal`,
                    );
                }
                clean.receipt = pending.receipt;
            }
            this.#pendingDecision = null;
        }
        const sequence = this.#eventSequence;
        const hash = createHash("sha256")
            .update(
                `${this.#eventChainHash}|${String(sequence)}|${JSON.stringify(clean)}`,
            )
            .digest("hex");
        this.#eventChainHash = hash;
        this.#eventSequence = sequence + 1;
        if (clean.type === "observation") {
            this.#lastObservation = { sequence, hash };
        }
        return { sequence, hash, event: clean };
    }

    #sealReceipt(receipt: DecisionReceipt): DecisionReceipt {
        if (this.#producer === undefined) {
            throw new Error(
                `Run ${this.manifest.runId} has no sealed producer record; receipt-bearing events are refused`,
            );
        }
        const sequence = this.#receiptCount;
        const core = {
            sessionNonce: this.#producer.sessionNonce,
            priorObservationSequence: receipt.priorObservationSequence,
            priorObservationHash: receipt.priorObservationHash,
            commandHash: receipt.commandHash,
            sequence,
        };
        const receiptHash = createHash("sha256")
            .update(`${this.#receiptChainHash}|${JSON.stringify(core)}`)
            .digest("hex");
        this.#receiptChainHash = createHash("sha256")
            .update(`${this.#receiptChainHash}|${receiptHash}`)
            .digest("hex");
        return { ...core, receiptHash };
    }

    private async writeSummaryFiles(): Promise<void> {
        await writeFile(
            this.manifestPath,
            `${JSON.stringify(redactKnownSecrets(this.manifest, this.#sensitiveInputValues), null, 2)}\n`,
            "utf8",
        );
        await writeFile(
            this.readmePath,
            renderReadme(
                redactKnownSecrets(
                    this.manifest,
                    this.#sensitiveInputValues,
                ) as TestRunManifest,
            ),
            "utf8",
        );
    }
}

/**
 * Verify the persisted producer and decision evidence before promotion.
 *
 * The recorder is the authority for the two genesis values and the receipt
 * construction. Replaying those calculations here makes a copied run prove the
 * same event and receipt history that the recorder wrote, rather than merely
 * carrying plausible metadata.
 */
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
        let manifest: Record<string, unknown>;
        try {
            const parsed = parseJson(await readFile(manifestPath, "utf8"));
            if (!isRecord(parsed)) continue;
            manifest = parsed;
        } catch {
            continue;
        }
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
    if (!isLauncherSealedProducer(producer)) {
        throw new Error(
            `Run ${runId} has no valid launcher-sealed producer record`,
        );
    }
    if (producer.kind === "external-llm" && !isHostAttestedProducer(producer)) {
        throw new Error(
            `Run ${runId} has no valid host attestation for its external discovery producer`,
        );
    }

    const decisionReceipts = manifest.decisionReceipts;
    if (!isDecisionReceiptSummary(decisionReceipts)) {
        throw new Error(`Run ${runId} has no valid decision receipt summary`);
    }

    const events = parseEventLedger(eventsSource);
    let eventChainHash = createHash("sha256")
        .update(`events:${runId}:${startedAt}`)
        .digest("hex");
    let receiptChainHash = createHash("sha256")
        .update(`decision-receipts:${runId}:${producer.sessionNonce}`)
        .digest("hex");
    let receiptCount = 0;
    const observations = new Map<number, string>();
    let previousProposal: Extract<DiscoveryEvent, { type: "proposal" }> | null =
        null;

    for (const [sequence, event] of events.entries()) {
        const eventHash = createHash("sha256")
            .update(
                `${eventChainHash}|${String(sequence)}|${JSON.stringify(event)}`,
            )
            .digest("hex");
        eventChainHash = eventHash;

        if (event.type === "observation") {
            observations.set(sequence, eventHash);
            previousProposal = null;
            continue;
        }

        if (event.type === "proposal" || event.type === "decision-rejected") {
            const receipt = event.receipt;
            verifyDecisionReceipt(
                runId,
                producer.sessionNonce,
                receipt,
                sequence,
                observations,
                event.action,
                event.risk,
                event.rationale,
                receiptCount,
                receiptChainHash,
            );
            receiptChainHash = advanceReceiptChain(receiptChainHash, receipt);
            receiptCount += 1;
            previousProposal = event.type === "proposal" ? event : null;
            continue;
        }

        if (event.type === "action" && event.receipt !== undefined) {
            if (
                previousProposal === null ||
                !sameDecisionReceipt(event.receipt, previousProposal.receipt) ||
                JSON.stringify(event.action) !==
                    JSON.stringify(previousProposal.action) ||
                event.rationale !== previousProposal.rationale
            ) {
                throw new Error(
                    `Run ${runId} action receipt does not match an earlier proposal`,
                );
            }
        }
        previousProposal = null;
    }

    if (receiptCount !== decisionReceipts.count) {
        throw new Error(
            `Run ${runId} receipt count does not match its manifest digest`,
        );
    }
    if (receiptChainHash !== decisionReceipts.digest) {
        throw new Error(`Run ${runId} decision receipt digest does not match`);
    }
}

function verifyDecisionReceipt(
    runId: string,
    sessionNonce: string,
    receipt: DecisionReceipt,
    eventSequence: number,
    observations: ReadonlyMap<number, string>,
    action: SurfaceAction,
    risk: ActionRisk,
    rationale: string,
    expectedSequence: number,
    previousChainHash: string,
): void {
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

    const commandHash = createHash("sha256")
        .update(JSON.stringify({ action, risk, rationale }))
        .digest("hex");
    if (commandHash !== receipt.commandHash) {
        throw new Error(`Run ${runId} decision command digest does not match`);
    }

    const expectedReceiptHash = createHash("sha256")
        .update(
            `${previousChainHash}|${JSON.stringify({
                sessionNonce: receipt.sessionNonce,
                priorObservationSequence: receipt.priorObservationSequence,
                priorObservationHash: receipt.priorObservationHash,
                commandHash: receipt.commandHash,
                sequence: receipt.sequence,
            })}`,
        )
        .digest("hex");
    if (expectedReceiptHash !== receipt.receiptHash) {
        throw new Error(`Run ${runId} decision receipt chain is broken`);
    }
}

function advanceReceiptChain(
    previousChainHash: string,
    receipt: DecisionReceipt,
): string {
    return createHash("sha256")
        .update(`${previousChainHash}|${receipt.receiptHash}`)
        .digest("hex");
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

function parseEventLedger(source: string): readonly DiscoveryEvent[] {
    if (source.trim() === "") return [];
    return source.trimEnd().split("\n").map(parseDiscoveryEventLine);
}

function isLauncherSealedProducer(value: unknown): value is ProducerRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        (record.kind === "external-llm" || record.kind === "human") &&
        typeof record.provider === "string" &&
        record.provider !== "" &&
        (typeof record.model === "string" || record.model === null) &&
        typeof record.sessionNonce === "string" &&
        record.sessionNonce !== "" &&
        typeof record.sealPath === "string" &&
        record.sealPath !== ""
    );
}

function digestHostAttestation(attestation: HostProducerAttestation): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                sessionNonce: attestation.sessionNonce,
                sessionId: attestation.sessionId,
                resolvedModel: attestation.resolvedModel,
                streamDigest: attestation.streamDigest,
                exitStatus: attestation.exitStatus,
                exitCode: attestation.exitCode,
            }),
        )
        .digest("hex");
}

function isHostAttestedProducer(producer: ProducerRecord): boolean {
    return (
        (typeof producer.hostSessionId === "string" ||
            producer.hostSessionId === null) &&
        typeof producer.streamDigest === "string" &&
        /^[0-9a-f]{64}$/.test(producer.streamDigest) &&
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

function isDecisionReceiptSummary(
    value: unknown,
): value is { count: number; digest: string } {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.count === "number" &&
        Number.isInteger(record.count) &&
        record.count >= 0 &&
        typeof record.digest === "string" &&
        /^[0-9a-f]{64}$/.test(record.digest)
    );
}

function parseJson(source: string): unknown {
    return JSON.parse(source);
}

function parseDiscoveryEventLine(line: string): DiscoveryEvent {
    const value = parseJson(line);
    if (!isDiscoveryEvent(value)) {
        throw new Error(
            "Event ledger line must be a recognized discovery event",
        );
    }
    return value;
}

function isDiscoveryEvent(value: unknown): value is DiscoveryEvent {
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
                    value.command === "resume") &&
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
        default:
            return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isObservation(value: unknown): value is Observation {
    return (
        isRecord(value) &&
        typeof value.url === "string" &&
        typeof value.title === "string"
    );
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

function isControlLeaseState(value: unknown): value is ControlLeaseState {
    return (
        isRecord(value) &&
        (value.controller === "automation" || value.controller === "human") &&
        isNonNegativeInteger(value.epoch)
    );
}

function isValidatedResumeDecision(value: unknown): value is
    | { type: "resume"; stageId: string }
    | {
          type: "complete";
          checkpoint: string;
      } {
    if (!isRecord(value)) return false;
    if (value.type === "resume") return typeof value.stageId === "string";
    return value.type === "complete" && typeof value.checkpoint === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function createRunId(startedAt: string): string {
    const timestamp = startedAt.replaceAll(/[^0-9]/g, "").slice(0, 17);
    return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

/** Quote a block of text so it cannot break out of the surrounding document. */
function quote(value: string): string {
    return value
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}

function producerLine(manifest: TestRunManifest): string {
    const producer = manifest.producer;
    return producer === undefined
        ? ""
        : `- Producer: \`${producer.kind}/${producer.provider}\` model \`${producer.model ?? "not reported"}\` sealed nonce \`${producer.sessionNonce}\`\n`;
}

function receiptLine(manifest: TestRunManifest): string {
    const receipts = manifest.decisionReceipts;
    return receipts === undefined
        ? ""
        : `- Decision receipts: \`${String(receipts.count)}\` sealed, terminal digest \`${receipts.digest}\`\n`;
}

function renderReadme(manifest: TestRunManifest): string {
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
${producerLine(manifest)}${receiptLine(manifest)}- Started: \`${manifest.startedAt}\`
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
