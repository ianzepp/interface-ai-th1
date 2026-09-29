/**
 * The mechanical half of artifact authoring: one successful run in, one
 * inspectable provisional graph out.
 *
 * This module reads a finalized satisfied run and emits a linear
 * stage-per-action draft, so review starts from a concrete, evidence-linked
 * proposal rather than a blank file. Deciding which states are real, which
 * transitions are recoverable, and which failure branches the application has
 * remains a review decision made over the whole run corpus; nothing here infers
 * exception semantics.
 *
 * The semantic source is `events.jsonl`. The Playwright trace is read as
 * corroborating metadata — its action count and version — and a disagreement
 * with the ledger becomes a warning rather than a silent preference for either,
 * because it means one of the two misrepresents the run.
 *
 * INVARIANTS
 * - The run is never modified; this module only reads it.
 * - Only a `satisfied` run is admissible. An error run describes a flow that did
 *   not complete, and a draft built from one would encode a failure as a path.
 * - Every stage gets an `otherwise`, so even a draft cannot fall through on an
 *   unrecognized state.
 * - Inputs and targets that could not be grounded are reported in `warnings`
 *   rather than guessed into the graph.
 *
 * LIMITS
 * - One happy path produces no red-path knowledge. Exception codes, business
 *   outcomes, and recoveries are absent by construction, not by oversight.
 * - No typed output extraction is inferred, so a draft returns no outputs.
 * - Inferred input names come from a fixed heuristic table (see
 *   `inferInputName`) over this repository's fixture vocabulary. It is a
 *   starting proposal for review, not a general inference.
 * - Stages are ordered by observed action, so a draft is a transcript until a
 *   reviewer turns it into a graph.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describeError } from "../common/errors.js";
import type {
    CapabilityArtifact,
    CapabilityStage,
    StageDestination,
} from "../runtime/state-machine.js";
import type {
    ActionRisk,
    DetectorSignal,
    StateDetector,
    SurfaceAction,
    TargetDescriptor,
} from "../surfaces/surface-driver.js";
import type { RunEvent } from "./event-recorder.js";
import type { RunManifest } from "./run-recorder.js";

const execFileAsync = promisify(execFile);
const TRACE_MAX_BUFFER = 64 * 1024 * 1024;

/** Playwright frame methods that count as browser actions in a trace. */
const TRACE_ACTION_METHODS = new Set([
    "click",
    "fill",
    "goto",
    "press",
    "selectOption",
    "type",
]);

/** Stage fields compared by `compareArtifacts`, in report order. */
const COMPARED_STAGE_FIELDS = [
    "action",
    "detectors",
    "risk",
    "otherwise",
] as const;

type ActionEvent = Extract<RunEvent, { type: "action" }>;
type TargetCandidate = TargetDescriptor["candidates"][number];

/** The fields of a Playwright trace entry the summary reads. */
interface TraceEntry {
    type?: unknown;
    class?: unknown;
    method?: unknown;
    playwrightVersion?: unknown;
}

/** Summary of the browser evidence used to ground a draft. */
export interface TraceSummary {
    playwrightVersion: string | null;
    entryCount: number;
    actionCount: number;
    actionMethods: Readonly<Record<string, number>>;
    snapshotCount: number;
    screenshotCount: number;
}

/** Inputs needed to construct a first-pass draft without mutating the run. */
export interface DraftArtifactInput {
    manifest: RunManifest;
    events: readonly RunEvent[];
    trace: TraceSummary;
    capabilityId: string;
}

/** A draft is inspectable evidence, not yet an approved replay contract. */
export interface DraftArtifactDocument {
    kind: "capability-draft";
    schemaVersion: "1";
    status: "draft";
    artifact: CapabilityArtifact;
    source: {
        runId: string;
        fixtureId: string;
        targetProfile: string;
        targetVersion: string;
        traceFile: "trace.zip";
        eventCount: number;
        actionCount: number;
        trace: TraceSummary;
    };
    warnings: readonly string[];
}

/** A field-level comparison between a draft and an existing artifact. */
export interface StageComparison {
    index: number;
    draftStageId: string | null;
    currentStageId: string | null;
    equalFields: readonly string[];
    differentFields: readonly string[];
}

/** How far a draft is from an existing artifact, stage by stage. */
export interface ArtifactComparison {
    draftId: string;
    currentId: string;
    draftStageCount: number;
    currentStageCount: number;
    exactActionMatches: number;
    exactDetectorMatches: number;
    exactDetectorSignalMatches: number;
    stageComparisons: readonly StageComparison[];
    differentTopLevelFields: readonly string[];
}

/** Read a finalized successful run and summarize its Playwright trace. */
export async function readSuccessfulRun(
    runDirectory: string,
): Promise<Omit<DraftArtifactInput, "capabilityId">> {
    // The recorder wrote both files, so their shape is trusted once parsed.
    const manifest = parseJsonObject(
        await readFile(join(runDirectory, "run.json"), "utf8"),
        "Run manifest",
    ) as RunManifest;
    if (manifest.status !== "satisfied") {
        throw new Error(
            `Run ${manifest.runId} is ${manifest.status}; draft extraction requires a satisfied run`,
        );
    }

    const eventLines = (
        await readFile(join(runDirectory, manifest.files.events), "utf8")
    ).trimEnd();
    const events =
        eventLines === ""
            ? []
            : eventLines
                  .split("\n")
                  .map(
                      (line) => parseJsonObject(line, "Run event") as RunEvent,
                  );
    if (!events.some((event) => event.type === "action")) {
        throw new Error(`Run ${manifest.runId} contains no action events`);
    }

    return {
        manifest,
        events,
        trace: await summarizeTrace(join(runDirectory, manifest.files.trace)),
    };
}

/** Build a conservative, inspectable draft from one successful run. */
export function buildDraftArtifact(
    input: DraftArtifactInput,
): DraftArtifactDocument {
    const actionEvents = input.events.filter(isActionEvent);
    const origins = collectOrigins(actionEvents);
    const inputs: Record<string, string> = {};
    if (origins.length > 0) inputs.baseUrl = "string";

    const warnings = new Set<string>();
    const stages = actionEvents.map((event, index) => {
        const action = draftAction(event.action, inputs, warnings);
        const detectorResult = inferStageDetector(actionEvents, index, event);
        if (detectorResult.warning !== undefined)
            warnings.add(detectorResult.warning);

        return {
            id: buildStageId(index + 1),
            description: event.rationale,
            risk: draftRisk(action),
            action,
            detectors: [detectorResult.detector],
            transitions: [
                {
                    detectorId: detectorResult.detector.id,
                    destination: buildStageDestination(
                        index,
                        actionEvents.length,
                        detectorResult.detector,
                    ),
                },
            ],
            otherwise: buildFailureDestination("unexpected-state"),
            extractions: [],
        } satisfies CapabilityStage;
    });

    warnings.add(
        "The draft has not been reviewed against red-path runs or persisted-state assertions.",
    );
    warnings.add(
        "Stage IDs, descriptions, risks, detectors, and input bindings are first-pass inferences.",
    );
    warnings.add("No typed output extractions were inferred from this run.");

    const artifact: CapabilityArtifact = {
        schemaVersion: "1",
        capabilityVersion: "0.0.0-draft",
        id: input.capabilityId,
        title: input.manifest.goal,
        // The profile id alone: '<id>-<version>' resolves in no registry, and
        // the version is recorded separately in the source block below.
        targetProfile: input.manifest.targetProfile,
        contract: {
            goal: input.manifest.goal,
            inputs,
            outputs: {},
            successCondition: describeSuccessCondition(input.manifest),
        },
        entryStageId: stages[0]?.id ?? "missing-stage",
        stages,
        policy: {
            allowedOrigins: origins,
            allowedActionTypes: unique(
                actionEvents.map((event) => event.action.type),
            ),
            riskyActionMode: "block",
        },
        provenance: {
            discoveryRunId: input.manifest.runId,
            createdAt: input.manifest.startedAt,
        },
    };

    if (input.trace.actionCount !== actionEvents.length) {
        warnings.add(
            `Trace action count ${String(input.trace.actionCount)} differs from ledger action count ${String(actionEvents.length)}.`,
        );
    }
    if (actionEvents.some((event) => hasCssTarget(event.action))) {
        warnings.add(
            "The draft contains CSS target candidates that require selector review.",
        );
    }

    return {
        kind: "capability-draft",
        schemaVersion: "1",
        status: "draft",
        artifact,
        source: {
            runId: input.manifest.runId,
            fixtureId: input.manifest.fixtureId,
            targetProfile: input.manifest.targetProfile,
            targetVersion: input.manifest.targetVersion,
            traceFile: "trace.zip",
            eventCount: input.events.length,
            actionCount: actionEvents.length,
            trace: input.trace,
        },
        warnings: [...warnings],
    };
}

/** Compare stages by observed order, which remains stable before IDs are reviewed. */
export function compareArtifacts(
    draft: CapabilityArtifact,
    current: CapabilityArtifact,
): ArtifactComparison {
    const stageCount = Math.max(draft.stages.length, current.stages.length);
    const stageComparisons: StageComparison[] = [];
    let exactActionMatches = 0;
    let exactDetectorMatches = 0;
    let exactDetectorSignalMatches = 0;

    for (let index = 0; index < stageCount; index += 1) {
        const draftStage = draft.stages[index];
        const currentStage = current.stages[index];
        const equalFields: string[] = [];
        const differentFields: string[] = [];
        if (draftStage === undefined || currentStage === undefined) {
            differentFields.push("stage");
        } else {
            for (const field of COMPARED_STAGE_FIELDS) {
                if (deepEqual(draftStage[field], currentStage[field]))
                    equalFields.push(field);
                else differentFields.push(field);
            }
            if (equalFields.includes("action")) exactActionMatches += 1;
            if (equalFields.includes("detectors")) exactDetectorMatches += 1;
            if (
                deepEqual(
                    draftStage.detectors.map((detector) => detector.signals),
                    currentStage.detectors.map((detector) => detector.signals),
                )
            )
                exactDetectorSignalMatches += 1;
        }
        stageComparisons.push({
            index: index + 1,
            draftStageId: draftStage?.id ?? null,
            currentStageId: currentStage?.id ?? null,
            equalFields,
            differentFields,
        });
    }

    const topLevelFields: readonly (readonly [string, unknown, unknown])[] = [
        ["targetProfile", draft.targetProfile, current.targetProfile],
        ["contract.inputs", draft.contract.inputs, current.contract.inputs],
        ["contract.outputs", draft.contract.outputs, current.contract.outputs],
        ["policy", draft.policy, current.policy],
    ];

    return {
        draftId: draft.id,
        currentId: current.id,
        draftStageCount: draft.stages.length,
        currentStageCount: current.stages.length,
        exactActionMatches,
        exactDetectorMatches,
        exactDetectorSignalMatches,
        stageComparisons,
        differentTopLevelFields: topLevelFields
            .filter(([, draftValue, currentValue]) => {
                return !deepEqual(draftValue, currentValue);
            })
            .map(([name]) => name),
    };
}

/** Parse one JSON document that must be a non-array object. */
function parseJsonObject(source: string, label: string): object {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be a JSON object`);
    return value;
}

/** Extract a compact summary from Playwright's trace JSONL inside trace.zip. */
async function summarizeTrace(tracePath: string): Promise<TraceSummary> {
    let traceSource: string;
    try {
        const result = await execFileAsync(
            "unzip",
            ["-p", tracePath, "trace.trace"],
            { encoding: "utf8", maxBuffer: TRACE_MAX_BUFFER },
        );
        traceSource = result.stdout;
    } catch (error) {
        throw new Error(
            `Could not read trace.trace from ${tracePath}: ${describeError(error)}`,
            { cause: error },
        );
    }

    const actionMethods: Record<string, number> = {};
    let playwrightVersion: string | null = null;
    let entryCount = 0;
    let actionCount = 0;
    let snapshotCount = 0;
    let screenshotCount = 0;

    for (const line of traceSource.split("\n")) {
        if (line.trim() === "") continue;
        const entry = parseTraceEntry(line);
        entryCount += 1;
        if (
            entry.type === "context-options" &&
            typeof entry.playwrightVersion === "string"
        ) {
            playwrightVersion = entry.playwrightVersion;
        }
        if (entry.type === "frame-snapshot") snapshotCount += 1;
        if (entry.type === "screencast-frame") screenshotCount += 1;
        if (
            entry.type === "before" &&
            entry.class === "Frame" &&
            typeof entry.method === "string" &&
            TRACE_ACTION_METHODS.has(entry.method)
        ) {
            actionCount += 1;
            actionMethods[entry.method] =
                (actionMethods[entry.method] ?? 0) + 1;
        }
    }

    return {
        playwrightVersion,
        entryCount,
        actionCount,
        actionMethods,
        snapshotCount,
        screenshotCount,
    };
}

function parseTraceEntry(source: string): TraceEntry {
    const value = parseJsonObject(source, "Trace entry");
    return {
        type: "type" in value ? value.type : undefined,
        class: "class" in value ? value.class : undefined,
        method: "method" in value ? value.method : undefined,
        playwrightVersion:
            "playwrightVersion" in value ? value.playwrightVersion : undefined,
    };
}

function isActionEvent(event: RunEvent): event is ActionEvent {
    return event.type === "action";
}

function collectOrigins(events: readonly ActionEvent[]): string[] {
    const origins = new Set<string>();
    for (const event of events) {
        if (event.action.type === "navigate") {
            addHttpOrigin(origins, event.action.url);
        }
        addHttpOrigin(origins, event.result.observation.url);
    }
    return [...origins];
}

function addHttpOrigin(origins: Set<string>, url: string): void {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:")
            origins.add(parsed.origin);
    } catch {
        // Malformed or non-network observations are not allowed origins.
    }
}

/**
 * Replace a recorded literal with a typed placeholder when a value looks like an
 * invocation input.
 *
 * Recalled values are the main reason a single run cannot be trusted as an
 * artifact: the run contains the fixture's password, company name, and search
 * term as literals. Two attempts are made to bind them, in decreasing
 * confidence: infer a name from the field's own identity, or, when the field
 * looks sensitive, replace it with an obviously unbound marker so review cannot
 * mistake a credential for a finished binding.
 */
function draftAction(
    action: SurfaceAction,
    inputs: Record<string, string>,
    warnings: Set<string>,
): SurfaceAction {
    if (action.type === "navigate") {
        const url = new URL(action.url);
        inputs.baseUrl = "string";
        return {
            ...action,
            url: action.url.replace(url.origin, "{{input.baseUrl}}"),
        };
    }
    if (action.type !== "fill" && action.type !== "select") return action;

    const candidate = action.target.candidates[0];
    const inputName = inferInputName(candidate);
    if (inputName !== null) {
        inputs[inputName] = "string";
        warnings.add(
            `Input ${inputName} was inferred from a field target and requires review.`,
        );
        return { ...action, value: `{{input.${inputName}}}` };
    }

    if (looksSensitive(candidate)) {
        inputs.reviewRequired = "string";
        warnings.add(
            "A sensitive-looking field could not be assigned a typed input and was replaced with a review marker.",
        );
        return { ...action, value: "{{input.reviewRequired}}" };
    }

    warnings.add(
        "The draft retains literal field values where no input binding was inferred.",
    );
    return action;
}

/**
 * Guess an input name from the identity of the field that received the value.
 *
 * This is a fixed table over the fixture vocabulary of this repository's two
 * targets, ordered from most to least specific because several entries would
 * otherwise match the same selector. Every hit is reported as a warning, since
 * the binding is a proposal a reviewer has to confirm against the artifact's
 * declared contract.
 */
function inferInputName(candidate: TargetCandidate | undefined): string | null {
    if (candidate === undefined) return null;
    const value =
        candidate.kind === "css"
            ? candidate.selector
            : candidate.kind === "label" || candidate.kind === "text"
              ? candidate.text
              : candidate.kind === "role"
                ? candidate.name
                : candidate.anchor;
    const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
    if (normalized.includes("s-user")) return "databaseAdmin";
    if (normalized.includes("s-password")) return "databasePassword";
    if (normalized === "#database" || normalized.endsWith("-database"))
        return "company";
    if (normalized.includes("username")) return "username";
    if (normalized === "#password" || normalized.endsWith("-password"))
        return "password";
    if (normalized.includes("company")) return "company";
    return null;
}

function looksSensitive(candidate: TargetCandidate | undefined): boolean {
    if (candidate === undefined) return false;
    const value = JSON.stringify(candidate).toLowerCase();
    return /password|secret|token|cookie|authorization|ssn/.test(value);
}

/**
 * Infer what a stage's landing state looked like, from the run that followed it.
 *
 * A recorded action carries no state of its own, so the only grounded signal for
 * "where did this leave us" is the *next* thing the run did: the next action's
 * target is by definition present on the page it acted on, and its URL is the
 * page a navigation opened. If neither is available the observed URL is used, and
 * if even that is empty the stage is left with a `timeout` signal and an explicit
 * warning, because a stage with no grounded detector cannot be reviewed.
 */
function inferStageDetector(
    actionEvents: readonly ActionEvent[],
    index: number,
    event: ActionEvent,
): { detector: StateDetector; warning?: string } {
    const stageId = buildStageId(index + 1);
    const ready = (
        description: string,
        signal: DetectorSignal,
    ): { detector: StateDetector } => ({
        detector: {
            id: `${stageId}-ready`,
            description,
            scope: "capability",
            signals: [signal],
        },
    });

    for (const { action: nextAction } of actionEvents.slice(index + 1)) {
        const signal = readActionSignal(nextAction);
        if (signal !== null) {
            return ready(
                "First-pass state inferred from a later observed target.",
                signal,
            );
        }
        if (nextAction.type === "navigate") {
            return ready(
                "First-pass state inferred from a later observed URL.",
                buildUrlSignal(nextAction.url),
            );
        }
    }

    const observedUrl = event.result.observation.url;
    if (observedUrl !== "") {
        return ready(
            "First-pass state inferred from the observed URL.",
            buildUrlSignal(observedUrl),
        );
    }

    return {
        detector: {
            id: `${stageId}-unresolved`,
            description: "No grounded post-action detector was found.",
            scope: "capability",
            signals: [{ kind: "timeout" }],
        },
        warning: `Stage ${String(index + 1)} has no grounded post-action detector.`,
    };
}

/** `stage-001`, `stage-002`, … by one-based position. */
function buildStageId(position: number): string {
    return `stage-${String(position).padStart(3, "0")}`;
}

/** A detector signal from an action's target, or `null` when none applies. */
function readActionSignal(action: SurfaceAction): DetectorSignal | null {
    if (action.type === "navigate" || action.type === "press") return null;
    const candidate = action.target.candidates[0];
    if (candidate === undefined) return null;
    switch (candidate.kind) {
        case "role":
            return { kind: "role", role: candidate.role, name: candidate.name };
        case "label":
            return { kind: "text", value: candidate.text, exact: true };
        case "text":
            return {
                kind: "text",
                value: candidate.text,
                exact: candidate.exact,
            };
        case "css":
        case "relative":
            return null;
    }
}

/**
 * Reduce a URL to its final path segment as a regular expression.
 *
 * A recorded URL carries generated identifiers, so matching it exactly would
 * make the detector fail on the next run. The last segment is the part that names
 * the screen; the identifier in front of it is what varies. A single-segment path
 * is already the screen name, so it is kept whole.
 */
function buildUrlSignal(url: string): DetectorSignal {
    const parsed = new URL(url);
    const segments = parsed.pathname
        .split("/")
        .filter((segment) => segment !== "");
    const lastSegment = segments.at(-1);
    const path =
        segments.length > 1 && lastSegment !== undefined
            ? `/${lastSegment}`
            : parsed.pathname === ""
              ? "/"
              : parsed.pathname;
    return { kind: "url", pattern: escapeRegExp(path) };
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Assign a first-pass risk class.
 *
 * An activation is guessed `reversible` because it is the only recorded verb that
 * can submit something. This is a conservative floor, not a judgment about the
 * flow: a reviewer decides what a specific button actually does, and the artifact
 * is where that decision is recorded.
 */
function draftRisk(action: SurfaceAction): ActionRisk {
    return action.type === "activate" ? "reversible" : "safe";
}

function buildStageDestination(
    index: number,
    stageCount: number,
    detector: StateDetector,
): StageDestination {
    if (detector.signals.some((signal) => signal.kind === "timeout"))
        return buildFailureDestination("unresolved-draft-detector");
    if (index === stageCount - 1)
        return { type: "terminal", outcome: { type: "success" } };
    return { type: "stage", stageId: buildStageId(index + 2) };
}

function buildFailureDestination(code: string): StageDestination {
    return { type: "terminal", outcome: { type: "failure", code } };
}

function describeSuccessCondition(manifest: RunManifest): string {
    if (manifest.outcome?.status === "satisfied")
        return `Observed checkpoint: ${manifest.outcome.checkpoint}`;
    return "The recorded run reaches its declared success checkpoint.";
}

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)];
}

function hasCssTarget(action: SurfaceAction): boolean {
    if (action.type === "navigate" || action.type === "press") return false;
    return action.target.candidates.some(
        (candidate) => candidate.kind === "css",
    );
}

function deepEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
