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
 * The method sections mirror `skills/capability-author/SKILL.md` phase by phase
 * rather than summarizing it, because the first version of this prompt compressed
 * a twelve-step loop into six happy-path steps. It omitted failure discovery and
 * recovery authoring entirely — the phases the skill says are *not* deferred — and
 * the artifacts that came out had no exception branches at all. A prompt that
 * tells a model to stop after two successes gets a happy-path-only artifact every
 * time, which is exactly what happened.
 *
 * INVARIANTS
 * - The skill is named by path and read by the model, never paraphrased here. This
 *   prompt adds the harness facts the skill leaves to the environment; where the
 *   two overlap, the skill wins.
 * - Fixture permissions are stated as they actually are. The repository rule is
 *   "no fixture operation during an active capture", not "never touch the
 *   fixture", and `scripts/target` enforces it.
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
        "approval conditions, and what counts as evidence. This prompt supplies the",
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
        "## The authoring method",
        "",
        "The skill's unit of authoring is a corpus-building session, not one run, and",
        "its approval conditions are corpus-level. Work the loop in order.",
        "",
        "**1. Establish the fixture.** Reset to the named starting fixture before the",
        "first attempt. If the scenario needs seed data before it is even possible,",
        "arrange it, verify the visible and persisted state agree, and freeze it with",
        "`scripts/target snapshot` so later attempts return to it instead of",
        "rebuilding it. Snapshot placement is an authoring judgment.",
        "",
        "**2. Capture the happy path.** Capture at least two successful runs from the",
        "same reset fixture. Confirm they agree on the actions, state transitions,",
        "and terminal checkpoint. One success establishes nothing about what is",
        "stable.",
        "",
        "**3. Extract a provisional draft** with `npm run draft:artifact`, then",
        "review it against the whole corpus rather than trusting it. It is a marked",
        "starting point, not an answer.",
        "",
        "**4. Build a small failure matrix.** This phase is not optional and is not",
        "deferred: the approval conditions depend on it, and a capability that only",
        "works on the happy path is not useful. Generate hypotheses from the",
        "capability contract, the application's behavior, and anything surprising in",
        "the successful corpus. Candidate classes worth considering:",
        "",
        "- invalid, missing, boundary, or conflicting invocation inputs;",
        "- legitimate business outcomes such as no matching record or a duplicate;",
        "- missing prerequisite application state;",
        "- permission or role denial;",
        "- confirmation dialogs and interstitials;",
        "- session or authentication expiry;",
        "- weak, missing, or ambiguous targets exposed by repeated runs.",
        "",
        "Rank them by likelihood, consequence, and value to the caller, then select a",
        "small matrix. Exhaustive coverage is not required; the capability's",
        "important runtime boundaries are.",
        "",
        "**5. Capture each selected experiment as its own run.** Change one relevant",
        "condition at a time so the divergence stays attributable, and reset before",
        "each one. A deliberate exception experiment may declare the observed",
        "exception as its checkpoint and end `satisfied`; that means the experiment",
        "proved its scenario, not that the capability goal succeeded.",
        "",
        "**6. Recover inside the run when recovery is bounded and safe.** The skill",
        "permits attempting it in the same run. If the run already terminated, test",
        "the recovery in a new run after a reset. Never infer a recovery edge from an",
        "error-only run, and never retry a mutating action whose commit status is",
        "uncertain.",
        "",
        "**7. Classify before you model.** Each observed exception is one of: a",
        "business outcome, a recoverable condition, an intervention requirement, a",
        "hard failure, an authoring or instrumentation defect in your own harness, or",
        "unknown. Keep the classification provisional until the evidence supports",
        "it. An authoring defect is yours to fix; it does not belong in the graph.",
        "",
        "**8. Fit the evidence into the graph.** Add an observed business state as",
        "another detector on the stage that produced it, routed to a typed outcome.",
        "Add a recovery stage only where a recorded action reached the state the edge",
        "names. Leave every unsupported state on the stage's fail-closed `otherwise`.",
        "Never encode a branch you did not observe.",
        "",
        "**9. Replay everything you claim.** The happy path and every admitted",
        "business, recovery, intervention, and hard-failure scenario, each from its",
        "named reset fixture, with no model in the execution decision loop. One",
        "successful replay is not validation.",
        "",
        "**10. Stop only when the skill's approval conditions hold.** Preserve the",
        "evidence, revise the experiment or the graph, and continue otherwise. A",
        "model deciding it has seen enough is not itself evidence.",
        "",
        "## Exploration, and when to reset",
        "",
        "You decide how much to explore inside a run and how much to isolate, and both",
        "shapes are legitimate:",
        "",
        "- **Exploring inside one run.** Try a case, observe what the application",
        "  does, and continue in the same run to collect more. Efficient while you are",
        "  still finding out how the application behaves, and an unexpected result",
        "  here is data rather than a dead run.",
        "- **One clean condition per run, after a reset.** Slower, but the divergence",
        "  is attributable, which is what a graph depends on.",
        "",
        "A run that *grounds a branch* in the artifact must be the second shape: reset",
        "first, one condition changed. If you explored past an unexpected state",
        "instead, say so in that run's README and outcome, and treat what it showed as",
        "exploratory evidence rather than as a grounded branch.",
        "",
        "## Fixture operations",
        "",
        "- `scripts/target reset <target> <snapshot>` before each attempt. This is",
        "  yours to run, and you should run it yourself.",
        "- `scripts/target snapshot <target> <name>` when you have arranged a state",
        "  worth returning to, including a deliberately broken state when a failure",
        "  depends on persisted data that cannot be reached through the UI. A",
        "  snapshot you create lands in this lane's own copy, so name it in your final",
        "  message if it is worth keeping.",
        "- `scripts/target fresh` and `scripts/target destroy` are not yours. Lane",
        "  provisioning and teardown belong to the launcher.",
        "- No fixture operation while a session is live. `scripts/target` enforces",
        "  this and will refuse; finish or stop the session first.",
        "",
        "## Hard limits",
        "",
        `- At most ${String(options.maxRuns)} recorded runs in total. A failure matrix`,
        "  needs room, so budget for the happy path plus the experiments.",
        `- At most ${String(options.maxActionsPerRun)} browser actions in any one run.`,
        "- Do not commit. Leave the working tree for review.",
        "- Do not modify anything under `evidence/`.",
        "- Never write a credential into an event ledger, a README, a screenshot, or",
        "  an artifact. Authentication happens outside the recorded run.",
        "",
        "## When you finish",
        "",
        `Write a short report to \`tmp/discovery/${options.lane}/report.md\` containing: the capability`,
        "id and artifact path; the run ids you produced and which are which, marking",
        "each as happy path, exception experiment, recovery, or replay; the failure",
        "matrix you selected and why; which branches you proved and which you did",
        "not, and any state left on a fail-closed `otherwise`; the replay command and",
        "its typed result; any snapshot worth keeping; and anything you cut. Then",
        "state the same summary in your final message.",
        "",
        "If you cannot reach `scripts/session`, stop and report the failure rather",
        "than falling back to another browser mechanism.",
    ].join("\n");
}
