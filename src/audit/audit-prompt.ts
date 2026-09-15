/**
 * The instructions for an artifact review.
 *
 * This is the judgment half of artifact review. The mechanical half lives in
 * `artifact-rubric.ts` and decides what a program can decide, cheaply and
 * repeatably. This half exists only for what a program cannot: whether a detector
 * actually means what it claims, whether a branch is real, whether the graph is
 * minimal.
 *
 * The prompt is shaped by the ways a review like this fails:
 *
 * - **Rubber-stamping.** Asked "is this good?", a model says yes. So the review is
 *   framed as a rubric with explicit questions, and reporting nothing requires
 *   justification rather than being the easy answer.
 * - **Paraphrasing the author.** A well-written artifact documents its own
 *   weaknesses. A reviewer that only repeats the artifact's own caveats has added
 *   nothing, so the prompt names that as a failure.
 * - **Editing.** The reviewer reports; it does not rewrite. Two models editing one
 *   artifact produces a file neither of them reviewed.
 * - **Redesigning.** The engine and the schema are the reviewer's premises, not
 *   its subject. A finding that needs a platform change is recorded as such rather
 *   than proposed as an artifact fix.
 *
 * INVARIANTS
 * - The skill is named by path and read, never paraphrased, so the rubric cannot
 *   drift from the real approval conditions.
 * - Every finding must cite evidence: a run id, a trace entry, a line, or a
 *   quoted field. An unevidenced finding is an opinion.
 */

export interface AuditPromptOptions {
    capabilityId: string;
    artifactPath: string;
    /** Where to write the review, so the caller does not scrape stdout. */
    reportPath: string;
    /** Findings the mechanical pass already made, so they are not re-derived. */
    mechanicalFindings: readonly string[];
}

export function buildAuditPrompt(options: AuditPromptOptions): string {
    return [
        "You are reviewing a capability artifact that another model authored. Your",
        "job is to decide whether it is trustworthy, and to report what is wrong",
        "with it. You are not here to improve it.",
        "",
        "## Read first",
        "",
        "Read `skills/capability-author/SKILL.md` in full. It is the authority on",
        "what an artifact must satisfy: the run contract, the target ranking, the",
        "detector requirements, and the artifact approval conditions. Judge this",
        "artifact against that skill, not against your own preferences.",
        "",
        "Then read the artifact:",
        "",
        `    ${options.artifactPath}`,
        "",
        "Also read the run evidence it cites, under `runs/`. The manifests,",
        "`events.jsonl`, and the screenshots are what show whether the artifact's",
        "claims about its own corpus are true.",
        "",
        "## What was already checked mechanically",
        "",
        "A deterministic rubric has already examined structure, contract",
        "consistency, selector quality, and provenance bookkeeping. These findings",
        "are known, so do not spend effort rediscovering them and do not report them",
        "again:",
        "",
        ...options.mechanicalFindings.map((finding) => `    - ${finding}`),
        "",
        "## What only you can decide",
        "",
        "Answer each of these, and cite evidence for every answer. If you cannot",
        "find evidence either way, say that explicitly rather than assuming.",
        "",
        "1. **Are the detectors meaningful?** For each stage, does its detector",
        "   actually distinguish the intended state from a neighbouring one? A",
        "   detector that would also be satisfied on the wrong page proves nothing.",
        "2. **Is the branch claim true?** The artifact advertises a",
        "   `successCondition`. Does what replay actually verifies establish it, or",
        "   does it establish something weaker?",
        "3. **Is any stage guessed rather than observed?** A target or detector that",
        "   does not follow from the cited runs is a guess, however plausible.",
        "4. **Is the graph minimal?** Are there stages that add nothing, or an",
        "   outcome modelled twice?",
        "5. **Are the claims about the corpus true?** Do the cited runs exist, agree",
        "   with each other, and support the graph that was written? Check the",
        "   approval conditions directly.",
        "6. **What did the author not admit?** The artifact and its report almost",
        "   certainly document some of their own weaknesses. Repeating those adds",
        "   nothing. Find what they missed.",
        "",
        "## How to report",
        "",
        `Write your review to \`${options.reportPath}\`, and make it the whole of your`,
        "output. Structure it as:",
        "",
        "- **Verdict** — approved, approved-with-caveats, or not approved, in one",
        "  line, followed by the single most important reason.",
        "- **Findings** — each with a severity, the stage or field it concerns, what",
        "  is wrong, and the evidence that shows it. Order by severity.",
        "- **What the rubric got wrong** — any mechanical finding you believe is a",
        "  false positive, and why.",
        "- **Platform gaps** — anything that is a limitation of the engine or schema",
        "  rather than of this artifact, named as such, because those have different",
        "  owners and must not be recorded as artifact defects.",
        "- **What you could not determine** — with the reason.",
        "",
        "## Constraints",
        "",
        "- Do not modify the artifact, the tests, or anything else. You are reviewing,",
        "  not repairing. Report only.",
        "- Do not propose redesigning the engine or the schema. They are your",
        "  premises.",
        "- Do not re-litigate the goal or the fixture.",
        "- Every finding needs evidence: a run id, a trace entry, a line number, or a",
        "  quoted field. A finding you cannot ground is not a finding.",
        `- The capability under review is \`${options.capabilityId}\`.`,
    ].join("\n");
}
