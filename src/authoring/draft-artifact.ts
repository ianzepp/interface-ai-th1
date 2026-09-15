import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { DiscoveryEvent } from "./event-recorder.js";
import type { TestRunManifest } from "./run-recorder.js";
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

const execFileAsync = promisify(execFile);
const TRACE_MAX_BUFFER = 64 * 1024 * 1024;

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
    manifest: TestRunManifest;
    events: readonly DiscoveryEvent[];
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
export async function readSuccessfulRun(runDirectory: string): Promise<{
    manifest: TestRunManifest;
    events: readonly DiscoveryEvent[];
    trace: TraceSummary;
}> {
    const manifest = parseManifest(
        await readFile(join(runDirectory, "run.json"), "utf8"),
    );
    if (manifest.status !== "satisfied") {
        throw new Error(
            `Run ${manifest.runId} is ${manifest.status}; draft extraction requires a satisfied run`,
        );
    }

    const eventSource = await readFile(
        join(runDirectory, manifest.files.events),
        "utf8",
    );
    const events =
        eventSource.trimEnd() === ""
            ? []
            : eventSource
                  .trimEnd()
                  .split("\n")
                  .map((line) => parseDiscoveryEvent(line));
    if (!events.some((event) => event.type === "action")) {
        throw new Error(`Run ${manifest.runId} contains no action events`);
    }

    return {
        manifest,
        events,
        trace: await summarizeTrace(join(runDirectory, manifest.files.trace)),
    };
}

/** Extract a compact summary from Playwright's trace JSONL inside trace.zip. */
export async function summarizeTrace(tracePath: string): Promise<TraceSummary> {
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
        if (entry.type === "context-options") {
            playwrightVersion =
                typeof entry.playwrightVersion === "string"
                    ? entry.playwrightVersion
                    : playwrightVersion;
        }
        if (entry.type === "frame-snapshot") snapshotCount += 1;
        if (entry.type === "screencast-frame") screenshotCount += 1;
        if (
            entry.type === "before" &&
            typeof entry.class === "string" &&
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

/** Build a conservative, inspectable draft from one successful run. */
export function buildDraftArtifact(
    input: DraftArtifactInput,
): DraftArtifactDocument {
    const actionEvents = input.events.filter(isActionEvent);
    const origins = collectOrigins(actionEvents);
    const firstOrigin = origins[0];
    const inputs: Record<string, string> = {};
    if (firstOrigin !== undefined) inputs.baseUrl = "string";

    const warnings = new Set<string>();
    const stages = actionEvents.map((event, index) => {
        const action = draftAction(event.action, inputs, warnings);
        const detectorResult = detectorForStage(actionEvents, index, event);
        if (detectorResult.warning !== undefined)
            warnings.add(detectorResult.warning);

        return {
            id: `stage-${String(index + 1).padStart(3, "0")}`,
            description: event.rationale,
            risk: draftRisk(action),
            action,
            detectors: [detectorResult.detector],
            transitions: [
                {
                    detectorId: detectorResult.detector.id,
                    destination: destinationForStage(
                        index,
                        actionEvents.length,
                        detectorResult.detector,
                    ),
                },
            ],
            otherwise: terminalFailure("unexpected-state"),
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
        targetProfile: `${input.manifest.targetProfile}-${input.manifest.targetVersion}`,
        contract: {
            goal: input.manifest.goal,
            inputs,
            outputs: {},
            successCondition: successCondition(input.manifest),
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
    for (const event of actionEvents) {
        if (hasCssTarget(event.action)) {
            warnings.add(
                "The draft contains CSS target candidates that require selector review.",
            );
            break;
        }
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
            compareField(
                "action",
                draftStage.action,
                currentStage.action,
                equalFields,
                differentFields,
            );
            compareField(
                "detectors",
                draftStage.detectors,
                currentStage.detectors,
                equalFields,
                differentFields,
            );
            compareField(
                "risk",
                draftStage.risk,
                currentStage.risk,
                equalFields,
                differentFields,
            );
            compareField(
                "otherwise",
                draftStage.otherwise,
                currentStage.otherwise,
                equalFields,
                differentFields,
            );
            if (deepEqual(draftStage.action, currentStage.action))
                exactActionMatches += 1;
            if (deepEqual(draftStage.detectors, currentStage.detectors))
                exactDetectorMatches += 1;
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

    const differentTopLevelFields: string[] = [];
    compareField(
        "targetProfile",
        draft.targetProfile,
        current.targetProfile,
        [],
        differentTopLevelFields,
    );
    compareField(
        "contract.inputs",
        draft.contract.inputs,
        current.contract.inputs,
        [],
        differentTopLevelFields,
    );
    compareField(
        "contract.outputs",
        draft.contract.outputs,
        current.contract.outputs,
        [],
        differentTopLevelFields,
    );
    compareField(
        "policy",
        draft.policy,
        current.policy,
        [],
        differentTopLevelFields,
    );

    return {
        draftId: draft.id,
        currentId: current.id,
        draftStageCount: draft.stages.length,
        currentStageCount: current.stages.length,
        exactActionMatches,
        exactDetectorMatches,
        exactDetectorSignalMatches,
        stageComparisons,
        differentTopLevelFields,
    };
}

const TRACE_ACTION_METHODS = new Set([
    "click",
    "fill",
    "goto",
    "press",
    "selectOption",
    "type",
]);

function parseManifest(source: string): TestRunManifest {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("Run manifest must be a JSON object");
    return value as TestRunManifest;
}

function parseDiscoveryEvent(source: string): DiscoveryEvent {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("Discovery event must be a JSON object");
    return value as DiscoveryEvent;
}

function parseTraceEntry(source: string): TraceEntry {
    const value: unknown = JSON.parse(source);
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("Trace entry must be a JSON object");
    return {
        type: "type" in value ? value.type : undefined,
        class: "class" in value ? value.class : undefined,
        method: "method" in value ? value.method : undefined,
        playwrightVersion:
            "playwrightVersion" in value ? value.playwrightVersion : undefined,
    };
}

function isActionEvent(
    event: DiscoveryEvent,
): event is Extract<DiscoveryEvent, { type: "action" }> {
    return event.type === "action";
}

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

function inferInputName(
    candidate: TargetDescriptor["candidates"][number] | undefined,
): string | null {
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

function looksSensitive(
    candidate: TargetDescriptor["candidates"][number] | undefined,
): boolean {
    if (candidate === undefined) return false;
    const value = JSON.stringify(candidate).toLowerCase();
    return /password|secret|token|cookie|authorization|ssn/.test(value);
}

function detectorForStage(
    actionEvents: readonly Extract<DiscoveryEvent, { type: "action" }>[],
    index: number,
    event: Extract<DiscoveryEvent, { type: "action" }>,
): { detector: StateDetector; warning?: string } {
    for (
        let nextIndex = index + 1;
        nextIndex < actionEvents.length;
        nextIndex += 1
    ) {
        const nextAction = actionEvents[nextIndex]?.action;
        const signal = signalFromAction(nextAction);
        if (signal !== null) {
            return {
                detector: {
                    id: `stage-${String(index + 1).padStart(3, "0")}-ready`,
                    description:
                        "First-pass state inferred from a later observed target.",
                    scope: "capability",
                    signals: [signal],
                },
            };
        }
        if (nextAction?.type === "navigate") {
            return {
                detector: {
                    id: `stage-${String(index + 1).padStart(3, "0")}-ready`,
                    description:
                        "First-pass state inferred from a later observed URL.",
                    scope: "capability",
                    signals: [urlSignal(nextAction.url)],
                },
            };
        }
    }

    const observedUrl = event.result.observation.url;
    if (observedUrl !== "") {
        return {
            detector: {
                id: `stage-${String(index + 1).padStart(3, "0")}-ready`,
                description: "First-pass state inferred from the observed URL.",
                scope: "capability",
                signals: [urlSignal(observedUrl)],
            },
        };
    }

    return {
        detector: {
            id: `stage-${String(index + 1).padStart(3, "0")}-unresolved`,
            description: "No grounded post-action detector was found.",
            scope: "capability",
            signals: [{ kind: "timeout" }],
        },
        warning: `Stage ${String(index + 1)} has no grounded post-action detector.`,
    };
}

function signalFromTarget(
    target: TargetDescriptor | undefined,
): DetectorSignal | null {
    const candidate = target?.candidates[0];
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

function signalFromAction(
    action: SurfaceAction | undefined,
): DetectorSignal | null {
    if (
        action === undefined ||
        action.type === "navigate" ||
        action.type === "press"
    )
        return null;
    return signalFromTarget(action.target);
}

function urlSignal(url: string): DetectorSignal {
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

function destinationForStage(
    index: number,
    stageCount: number,
    detector: StateDetector,
): StageDestination {
    if (detector.signals.some((signal) => signal.kind === "timeout"))
        return terminalFailure("unresolved-draft-detector");
    if (index === stageCount - 1)
        return { type: "terminal", outcome: { type: "success" } };
    return {
        type: "stage",
        stageId: `stage-${String(index + 2).padStart(3, "0")}`,
    };
}

function terminalFailure(code: string): StageDestination {
    return { type: "terminal", outcome: { type: "failure", code } };
}

function draftRisk(action: SurfaceAction): ActionRisk {
    return action.type === "activate" ? "reversible" : "safe";
}

function successCondition(manifest: TestRunManifest): string {
    if (manifest.outcome?.status === "satisfied")
        return `Observed checkpoint: ${manifest.outcome.checkpoint}`;
    return "The recorded run reaches its declared success checkpoint.";
}

function collectOrigins(
    events: readonly Extract<DiscoveryEvent, { type: "action" }>[],
): string[] {
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

function hasCssTarget(action: SurfaceAction): boolean {
    if (action.type === "navigate" || action.type === "press") return false;
    return action.target.candidates.some(
        (candidate) => candidate.kind === "css",
    );
}

function compareField(
    name: string,
    left: unknown,
    right: unknown,
    equalFields: string[],
    differentFields: string[],
): void {
    if (deepEqual(left, right)) equalFields.push(name);
    else differentFields.push(name);
}

function deepEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)];
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface TraceEntry {
    type?: unknown;
    class?: unknown;
    method?: unknown;
    playwrightVersion?: unknown;
}
