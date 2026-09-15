import type {
    CapabilityArtifact,
    CapabilityStage,
} from "../runtime/state-machine.js";
import type { LocatorCandidate } from "../surfaces/surface-driver.js";
import { targetProfiles } from "../targets/index.js";

/**
 * The mechanical half of artifact review.
 *
 * Artifact review has two layers and they should not be confused. This layer
 * decides what a program can decide: structural integrity, contract consistency,
 * and the selector and detector properties that the authoring skill states as
 * rules. The other layer is judgment — whether a detector is *meaningful*,
 * whether a branch is real, whether the graph is minimal — and that needs a
 * model reading the corpus.
 *
 * The split matters because a lint and a model fail differently. A lint cannot be
 * talked out of a finding and cannot hallucinate one, so anything it can decide
 * should never be delegated to a model: that spends money to get a less reliable
 * answer. Every rule here is decidable from the artifact alone, with no run
 * evidence and no network, which is what lets it run inside `npm run verify`.
 *
 * Rules are graded rather than binary. `blocking` means the artifact is wrong or
 * cannot work; `warning` means it is weaker than the skill asks for; `note`
 * records a fact a reviewer should weigh. A finding always names its subject so a
 * reader can go straight to the offending stage or field.
 *
 * LIMITS
 * - Nothing here reads `runs/`. Cross-checking provenance against the run evidence
 *   on disk is a separate, non-hermetic pass, so this stays usable on a fresh clone.
 * - A rule sees structure, not intent. It can prove that a fill is not verified by
 *   its own detector; it cannot prove the detector is the right one.
 */

export type AuditSeverity = "blocking" | "warning" | "note";

export interface AuditFinding {
    rule: string;
    severity: AuditSeverity;
    /** The stage, field, or id the finding is about. */
    subject: string;
    detail: string;
}

/**
 * Selectors whose meaning is position rather than identity.
 *
 * The skill ranks CSS last and warns against structural targeting, but this is
 * the sharper case: a positional selector resolves to whatever happens to be
 * first, so a reordered form silently acts on a different control. On a stage that
 * creates or destroys something, that is the difference between saving a record
 * and cancelling one.
 */
const POSITIONAL_SELECTOR =
    /:(first|last|only|nth)(-last)?-(of-type|child)|:nth-child|:nth-of-type|[+~]/;

/** Signal kinds that can observe the page's content rather than its address. */
const CONTENT_SIGNALS = new Set(["text", "role", "count"]);

export function auditArtifact(
    artifact: CapabilityArtifact,
): readonly AuditFinding[] {
    const findings: AuditFinding[] = [];
    const stages = new Map(artifact.stages.map((stage) => [stage.id, stage]));

    findings.push(...auditTargetProfile(artifact));
    findings.push(...auditPolicy(artifact));
    findings.push(...auditProvenance(artifact));
    findings.push(...auditGraph(artifact, stages));

    for (const stage of artifact.stages) {
        findings.push(...auditTargets(stage));
        findings.push(...auditDetectors(stage));
    }

    findings.push(...auditContract(artifact));

    return findings;
}

/**
 * The declared target profile must resolve.
 *
 * This is the rule that caught all three committed artifacts at once: they declare
 * `<profile>-<version>` while the registry resolves a bare id, so anything that
 * ever resolved this field would throw. Nothing reads it yet, which is precisely
 * why the drift survived review.
 */
function auditTargetProfile(
    artifact: CapabilityArtifact,
): readonly AuditFinding[] {
    if (
        targetProfiles.some((profile) => profile.id === artifact.targetProfile)
    ) {
        return [];
    }
    return [
        {
            rule: "target-profile-unresolvable",
            severity: "blocking",
            subject: "targetProfile",
            detail: `'${artifact.targetProfile}' is not a registered profile id (${targetProfiles
                .map((profile) => profile.id)
                .join(", ")}); resolving it would throw`,
        },
    ];
}

/**
 * Policy origins should belong to the target, not to the machine that wrote them.
 *
 * An artifact authored on an isolated lane picks up that lane's port, which binds
 * a reusable capability to one throwaway instance.
 */
function auditPolicy(artifact: CapabilityArtifact): readonly AuditFinding[] {
    const profile = resolveProfile(artifact.targetProfile);
    if (profile === undefined) return [];

    return artifact.policy.allowedOrigins
        .filter((origin) => !profile.allowedOrigins.includes(origin))
        .map((origin) => ({
            rule: "origin-outside-target-profile",
            severity: "warning" as const,
            subject: "policy.allowedOrigins",
            detail: `'${origin}' is not an origin of ${profile.id} (${profile.allowedOrigins.join(", ")}); an artifact authored on a lane binds itself to that lane`,
        }));
}

/** The skill's corroboration and replay conditions, as far as the artifact records them. */
function auditProvenance(
    artifact: CapabilityArtifact,
): readonly AuditFinding[] {
    const findings: AuditFinding[] = [];
    const evidence = artifact.provenance.evidenceRunIds ?? [];

    if (evidence.length < 2) {
        findings.push({
            rule: "insufficient-corroborating-runs",
            severity: "blocking",
            subject: "provenance.evidenceRunIds",
            detail: `the skill requires at least two successful captures that agree; ${String(evidence.length)} recorded`,
        });
    }
    if (
        evidence.length > 0 &&
        !evidence.includes(artifact.provenance.discoveryRunId)
    ) {
        findings.push({
            rule: "discovery-run-not-in-evidence",
            severity: "note",
            subject: "provenance.discoveryRunId",
            detail: `'${artifact.provenance.discoveryRunId}' is not among the cited evidence runs`,
        });
    }
    if ((artifact.provenance.validatedRunIds ?? []).length === 0) {
        findings.push({
            rule: "no-validated-replay",
            severity: "blocking",
            subject: "provenance.validatedRunIds",
            detail: "no deterministic replay is recorded as validating this artifact",
        });
    }
    return findings;
}

/** Structural integrity: every referenced stage exists and every stage is reachable. */
function auditGraph(
    artifact: CapabilityArtifact,
    stages: ReadonlyMap<string, CapabilityStage>,
): readonly AuditFinding[] {
    const findings: AuditFinding[] = [];

    if (!stages.has(artifact.entryStageId)) {
        findings.push({
            rule: "entry-stage-missing",
            severity: "blocking",
            subject: "entryStageId",
            detail: `'${artifact.entryStageId}' is not a declared stage`,
        });
        return findings;
    }

    for (const stage of artifact.stages) {
        for (const destination of destinationsOf(stage)) {
            if (
                destination.type === "stage" &&
                !stages.has(destination.stageId)
            ) {
                findings.push({
                    rule: "dangling-transition",
                    severity: "blocking",
                    subject: stage.id,
                    detail: `transitions to undeclared stage '${destination.stageId}'`,
                });
            }
        }
        for (const transition of stage.transitions) {
            if (!stage.detectors.some((d) => d.id === transition.detectorId)) {
                findings.push({
                    rule: "transition-detector-undeclared",
                    severity: "blocking",
                    subject: stage.id,
                    detail: `transition names detector '${transition.detectorId}', which this stage does not declare`,
                });
            }
        }
    }

    const reachable = reachableStages(artifact, stages);
    for (const stage of artifact.stages) {
        if (!reachable.has(stage.id)) {
            findings.push({
                rule: "unreachable-stage",
                severity: "blocking",
                subject: stage.id,
                detail: "no path from the entry stage reaches this stage",
            });
        }
    }
    return findings;
}

/** Selector quality on the stages that can change something. */
function auditTargets(stage: CapabilityStage): readonly AuditFinding[] {
    const action = stage.action;
    // Only an activation can change state on its own. A mis-targeted fill types
    // into the wrong box, which the stage's own detector should catch; a
    // mis-targeted click submits or cancels, and that is the failure worth
    // blocking on. Scoping here is also what keeps this rule quiet enough to be
    // read: every fill in a form would otherwise report.
    if (action?.type !== "activate") return [];
    if (stage.risk === "safe") return [];

    const findings: AuditFinding[] = [];
    const positional = action.target.candidates.filter(
        (candidate) =>
            candidate.kind === "css" &&
            POSITIONAL_SELECTOR.test(candidate.selector),
    );
    for (const candidate of positional) {
        if (candidate.kind !== "css") continue;
        findings.push({
            rule: "positional-selector-on-mutating-stage",
            severity: "blocking",
            subject: stage.id,
            detail: `risk '${stage.risk}' activation resolves by position ('${candidate.selector}'); a reordered form would act on a different control`,
        });
    }
    if (
        positional.length === 0 &&
        action.target.candidates.every((candidate) => candidate.kind === "css")
    ) {
        findings.push({
            rule: "structural-selector-on-mutating-stage",
            severity: "warning",
            subject: stage.id,
            detail: `risk '${stage.risk}' activation resolves only by CSS; the skill ranks role or label candidates above structure`,
        });
    }
    return findings;
}

/**
 * Whether a stage can verify its own effect.
 *
 * A fill or select does not change the URL, so a stage whose only detectors watch
 * the URL cannot observe whether it worked. The mistake then surfaces one stage
 * later, attributed to the submit rather than to the entry that did not take.
 */
function auditDetectors(stage: CapabilityStage): readonly AuditFinding[] {
    const action = stage.action;
    if (action === undefined) return [];
    if (action.type !== "fill" && action.type !== "select") return [];

    const observesContent = stage.detectors.some((detector) =>
        detector.signals.some((signal) => CONTENT_SIGNALS.has(signal.kind)),
    );
    if (observesContent) return [];

    return [
        {
            rule: "stage-cannot-verify-its-effect",
            severity: "warning",
            subject: stage.id,
            detail: `a '${action.type}' does not change the address, so its detectors cannot show that the value took`,
        },
    ];
}

/** Contract consistency: declared inputs are used and declared outputs are produced. */
function auditContract(artifact: CapabilityArtifact): readonly AuditFinding[] {
    const findings: AuditFinding[] = [];
    const templates = artifact.stages.flatMap((stage) => templatesOf(stage));
    const extracted = new Set(
        artifact.stages.flatMap((stage) =>
            stage.extractions.map((extraction) => extraction.name),
        ),
    );

    for (const name of Object.keys(artifact.contract.inputs)) {
        if (!templates.some((template) => template === name)) {
            findings.push({
                rule: "declared-input-never-used",
                severity: "warning",
                subject: `contract.inputs.${name}`,
                detail: "declared as an input but no action or target binds it",
            });
        }
    }
    for (const name of Object.keys(artifact.contract.outputs)) {
        if (!extracted.has(name)) {
            findings.push({
                rule: "declared-output-never-extracted",
                severity: "blocking",
                subject: `contract.outputs.${name}`,
                detail: "declared as an output but no stage extracts it, so success cannot return it",
            });
        }
    }
    return findings;
}

/** Resolve a profile, tolerating the `<id>-<version>` form the drafts emit. */
function resolveProfile(targetProfile: string) {
    const direct = targetProfiles.find(
        (profile) => profile.id === targetProfile,
    );
    if (direct !== undefined) return direct;

    const base = targetProfile.slice(0, targetProfile.indexOf("-"));
    if (base === "") return undefined;
    return targetProfiles.find((profile) => profile.id === base);
}

function destinationsOf(stage: CapabilityStage) {
    return [
        ...stage.transitions.map((transition) => transition.destination),
        stage.otherwise,
    ];
}

function reachableStages(
    artifact: CapabilityArtifact,
    stages: ReadonlyMap<string, CapabilityStage>,
): ReadonlySet<string> {
    const reached = new Set<string>([artifact.entryStageId]);
    const pending = [artifact.entryStageId];

    while (pending.length > 0) {
        const stage = stages.get(pending.pop() ?? "");
        if (stage === undefined) continue;
        for (const destination of destinationsOf(stage)) {
            if (destination.type !== "stage") continue;
            if (reached.has(destination.stageId)) continue;
            reached.add(destination.stageId);
            pending.push(destination.stageId);
        }
    }
    return reached;
}

/** Input names bound anywhere in a stage's actions, targets, or extractions. */
function templatesOf(stage: CapabilityStage): readonly string[] {
    const names: string[] = [];
    const action = stage.action;
    if (action !== undefined) {
        if ("url" in action) names.push(...boundNames(action.url));
        if ("value" in action) names.push(...boundNames(action.value));
        if ("target" in action) {
            names.push(
                ...candidateText(action.target.candidates).flatMap(boundNames),
            );
        }
    }
    for (const extraction of stage.extractions) {
        names.push(
            ...candidateText(extraction.target.candidates).flatMap(boundNames),
        );
    }
    return names;
}

function candidateText(
    candidates: readonly LocatorCandidate[],
): readonly string[] {
    return candidates.map((candidate) =>
        "selector" in candidate
            ? candidate.selector
            : "name" in candidate
              ? `${candidate.role} ${candidate.name}`
              : "text" in candidate
                ? candidate.text
                : "",
    );
}

function boundNames(source: string): readonly string[] {
    return [...source.matchAll(/\{\{input\.([A-Za-z0-9_]+)\}\}/g)].map(
        (match) => match[1] ?? "",
    );
}
