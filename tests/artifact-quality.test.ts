import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { loadCapabilityArtifacts } from "../src/audit/artifact-catalog.js";
import {
    auditArtifact,
    type AuditFinding,
} from "../src/audit/artifact-rubric.js";

/**
 * The artifact audit, as a gate.
 *
 * Artifacts are discovered by the shared catalog rather than listed here, because
 * an audit that has to be opted into is one that eventually gets skipped. A new
 * capability is audited the moment its source exists.
 *
 * Only blocking findings gate. A blocking finding means the artifact is wrong or
 * cannot work; a warning means it is weaker than the authoring skill asks for.
 * Firing the build on warnings would train everyone to ignore it, and several of
 * these artifacts legitimately carry warnings that need a re-run rather than an
 * edit. The full list, warnings included, is what `scripts/audit-artifact` prints.
 *
 * The baseline is a ledger of known blocking findings, not an allowance. Counts
 * must match in both directions, so fixing a finding forces its entry out and a
 * stale entry cannot quietly survive. Adding a capability with a blocking finding
 * fails until someone records it here or fixes it.
 */

const BLOCKING_BASELINE: Readonly<
    Record<string, Readonly<Record<string, number>>>
> = {
    // Authored by a Codex session on an isolated lane. Both creates resolve their
    // submit by position.
    "dolibarr.create-customer-with-contact": {
        "positional-selector-on-mutating-stage": 2,
    },
    // Records no corroborating evidence runs, though the skill requires two.
    "ledgersmb.initialize-company": {
        "insufficient-corroborating-runs": 1,
    },
};

const repositoryRoot = join(import.meta.dirname, "..", "..");
const entries = await loadCapabilityArtifacts(repositoryRoot);
const artifacts = entries.map((entry) => entry.artifact);

test("discovers every committed artifact", () => {
    assert.ok(
        artifacts.length >= 3,
        `expected at least the three committed artifacts, found ${String(artifacts.length)}`,
    );
    for (const entry of entries) {
        assert.match(entry.sourcePath, /^src\/capabilities\/.+\.ts$/);
        assert.match(
            entry.artifact.id,
            /^[a-z0-9.-]+$/,
            `odd capability id: ${entry.artifact.id}`,
        );
    }
});

test("no artifact carries a blocking finding that is not recorded", () => {
    for (const artifact of artifacts) {
        const baseline = BLOCKING_BASELINE[artifact.id] ?? {};
        const findings = auditArtifact(artifact);
        const added = rulesWhere(
            countBlocking(findings),
            baseline,
            (count, expected) => count > (expected ?? 0),
        );

        assert.deepEqual(
            added,
            [],
            `blocking findings not recorded for ${artifact.id}:\n${describeBlocking(
                artifact.id,
                findings,
            )}`,
        );
    }
});

test("every recorded blocking finding is still present", () => {
    for (const artifact of artifacts) {
        const baseline = BLOCKING_BASELINE[artifact.id];
        if (baseline === undefined) continue;

        const actual = countBlocking(auditArtifact(artifact));
        const removed = rulesWhere(
            baseline,
            actual,
            (expected, count) => (count ?? 0) < expected,
        );

        assert.deepEqual(
            removed,
            [],
            `${artifact.id} no longer reports these recorded findings, so the baseline is stale: ${removed.join(", ")}`,
        );
    }
});

test("the baseline names only capabilities that exist", () => {
    const known = new Set(artifacts.map((artifact) => artifact.id));
    const orphaned = Object.keys(BLOCKING_BASELINE).filter(
        (id) => !known.has(id),
    );

    assert.deepEqual(
        orphaned,
        [],
        `baseline names unknown capabilities: ${orphaned.join(", ")}`,
    );
});

function countBlocking(
    findings: readonly AuditFinding[],
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const finding of findings) {
        if (finding.severity !== "blocking") continue;
        counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
    }
    return counts;
}

/** Rules where the left side's count satisfies `predicate` against the right. */
function rulesWhere(
    left: Readonly<Record<string, number>>,
    right: Readonly<Record<string, number>>,
    predicate: (left: number, right: number | undefined) => boolean,
): readonly string[] {
    return Object.keys(left).filter((rule) =>
        predicate(left[rule] ?? 0, right[rule]),
    );
}

function describeBlocking(
    capabilityId: string,
    findings: readonly AuditFinding[],
): string {
    return findings
        .filter((finding) => finding.severity === "blocking")
        .map(
            (finding) =>
                `  ${capabilityId}  ${finding.rule}  ${finding.subject}: ${finding.detail}`,
        )
        .join("\n");
}
