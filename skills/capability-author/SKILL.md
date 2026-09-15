---
name: capability-author
description: Run bounded computer-use discovery scenarios against reset local browser fixtures and preserve every attempt as a Playwright-backed test-run record. Use for capture and exploration; deterministic artifact generation and replay are deliberately deferred.
---

# Capability Author

Capture what actually happens while an LLM explores an allowlisted browser
surface. The current phase produces evidence, not a deterministic capability.

## Current Boundary

- Start from a freshly reset fixture for every attempt.
- Treat the complete reset-to-terminal attempt as one test run.
- End a run only when the declared requirement is visibly satisfied or the run
  reaches an error.
- Save the run even when it fails, stalls, takes a wrong turn, or exposes an
  unknown UI state.
- Do not compile a stage graph, generate a replay artifact, or repair an existing
  artifact during this phase.

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
└── trace.zip
```

- `README.md` is the brief human account of the goal, situation, target,
  fixture, and outcome.
- `run.json` is the structured lifecycle record.
- `events.jsonl` is the ordered, sanitized event ledger.
- `trace.zip` is the Playwright trace for visual and DOM inspection.

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

## Data Safety

- Redact passwords, tokens, cookies, authorization values, credentials, and
  known secrets before persistence.
- Use synthetic local fixture data whenever possible.
- Keep secrets out of trace titles, URLs, typed event payloads, and README text.
- Do not weaken policy or cross the allowed origin to complete a run.
- Stop on an unknown state when the next action could mutate data or escape the
  allowed surface.

## Deferred Work

Stage-graph synthesis, deterministic artifact compilation, artifact approval,
replay, and recovery validation begin only after the capture corpus is useful.
Do not let those future concerns make the capture loop more elaborate than the
evidence requires today.
