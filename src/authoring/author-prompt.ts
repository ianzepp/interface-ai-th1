/**
 * The instructions that turn one goal into one self-contained authoring session.
 *
 * The launcher's whole job is this string. Codex owns the loop — its own fixture
 * resets, its own runs, its own draft, its own artifact, its own replay
 * validation — so the prompt is the only place the harness can state what it
 * expects, and the only place it can bound what it permits. That makes it the
 * load-bearing part of scripted discovery rather than a nicety.
 *
 * It is data, not prose for a human, for three reasons:
 *
 * - **It is testable.** A prompt assembled in code can be asserted on, so
 *   "the session CLI is the only permitted way to touch the browser" stays true
 *   across edits instead of quietly eroding.
 * - **It is inspectable.** Every session writes its prompt beside its runs, so a
 *   reviewer can see exactly what the model was asked to do.
 * - **It is bounded.** Caps arrive as parameters and are restated in the prompt,
 *   so a model that ignores them is still held by them.
 *
 * INVARIANTS
 * - The skill is named by path and read by the model, never paraphrased here. A
 *   second copy of the authoring procedure would drift from the real one.
 * - The fixture reset and the action cap are stated as hard limits, because the
 *   model cannot infer either from the goal.
 */

export interface AuthorPromptOptions {
    goal: string;
    target: string;
    fixtureId: string;
    lane: string;
    /** The origin this lane's target answers on; a lane runs on its own port. */
    origin: string;
    maxRuns: number;
    maxActionsPerRun: number;
}

/** Build the instruction block passed to `codex exec`. */
export function buildAuthorPrompt(options: AuthorPromptOptions): string {
    return [
        "You are authoring one reusable capability through this repository's",
        "capability-authoring process. Work autonomously to completion; do not stop",
        "to ask for confirmation.",
        "",
        "## Read first",
        "",
        "Read `skills/capability-author/SKILL.md` in full and follow it end to end.",
        "It is the authority on the authoring loop, the run contract, the artifact",
        "approval conditions, and what counts as evidence. This prompt adds the",
        "harness facts the skill leaves to the environment; where the two overlap,",
        "the skill wins.",
        "",
        "## The goal",
        "",
        options.goal,
        "",
        "## Your environment",
        "",
        `- Target: \`${options.target}\``,
        `- Starting fixture: \`${options.fixtureId}\``,
        `- Authoring lane: \`${options.lane}\``,
        `- Target origin: \`${options.origin}\``,
        "- The repository root is your working directory.",
        "",
        "## How to drive the browser",
        "",
        "`scripts/session` is the only permitted way to touch the browser. Run",
        "`scripts/session --help` for the full grammar. It starts a long-lived",
        "session that holds the one Playwright context, the run recorder, the policy",
        "gate, and the trace, and it refuses anything outside the target's origin",
        "allowlist.",
        "",
        "Do not use any browser or computer-use tooling of your own. A run driven by",
        "another browser bypasses the recorder, so it produces no run directory, no",
        "event ledger, and no trace, and therefore grounds no artifact.",
        "",
        "Your lane name identifies which session you drive, and you must pass it to",
        `every session command as \`--lane ${options.lane}\`. Start a session with:`,
        "",
        `    scripts/session start --lane ${options.lane} --origin ${options.origin}`,
        "",
        `The \`--origin\` value matters: this lane answers on its own port, and a`,
        "session started without it would be refused by the allowlist the session",
        "enforces. Then observe before every decision, record a checkpoint with a",
        "screenshot at each meaningful proof point, and finish the run with a",
        "declared outcome. One action per turn: observe, decide, act.",
        "",
        "## How to run the corpus",
        "",
        "The skill's unit of authoring is a corpus, not a run. Work the loop:",
        "",
        `1. Reset the fixture with \`scripts/target reset ${options.target} <snapshot>\``,
        "   immediately before each attempt, and never while a session is running.",
        "2. Capture at least two successful runs from the same reset fixture.",
        "3. Extract a provisional draft with `npm run draft:artifact`, then review it",
        "   against the whole corpus rather than trusting it.",
        "4. Write the reviewed artifact to `src/capabilities/`, add or adjust a",
        "   deterministic replay runner under `src/runtime/`, and add focused tests.",
        "5. Validate with `npm run build` and the replay command, from the named reset",
        "   fixture, for the happy path and for every branch you claim.",
        "6. When replay reveals a state you did not model, go back to step 3 rather",
        "   than loosening the artifact.",
        "",
        "Never encode a branch you did not observe. An unobserved state belongs on",
        "the stage's fail-closed `otherwise`, not in a guess.",
        "",
        "## Hard limits",
        "",
        `- At most ${String(options.maxRuns)} recorded runs in total.`,
        `- At most ${String(options.maxActionsPerRun)} browser actions in any one run.`,
        "- Do not run `scripts/target fresh`, `snapshot`, or `destroy`. Resetting to",
        "  the named fixture is the only fixture operation you may perform.",
        "- Do not commit. Leave the working tree for review.",
        "- Do not modify anything under `evidence/`.",
        "- Never write a credential into an event ledger, a README, a screenshot, or",
        "  an artifact. Authentication happens outside the recorded run.",
        "",
        "## When you finish",
        "",
        `Write a short report to \`tmp/discovery/${options.lane}/report.md\` containing: the capability`,
        "id and artifact path; the run ids you produced and which are which; the",
        "replay command and its typed result; which branches you proved and which you",
        "did not; and anything you cut. Then state the same summary in your final",
        "message.",
        "",
        "If you cannot reach `scripts/session`, stop and report the failure rather",
        "than falling back to another browser mechanism.",
    ].join("\n");
}
