---
name: capability-author
description: Capture bounded computer-use scenarios against reset browser fixtures, turn repeated runs into reviewed state-graph artifacts, and validate deterministic replay without a model in the execution loop.
---

# Capability Author

Capture what actually happens while an LLM explores an allowlisted browser
surface, then turn stable recorded behavior into a reviewed deterministic
capability.

The unit of authoring is a corpus-building session, not one browser run. One
run is one immutable reset-to-terminal experiment. An authoring session uses as
many successful, failed, and recovered runs as needed to ground the smallest
useful state graph. The LLM may make judgments while authoring; the approved
artifact must replay without an LLM making execution decisions.

## Mission

Use this skill as the operating method for taking an unfamiliar application
from no prior knowledge to a reusable deterministic capability. The target
application is a learning environment; completing one target-specific workflow
is not the whole job. Every run should either produce grounded evidence or
improve the general authoring method.

Keep knowledge in the correct layer:

- Put exploration, recording, artifact-authoring, replay-validation, and failure
  classification instructions in this skill.
- Put reusable mechanics in generic fixture, capture, compiler, policy, engine,
  evidence, and handoff code.
- Put application and version knowledge in target profiles and capability
  artifacts, not in the generic engine.

When target work reveals a generally useful lesson, update this skill before
moving on. Examples include a mismatch between the locator recorded and the one
actually executed, a hidden transition signal, an ambiguous checkpoint, an
unrecorded human action, or an application mutation that occurs earlier than
its label suggests. Keep specific selectors, fixture identifiers, credentials,
and vendor error codes out of the general lesson.

The desired end state is that a fresh LLM can load this skill, establish a
reproducible target, explore it through bounded recorded runs, build a grounded
state graph, and prove deterministic replay without needing undocumented
knowledge from the original authoring session.

## Capture Boundary

- Start from a freshly reset fixture for every attempt.
- Treat the complete reset-to-terminal attempt as one test run.
- End a run only when the declared requirement is visibly satisfied or the run
  reaches an error.
- Save the run even when it fails, stalls, takes a wrong turn, or exposes an
  unknown UI state.
- Do not compile a stage graph during an individual capture attempt. Finish and
  preserve the run before comparing it with the corpus or editing an artifact.

## Authoring Session Boundary

Keep these three boundaries distinct:

- A **run** is one immutable reset-to-terminal attempt with its own manifest,
  event ledger, trace, screenshots, and outcome.
- An **authoring session** is the LLM-guided loop that plans, captures, compares,
  and classifies multiple runs while revising a capability draft.
- An **approved artifact** is the reviewed state graph that has passed
  deterministic replay against its admitted scenario matrix.

The first successful run should produce a typed provisional draft. This
satisfies the need to emit a structured artifact while preserving the truth
that one success cannot establish stable targets, complete detectors, runtime
branches, or safe recovery. Keep the draft marked as provisional and continue
the authoring session.

The authoring session ends only when the approval conditions in this skill are
met. A model deciding that it has seen enough is not itself evidence; the
corpus, graph review, and deterministic replay results are the evidence.

## Corpus-Level Authoring Loop

Follow this loop for each capability:

1. Define the capability contract: goal, starting state, typed inputs, typed
   outputs, success condition, allowed surface, and safety limits.
2. Establish a resettable fixture and record the reset evidence.
3. Capture one complete successful run through the real application.
4. Extract a provisional linear draft from that run. Do not approve or replay
   it unattended merely because extraction succeeded.
5. Reset and capture at least one corroborating success. Compare actions,
   targets, observations, timing, generated values, and the terminal checkpoint.
6. Review the draft into a stable happy-path graph using only grounded actions
   and observed state markers.
7. Generate a small, risk-ranked failure matrix from the capability contract,
   application behavior, assignment-required runtime classes, and surprises in
   the successful corpus.
8. Reset and capture each selected failure experiment as its own run. Change
   one relevant condition at a time so the divergence remains attributable.
9. When a known state can be recovered safely, let the LLM attempt the bounded
   recovery in the same run. If the run already terminated, use a new reset run
   to test the recovery. Never infer a recovery edge from an error-only run.
10. Compare each exception run with the current draft, classify the observed
    state, and revise the graph through explicit LLM or human judgment.
11. Replay the revised artifact without an LLM across the happy path and every
    admitted business, recovery, intervention, and hard-failure scenario.
12. Approve the artifact when the stopping conditions below hold. Otherwise,
    preserve the evidence, revise the experiment or graph, and continue the
    authoring loop.

This loop is intentionally asymmetric. Extraction and replay are mechanical.
Choosing fixtures, selecting useful failure experiments, deciding whether a
condition is recoverable, and fitting grounded evidence into the graph are
reviewable authoring judgments. A tool may align runs, extract observations,
or scaffold a proposed branch, but it must not silently decide the semantics of
an exception or make an unsupported recovery claim.

## Required Run Contract

Before touching the browser, establish:

- the user-visible goal and success condition;
- the target profile and exact target version when known;
- the fixture identifier and evidence that reset completed;
- the scenario or situation being exercised;
- typed inputs and expected outputs when known;
- action, time, and policy limits; and
- the allowed browser origin and surface.

If the fixture cannot be reset, record an error run. Do not silently reuse the
state left by an earlier attempt.

## Fixture Lifecycle

Use the same target harness for LedgerSMB and Dolibarr. A fixture is a complete,
named snapshot of every persistent Docker volume, not a browser storage state or
a committed container layer.

```sh
# Create a clean install for initial exploration.
scripts/target fresh <ledgersmb|dolibarr>

# After arranging useful synthetic data, freeze that starting point.
scripts/target snapshot <ledgersmb|dolibarr> <snapshot-name>

# Before every test run, return to exactly that starting point.
scripts/target reset <ledgersmb|dolibarr> <snapshot-name>
```

Use `<target>/<snapshot-name>` as the run's fixture identifier. A successful
reset writes `tmp/targets/<target>/last-reset.json`; treat that receipt and the
snapshot manifest as the evidence that reset completed. Start a new isolated
Playwright browser context only after the target is healthy and the receipt
exists.

Visible controls and state markers have different wait semantics. A hidden
field, metadata node, URL change, or response can prove that the application
advanced without ever becoming visible. Wait for a visible state only when the
user could actually perceive that state; wait for attachment or value change
when application-owned hidden state is the intended signal. Record the
observation after the transition signal is satisfied, not immediately after the
click that initiated it.

A URL change is not proof that a client-rendered content region has finished
transitioning. Before resolving controls on the next stage, wait for a unique
application-owned heading, landmark, or state marker from that stage. This is
especially important when consecutive screens reuse labels such as `Date`,
`Source`, `Continue`, or `Save`; otherwise a fast replay can act on the prior
screen even though the address bar already describes the next route.

Selecting an autocomplete result may start application work that populates
dependent fields after the selection control disappears. Before editing or
submitting those fields, wait for a meaningful application-derived value or
state marker. Do not substitute a fixed delay: repeated captures can pass from
a restored snapshot while a faster contiguous run exposes the unresolved race.

Treat recoverable interstitials as explicit observed branches. Detect them by a
specific state marker, execute the bounded recovery action, and then re-check
the intended stage. Do not make a generic dismissal action that could hide an
unknown warning.

`fresh` and `reset` delete only the selected target's current Docker volumes.
Never run them during an active capture. Use `up` and `stop` when the current
working state must be preserved.

### Choosing Snapshot Boundaries

Snapshot placement is an authoring judgment. Create a reusable starting
snapshot only at a stable application boundary where:

- all prerequisite records and configuration are complete;
- no request, transaction, migration, or asynchronous application update is in
  flight;
- the visible state and authoritative persisted state agree;
- the state can be described as a capability precondition without relying on
  undocumented manual repair; and
- resetting to it does not inherit output or mutation from the scenario being
  tested.

Prefer one clean snapshot that supports several input-driven scenarios. Create
a dedicated deliberately broken snapshot only when the failure depends on
persisted state that cannot be introduced safely through the scenario itself.
Document the broken invariant, expected failure shape, and recovery limits.

Do not snapshot arbitrary browser positions. Browser storage may accompany a
scenario when authentication state is part of the fixture design, but it does
not replace the persistent target snapshot. Never snapshot an uncertain
post-action state merely to avoid determining whether the action committed.

## Exploratory Setup and Learning Loop

Fixture authoring is an exploratory phase before recorded test runs. Do not
start Playwright tracing merely because an agent is learning the application or
arranging seed data. Explore manually, inspect persisted state when useful, and
record durable lessons in this skill and in snapshot documentation.

Treat visible labels as hypotheses, not semantics. A control labeled `Save`,
`Post`, `Approve`, `Receive`, or similar may update several independent kinds
of state. Observe the state before and after each important action and separate:

- configuration and identity state;
- operational state such as reservations, availability, and workflow status;
- accounting or approval state;
- inventory quantity state;
- valuation, allocation, or cost-layer state; and
- reporting or derived state.

Do not assume a draft is inert or that approval is the first mutation. Do not
assume a screen whose name suggests initialization is valid for seeding opening
state. Infer the workflow contract from observed UI transitions and persisted
records.

Enter accounting-effective dates explicitly whenever a workflow accepts them,
even when the UI permits a blank value or displays a default. An implicit date
can be interpreted differently by validation, inventory, posting, and reporting
layers, producing a run that appears successful but mutates the wrong period or
calculates from the wrong state.

Build a clean fixture in dependency order:

1. Create required configuration, identities, roles, accounts, and locations.
2. Establish source records that make later state valid, such as inventory,
   balances, or parent workflow objects.
3. Verify both the visible state and the authoritative persisted state.
4. Add downstream transactions, drafts, reservations, and approvals.
5. Exercise corrections only after their prerequisite history exists.
6. Verify invariants after each boundary before taking a clean snapshot.

When exploration reaches a contradictory or contaminated state, preserve it
only if it demonstrates a useful condition. Then return to a fresh fixture and
rebuild in the corrected order. Do not rescue an exploratory database merely to
avoid repeating setup; hidden manual repairs make later runs irreproducible.

Classify observed failures before generalizing them:

- **workflow constraint**: the application rejects an operation because its
  required history or state transition is absent;
- **state-model surprise**: the application mutates a different layer or at a
  different time than the UI suggests;
- **application defect**: the supported UI reaches an internally inconsistent,
  unauthorized, or otherwise broken implementation path; or
- **unknown**: the evidence is insufficient to distinguish the above.

Keep the classification provisional until the persisted state or a clean
reproduction supports it. One error message is evidence of the response, not a
complete explanation of the cause.

## Snapshot Documentation

Every retained named snapshot must include a human-readable `README.md` beside
its manifest and volume archives. A snapshot without historical context is not
useful evidence and should not be retained merely because it can be restored.

Document:

- the snapshot's purpose and whether it is clean, exploratory, or deliberately
  broken;
- the important records and state boundaries it contains;
- exact reset and reproduction steps;
- the expected visible outcome or failure shape;
- the current explanation and confidence or unresolved questions;
- whether the condition is a workflow constraint, state-model surprise,
  application defect, or unknown; and
- whether a recorded browser run exists.

Snapshot names are labels, not sufficient documentation. If a later discovery
changes the explanation, update the README while preserving the distinction
between facts stored in the snapshot and behavior observed only in a derived
state.

## Test Run Lifecycle

1. Reset the target fixture.
2. Create the run directory before the first model decision or browser action.
3. Write the initial `run.json`, `README.md`, and empty `events.jsonl`.
4. Start Playwright tracing with screenshots and DOM snapshots enabled.
5. Observe the current UI.
6. Ask the LLM for one bounded action through the typed computer-use interface.
7. Record the proposed action, rationale, and policy decision before execution
   so a thrown locator or browser action cannot erase evidence of the attempt.
8. Execute the action if allowed, then record its target resolution, result,
   timing, resulting observation, and error when one occurs.
9. Repeat observe, decide, act, and record until a terminal condition occurs.
10. Stop the trace into `trace.zip` and finalize the manifest and README.

A retry after another reset is a new run with a new run identifier. Never append
a retry to the prior run.

## Terminal Outcomes

Use `satisfied` only after observing the declared checkpoint in the UI or in a
trusted target response. A model statement that the goal is complete is not
evidence by itself.

A deliberate exception experiment may use the observed exception state as its
declared checkpoint and therefore end as `satisfied`. That means the experiment
proved its scenario; it does not mean the original capability goal succeeded.

Use `error` for every other terminal result, including:

- an application error or unexpected response;
- a missing, ambiguous, or changed control;
- an unknown state or unsafe next action;
- a policy denial;
- an action limit or timeout;
- a model or computer-use failure; or
- a trace start or trace stop failure.

Give errors stable, short codes and a plain-language summary. Preserve the last
useful observation and evidence reference when possible.

## Run Directory

Each run lives under `runs/<run-id>/`:

```text
runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
├── trace.zip
└── screenshots/
```

- `README.md` is the brief human account of the goal, situation, target,
  fixture, and outcome.
- `run.json` is the structured lifecycle record.
- `events.jsonl` is the ordered, sanitized event ledger.
- `trace.zip` is the Playwright trace for visual and DOM inspection.
- `screenshots/` contains meaningful checkpoints and the last useful terminal
  state when those images were captured.

Write the README when the run starts and update it when the run ends. A crashed
process should therefore leave a recognizable `running` run rather than an
unexplained trace file.

Raw run directories are local and Git-ignored. Copy only deliberately reviewed,
sanitized examples into tracked evidence later.

## Evidence Promotion

Promote a run only after it is finalized and its README, event ledger, and trace
have been reviewed for secrets and unintended customer data. Both `satisfied`
and `error` runs are useful evidence; failed runs demonstrate the observed error
shape and the system's terminal behavior.

Promote one or more reviewed runs from the repository root:

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

Promotion copies each complete run from `runs/<run-id>/` to
`evidence/runs/<run-id>/`. It leaves the raw run unchanged and refuses to
overwrite existing evidence. Treat the promoted copy as an immutable submission
record; if its contents are unsuitable, remove it through an explicit reviewed
change and promote a different run.

## Event Evidence

Record only concise operational evidence, never hidden chain-of-thought. For
each iteration, preserve enough data to reconstruct what occurred:

- observation and current URL or surface identity;
- proposed typed action and its input bindings;
- concise action rationale;
- policy decision;
- executed result, timing, and error if any;
- screenshot, trace, or response evidence reference; and
- checkpoint evaluation.

Executed observations are the source of truth. Never invent a step, locator,
output, checkpoint, or successful result. Preserve input provenance so later
artifact work can distinguish invocation values from accidental literals.

If the recorder loses an attempted action because execution threw before the
action event was appended, use the trace and terminal evidence for diagnosis
but do not claim automatic branch extraction from that ledger. Improve the
recording boundary or capture again before treating the run as complete
grounding for a recovery action.

## Targeting During Discovery

Prefer stable semantic target information in this order:

1. accessible role and name;
2. explicit label relationship;
3. stable application-owned test identifier;
4. stable nearby text plus structural context; and
5. CSS or DOM structure only as a last resort.

Record all useful target candidates that were actually observed. Do not promote
screen coordinates, generated class names, transient row positions, or guessed
selectors as durable targets. Coordinates may remain in raw evidence when that
is how the action was executed.

## Failure Discovery and Recovery Authoring

Begin deliberate failure discovery only after a provisional happy-path graph
exists. The graph gives each experiment an intended stage, expected state, and
safe reset point. Do not conduct unbounded fuzzing or mutate the fixture without
a hypothesis and a way to restore it.

### Build the Failure Matrix

Generate hypotheses; do not generate artifact facts. Consider:

- invalid, missing, boundary, or conflicting invocation inputs;
- legitimate business outcomes such as no matching record or a duplicate;
- missing prerequisite application state;
- permission or role denial;
- known confirmation dialogs and interstitials;
- session or authentication expiry;
- delayed dependent values, transient loads, and bounded timeouts;
- application errors after an action whose commit status may be uncertain; and
- weak, missing, or ambiguous targets exposed by repeated runs.

Rank candidates by realistic likelihood, consequence, value to the caller, and
whether the condition can be reproduced safely. Select a small matrix that
exercises the capability's important runtime boundaries. Broad or exhaustive
exception coverage is not required.

For each selected experiment, declare before capture:

- the current draft or artifact version and intended stage;
- the starting fixture and reset evidence;
- the single condition being changed;
- the expected observable divergence;
- whether mutation may already have occurred when the divergence appears;
- the maximum safe recovery actions; and
- the expected terminal classification if recovery does not succeed.

### Capture and Classify the Result

When an exception appears, record:

- the last recognized state and intended stage;
- the proposed or attempted action, including failures before completion;
- the observable application response and evidence references;
- the resulting visible and persisted state;
- whether a bounded recovery was attempted;
- every recovery action and the state reached after it; and
- whether the original capability goal was ultimately satisfied.

Classify the evidence after the run:

- **business outcome**: a legitimate answer the caller must handle, even though
  the requested success condition was not reached;
- **recoverable condition**: a recognized state with an observed, bounded path
  back to a declared stage;
- **intervention required**: automation cannot proceed safely, but a person can
  act on the same live session and return it to a recognized state;
- **hard failure**: the capability must stop and report a debuggable failure;
- **authoring or instrumentation defect**: the locator, detector, recorder,
  policy description, or evidence is wrong or incomplete; or
- **unknown**: the evidence does not support a stronger classification.

A run's lifecycle status and an artifact outcome are different. A run may end
as `error` while demonstrating a stable business outcome. A scenario explicitly
defined to prove an error state may end as `satisfied` when that checkpoint is
observed. Use the declared scenario and evidence, not the status word alone,
when revising the graph.

Do not encode a hypothesis merely because it is plausible. Do not call a
condition recoverable because a recovery seems obvious. A recovery edge is
grounded only when a recorded action reaches its declared destination, and an
automatic retry is allowed only when evidence establishes that repeating the
action cannot duplicate or corrupt state.

If a failed action's commit status is uncertain, inspect authoritative state
before retrying. Route to intervention or hard failure when that uncertainty
cannot be resolved safely.

### Fit Evidence into the Graph

Graph revision is an LLM or human authoring judgment, not a mechanical merge:

- Add an observed business state as another detector on the stage whose action
  produced it, then route it to a typed business outcome.
- Add a post-action recoverable state as another detector and route it to one
  or more recovery stages whose actions were observed succeeding.
- Add an actionless guard stage when a condition such as session expiry must be
  detected before the intended action.
- Resume only at a stage whose entry state was observed after recovery. Do not
  jump to a convenient stage or repeat a mutating action without evidence.
- Route a condition to intervention only when the same live session can be
  preserved and resume validation is defined.
- Keep authoring defects out of the application graph. Correct the recorder,
  locator, detector, or policy description and capture again.
- Leave unsupported and unknown states on the stage's explicit hard-failure
  fallback.

An alignment or branch-drafting tool may propose the first divergence,
candidate detector signals, or a graph patch. Treat that output as a review aid.
The author must check the run ledger, trace, screenshots, target behavior, and
persisted-state evidence before accepting it.

## Artifact and Replay Loop

After the first successful capture, extract a provisional draft from the
repository root:

```sh
npm run draft:artifact -- \
  --run runs/<successful-run-id> \
  --id <capability-id> \
  --out tmp/drafts/<capability-id>.json
```

The event ledger is the semantic action source. The Playwright trace
corroborates what the browser actually executed and supplies DOM and visual
evidence. The extractor may infer bindings, targets, detectors, and risks only
as visibly marked draft suggestions. Its output is neither approved nor safe
for unattended replay.

Reset and capture at least one corroborating success before approving the happy
path. A recorded action proves that an action occurred; it does not
automatically prove that the serialized locator accurately describes the
locator the browser library resolved. Compare the recorder implementation,
trace, and repeated observations before approving every target.

Build the smallest reviewed state graph that covers the demonstrated path:

1. Include an action only when a run recorded that action completing. The whole
   run need not have reached the original success condition, but the action and
   state it claims must be grounded.
2. Replace literal invocation values with typed input bindings.
3. Define typed outputs and extractions from values actually observed on the
   declared terminal or intermediate states.
4. Annotate each action with stable success and exception detectors observed in
   the corpus. Do not guess detectors from arbitrary page text.
5. Add only recovery actions whose run reached the state named by the recovery
   edge.
6. Give every stage an explicit fallback terminal outcome.
7. Enforce the artifact's origin and action allowlists before acting.
8. Require exactly one target match. Zero or multiple matches end the stage.
9. Preserve every replay, including failures, in the same run-directory shape
   as discovery captures.
10. Reset the fixture and replay again. One success is not validation.
11. Add successful replay run IDs to artifact provenance only after checking the
    checkpoint and persisted-state assertions.

The current artifact provenance records the primary discovery run and checked
successful replay runs. Keep exception and recovery source runs in the reviewed
corpus record unless and until the artifact schema explicitly supports
branch-level provenance. Do not place them in a field reserved for successful
replay validation.

Measure replay time at two boundaries. The replay run records browser execution
from run creation through terminal outcome, with timestamps at every action and
detector checkpoint so stage durations can be calculated. The surrounding
harness separately measures environment reset, service readiness, compilation,
and other setup costs. Do not mix harness time into capability latency or report
a single local run as a performance claim. Preserve the sample count and target
environment with any timing summary.

The engine owns graph traversal, input binding, policy evaluation, target
resolution, detector matching, extraction, and typed terminal results. The
surface driver owns browser-specific location, action, waiting, observation,
and evidence capture. The artifact owns application-specific actions and
states. Keep those responsibilities separate.

A replay failure is useful evidence. First decide whether it reveals an
application state, a weak detector, a weak target, or dishonest recording. A
strict replay should expose a serialized locator that differs from the locator
actually exercised during discovery rather than silently choosing a nearby
element.

When replay reveals a new legitimate application state, return to the authoring
loop. Preserve the replay as evidence, reproduce the condition through a
bounded recorded experiment when necessary, revise the graph through review,
and replay the revised scenario. Never let the deterministic engine ask an LLM
to decide what to do with the new state.

Docker reset and snapshot operations remain outside the browser graph. Create
or replace a named ending snapshot only after the browser checkpoint and
independent persisted-state assertions pass.

## Artifact Approval Conditions

Approve a capability only when all of the following hold:

- At least two successful captures from reset agree on the important happy-path
  actions, state transitions, and terminal checkpoint.
- Every serialized action, target, detector, extraction, and recovery edge is
  traceable to recorded evidence or an explicit reviewed correction to
  recording metadata.
- Invocation-specific values are typed inputs rather than accidental literals,
  and declared outputs have verified extraction behavior.
- Every stage has recognized destinations for its admitted states and an
  explicit fail-closed destination for everything else.
- The selected failure matrix is documented and justified by risk and value;
  unselected plausible failures are not represented as supported behavior.
- Every business outcome in the graph has been observed and replayed to the
  declared typed result.
- Every automatic recovery has been observed reaching its declared resume
  state and has been replayed without duplicate or uncertain mutation.
- Every intervention route preserves the same live session, supplies actionable
  context and evidence, and validates the state before resuming.
- Hard failures preserve enough evidence to identify the stage, expected state,
  observed divergence, and relevant trace or screenshot.
- The happy path and every admitted branch have been replayed from their named
  reset fixture without an LLM in the execution decision loop.
- The happy-path replay has succeeded more than once, and final visible and
  persisted-state assertions agree.

Approval does not claim exhaustive error coverage. It claims that the graph is
deterministic and evidence-grounded for the scenarios it explicitly admits,
and that all other states fail closed.

## Data Safety

- Redact passwords, tokens, cookies, authorization values, credentials, and
  known secrets before persistence.
- Use synthetic local fixture data whenever possible.
- Keep secrets out of trace titles, URLs, typed event payloads, and README text.
- Do not weaken policy or cross the allowed origin to complete a run.
- Stop on an unknown state when the next action could mutate data or escape the
  allowed surface.

## Deferred Work

Automatic semantic graph synthesis, automatic failure-to-branch merging, a
formal approval service, exhaustive exception discovery, and a generalized
cross-application recovery library remain deferred.

Bounded failure discovery and reviewed recovery branches are not deferred. They
are part of authoring a useful deterministic capability. Keep that work
proportional to the selected capability and its risk-ranked scenario matrix;
do not turn the assignment into a claim of exhaustive application modeling.
