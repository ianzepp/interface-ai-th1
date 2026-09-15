---
name: capability-author
description: Capture bounded computer-use scenarios against reset browser fixtures, turn repeated runs into reviewed state-graph artifacts, and validate deterministic replay without a model in the execution loop.
---

# Capability Author

Capture what actually happens while an LLM explores an allowlisted browser
surface, then turn stable recorded behavior into a reviewed deterministic
capability.

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

`fresh` and `reset` delete only the selected target's current Docker volumes.
Never run them during an active capture. Use `up` and `stop` when the current
working state must be preserved.

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
7. Apply the policy decision, execute the action if allowed, and append the
   sanitized event evidence.
8. Repeat observe, decide, act, and record until a terminal condition occurs.
9. Stop the trace into `trace.zip` and finalize the manifest and README.

A retry after another reset is a new run with a new run identifier. Never append
a retry to the prior run.

## Terminal Outcomes

Use `satisfied` only after observing the declared checkpoint in the UI or in a
trusted target response. A model statement that the goal is complete is not
evidence by itself.

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

## Exception Capture

This phase discovers exceptions; it does not encode their recovery graph. When
an exception appears, record:

- where it occurred;
- the observable shape of the state;
- the attempted action and application response;
- whether a safe recovery was attempted;
- the resulting state; and
- whether the run ended in satisfaction or error.

Do not speculate that an unseen exception exists. Exercise deliberate red paths
only through fixture data or actions allowed by the run contract.

## Artifact and Replay Loop

Begin artifact work only after at least two successful captures agree on the
important action sequence and terminal checkpoint. A recorded action is
evidence that an action occurred; it is not automatically proof that the
serialized locator accurately describes the locator the browser library
resolved. Compare the recorder implementation, trace, and repeated observations
before approving every target.

Build the smallest reviewed state graph that covers the demonstrated path:

1. Copy only actions that occurred in the successful corpus.
2. Replace literal invocation values with typed input bindings.
3. Annotate each action with a stable post-action detector observed in the
   traces. Do not guess detectors from arbitrary page text.
4. Give every stage an explicit fallback terminal outcome.
5. Enforce the artifact's origin and action allowlists before acting.
6. Require exactly one target match. Zero or multiple matches end the stage.
7. Preserve every replay, including failures, in the same run-directory shape
   as discovery captures.
8. Reset the fixture and replay again. One success is not validation.
9. Add successful replay run IDs to artifact provenance only after checking the
   checkpoint and persisted-state assertions.

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

Docker reset and snapshot operations remain outside the browser graph. Create
or replace a named ending snapshot only after the browser checkpoint and
independent persisted-state assertions pass.

## Data Safety

- Redact passwords, tokens, cookies, authorization values, credentials, and
  known secrets before persistence.
- Use synthetic local fixture data whenever possible.
- Keep secrets out of trace titles, URLs, typed event payloads, and README text.
- Do not weaken policy or cross the allowed origin to complete a run.
- Stop on an unknown state when the next action could mutate data or escape the
  allowed surface.

## Deferred Work

Automatic graph synthesis, a formal artifact approval workflow, generalized
recovery graphs, and broad exception coverage remain deferred. Do not let those
future concerns make either the capture loop or the first reviewed replay more
elaborate than its evidence requires.
