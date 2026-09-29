---
document: REPORT.md
title: Computer-use automation for legacy bank back-office applications
submission: interface.ai engineering take-home
report-version: 1.0.0
date: 2026-09-29
author: Ian Zepp
evidence: evidence/
reviewed-artifacts: 3
evidence-runs: 16
verification: npm run verify (159 tests)
repository: https://github.com/ianzepp/interface-ai-th1
---

# Architecture

Two planes, joined by one reviewed artifact.

**Discovery is probabilistic.** An external model host — the Codex CLI, with
its configured default `gpt-6-sol` for the 2026-09-29 run — receives a goal
and a reset Docker fixture. It drives a live
browser one observed action at a time through `scripts/session`, a CLI over a
Unix socket to a long-lived session process. The session holds the one
Playwright context, the policy gate, the recorder, and the trace. Every action
must cite the latest observation. Its proposal and policy verdict are written
to the ledger _before_ it runs, so a refused action leaves evidence instead of
a gap.

**Replay is deterministic.** `src/runtime/engine.ts` walks a reviewed artifact
and never asks a model anything. It binds inputs, refuses a runtime policy that
differs from the artifact's, checks the origin, requires exactly one target
match, acts, waits for a declared detector, extracts typed outputs, and follows
one explicit transition.

Three decisions carry the rest.

- **The model host stays outside the repository.** There is no model SDK and no
  second agent loop. The repository owns what must be trustworthy — the policy
  gate, the recorder, the lease, and the evidence — and the host owns the
  judgment. A launcher seals a producer record before the host starts and folds
  in the host's session id and a digest of its event stream afterwards.
  Promotion refuses a discovery run without that attestation.
- **Fixture lifecycle stays outside the graph.** Docker `fresh`, `snapshot`,
  and `reset` are harness operations, never stages. A capability that reset its
  own fixture could not run against another institution's data.
- **Artifacts are reviewed code, not generated output.** `npm run
draft:artifact` extracts a provisional linear graph from a run, with a warning
  list. Which states are stable, which failures are business outcomes, and which
  recoveries are safe is judgment that no single trace contains.

A **run** is one immutable reset-to-terminal attempt, saved whether it
succeeded or not. A **corpus** is the runs behind one artifact. An
**artifact** is the reviewed graph that replay executes.

# Artifact schema

A `CapabilityArtifact` is a versioned **state graph**. A transcript records one
path through an application. A graph says which states replay recognizes and
what each one means, which is the only way to answer "what happens when the page
is not where the recording left it?"

It has four review surfaces:

- **`contract`** — goal, typed inputs, typed outputs, and a prose
  `successCondition`. A reviewer or a calling agent can judge the capability
  without reading its steps.
- **`stages`** — at most one action each, a risk class, detectors, typed
  extractions, explicit transitions, and a fail-closed `otherwise`.
- **`policy`** — allowed origins, allowed action types, and irreversible-action
  treatment.
- **`provenance`** — the discovery run, the supporting corpus, and the
  validating replays, each resolvable in `evidence/runs/`.

**Targeting is schema, not driver detail.** A `TargetDescriptor` holds an
ordered candidate list and `require: "exactly-one"`. Zero matches is _missing_,
several is _ambiguous_, and neither falls through to a convenient first match:
silently picking one of two identical records is worse than stopping.
Candidates are ranked by meaning. Accessible role and name come first, then
label, a stable application-owned id, and nearby text with structure; CSS comes
last. The schema cannot enforce that order, which is one reason review exists.

**Detector `scope`** (`runtime`, `target`, `capability`) is the reuse lever. A
lost session belongs to the application, and so to a shared target profile.
"Results are visible" belongs to one capability.

`schemas/capability.schema.json` defines the vocabulary with typed `$ref`s and
`additionalProperties: false`. The test suite validates every committed artifact
against it, and every promoted replay result against `result.schema.json`. The
three reviewed artifacts are exported as JSON to `evidence/capabilities/`.

# Determinism & error handling

Determinism comes from removing every choice. Replay binds inputs, verifies
policy, checks the origin, requires one match, acts, and routes on the first
detector that fires. Every stage declares an `otherwise`, so an unrecognized
state cannot continue by default. Waiting is detector-based, never a fixed
sleep.

The result contract separates a legitimate answer from a defect:

| Result                  | Meaning                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `success`               | Declared outputs; the success checkpoint was verified.                                                        |
| `business-outcome`      | A real answer with a code, such as `third-party-not-found`. Not an error.                                     |
| `intervention-required` | A person is needed: a declared state such as `authentication-required`, or an irreversible action to confirm. |
| `failure`               | Unrecoverable. Carries the stage, what was expected, what was observed, and evidence.                         |

Results from the current engine also carry a `recoveries` array, empty on a
clean run.

The Dolibarr lookup proves this end to end:

- Two happy replays returned byte-identical six-field outputs.
- `third-party-not-found` has its own replay.
- `third-party-ambiguous` has its own replay, for two records with the same
  exact name.
- `authentication-required` has its own replay: a protected route redirects to
  login, and replay stops instead of entering a credential.
- Re-running the happy and ambiguous replays on 2026-09-29, fourteen days
  later, returned the same outputs and outcome (`…c8587ea8`, `…e11cb309`).

Discovery of that lookup took 25.6–42.5 seconds across five runs. Replay took
0.13–0.86 seconds across six.

**One retained failure is worth more than the successes.** Run
`20260915202607595-f1eee304` failed with `stage-execution-failed` at
`open-result`. It observed `Missing target [{"kind":"text","text":"{{input.name}}"…}]`
and attached a screenshot: input binding covered detector targets but not
action targets. A lenient first-match fallback would have absorbed the bug
into a plausible replay. Instead the failure named its own stage, and the fix
has a test.

**Recoverable conditions** have a contract but no committed use. A transition
may declare a `recovery` with a named condition, a source run, and a
`maxAttempts` cap. The engine counts each declaration per run and reports it
in `recoveries` and on the ledger. It fails with `recovery-exhausted` before
repeating the action past the cap, and it never retries a mutating action
whose commit is uncertain. Tests prove this against a test-local artifact. No
committed artifact yet declares one, because no recorded run has shown a
recovery reaching its resume state.

**Drift** is detected only in the sense that it fails closed: a changed screen
matches no detector and returns `failure` naming the stage.

# Heterogeneity & multi-tenant

`SurfaceDriver` is the seam: `observe`, `locate`, `act`, `waitFor`, `extract`,
and `captureEvidence`. An artifact is recorded against a surface, never against
a browser. A legacy frameset app, an accessibility-tree desktop client, or a
screenshot-and-coordinates controller can implement those six operations
without touching the schema or the engine.

Two properties matter more than the list:

- `waitFor` takes detectors rather than a duration, so "ready" means a
  recognized state, never an elapsed time.
- `extract` is separate from `captureEvidence`. Outputs are data the caller
  asked for; evidence is what a person reads when something broke.

Candidate kinds follow the same line. `role` and `label` exist on desktop
accessibility trees too, and `css` is the one kind that is web-only.

Multi-tenant reuse is why target knowledge is split out of capabilities. A
`TargetProfile` holds what is true of a whole application: supported versions,
allowed origins, and detectors for states any flow in that product can hit.
So a version bump changes one profile instead of every flow.

A production registry would work like this:

- Key a base artifact by vendor, product, and version range.
- Apply reviewed tenant overlays for origins, labels, and locator alternatives.
- Qualify a new tenant or version by replaying the existing corpus against it.
- Promote only what passed, and fail closed when no supported profile matches.

The replay corpus is the drift detector. The fail-closed `otherwise` is what
makes it safe to run.

**Honest limit.** This section is design. One driver exists, and the `relative`
candidate kind throws. There is no overlay mechanism and no version-range
matching.

# Escalation & handoff

"Stuck" is detected in three places:

- **During discovery, by the model.** `scripts/session escalate --reason` lets
  the automation say it cannot safely decide. The discovery prompt states this
  as a general rule and never names a scenario.
- **During replay, by the artifact.** A recognized state can route to a
  declared `intervention-required` outcome, such as `authentication-required`.
- **By policy, for irreversible actions.** Under
  `riskyActionMode: "require-confirmation"`, the gate returns
  `intervention-required` instead of acting.

**Control is a lease.** `ControlLease` gives the session one owner at a time,
`automation` or `human`, with an epoch that increases on every transfer. A
transfer is a compare-and-swap, so a stale automation loop cannot act over a
person who holds the session. Every transfer is a `control-transfer` ledger
event.

On escalation, the session:

1. Captures a screenshot.
2. Records an `InterventionRequest`. It carries the goal, the reason, the
   observation it refers to, the epoch, the live session's socket, and the
   evidence.
3. Moves the lease to `human`.

The operator surface is the same socket, which the assignment lets us mock.
`scripts/mock-operator` is that mock. `take-control`, `human-observe`, and
`human-act` work only under the human's epoch, in the _same_ browser context.
There is no fresh login and no second browser.

**Handing back is validated, not trusted.** On `resume`, automation — not the
person — checks the live page against the reviewed artifact's stage detectors:

- A match records `resume-validated` and returns the lease to automation at the
  matching stage.
- A non-match records `resume-rejected` and leaves the person in control.

The session refuses a `satisfied` finish unless every handoff ended in a
validated resume.

**Evidence.** Run `20260929120114404-0aa09c9c` is the whole sequence:

1. Codex was asked for "the third party named exactly `aaa`". The demo data
   shows two open records with that name.
2. It searched, and escalated in its own words: "selecting either would be a
   guess."
3. The scripted operator opened the caller's record, `CU2506-00032`, in the
   same browser.
4. Resume validated at the lookup artifact's `extract-profile` stage (epoch
   1 → 2).
5. The model read the card and finished `satisfied`.

The ledger holds the request, both transfers, the human action, and the
validation. One disclosure: Codex's own memory notes from earlier work on this
repository mention the ambiguous-lookup case.

**Honest limits.**

- Resume admits any stage of the bound artifact whose detector matches. It does
  not check that this is the stage the request needed.
- The session binds resume to the lookup artifact for every Dolibarr session.
- A human action passes the origin check but not the action-type policy: the
  person is the authority, and the lease records who acted.
- Replay runners return `intervention-required` and exit. They have no live
  handoff; only discovery sessions do.

# Safety

**Allowlists.** Every action is checked against an origin allowlist and an
action-type allowlist, in the discovery session and in the engine. The engine
refuses a runtime policy that differs from the artifact's, so a caller cannot
widen a capability's permissions.

**Risk classes.** Each stage and each proposed action declares `safe`,
`reversible`, or `irreversible`. Irreversible actions are either blocked or
paused for a person, per `riskyActionMode`. No setting lets one run unattended.
Discovery sessions block them outright, because a person can always act through
a handoff instead. One limit: during discovery the model declares an action's
risk, and a model that misclassifies is caught only by the action allowlist
and by review.

**Redaction at capture time.**

- Fixture authentication happens before recording and tracing start.
- Declared sensitive values are replaced with `[REDACTED]` anywhere in the
  ledger, the manifest, and the README.
- Credential-named keys are redacted, and so are token and session-id query
  parameters inside recorded URLs.
- Tracing is suspended around actions that carry a declared value. The finished
  trace is scanned, and a match finalizes the run as
  `sensitive-evidence-detected`, which promotion refuses.

Values are replaced rather than dropped, so a reviewer can tell "withheld" from
"absent".

**Repository gate.** `scripts/audit-secrets` scans everything a clone would
carry. It runs inside `npm test` and in a pre-commit hook.

**History.** On 2026-09-16 an audit of that gate found the fixture password in
six earlier LedgerSMB capture runs, in both their ledgers and their traces. The
cause was a generic `fill.value` that key-name redaction could not see. Those
runs were removed from the repository and its history.

On 2026-09-29, a fresh replay through the fixed boundary still persisted a
CSRF token carried in a URL. The gate caught it before commit, and the redactor
now scrubs such parameters. Traces also carry session cookies, which text
redaction cannot reach. So traces stay local: promoted `trace.zip` files are
ignored by Git.

**Limits.** Undeclared sensitive values in free text are not caught, and
neither are screenshot pixels. The fixture data is synthetic throughout.

# Cuts

**Deliberately left out.**

- **Scaling infrastructure** — queues, services, tenant plumbing, fleet
  distribution. None of it would change a decision in the schema or the
  engine.
- **A desktop driver.** Building one would show the seam works, not that it was
  designed well.
- **Automatic semantic merging of failures into a graph.** The meaning of an
  unseen failure is judgment; a tool that guessed it would be indistinguishable
  from one that made it up.
- **Open-ended LLM recovery during replay.** Replay is where determinism is
  most valuable and least affordable to lose.
- **A real operator console.** The socket CLI and `scripts/mock-operator`
  stand in for it.

**Not done.**

| Area                         | State                                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery branch in use       | The engine contract is built and tested; no committed artifact declares a recovery, because no run has demonstrated one reaching its resume state.                                                                                                                          |
| Resume stage binding         | Resume validates against the artifact's detectors but not against the stage the request needed, and is bound to one artifact per target.                                                                                                                                    |
| Model attestation            | Codex reports its session id but not its resolved model, so attested runs record `model: null`. The requested model is in the lane's `session-metadata.json`.                                                                                                               |
| Scripted LedgerSMB pilots    | They complete every step but finalize `sensitive-evidence-detected`: they log in as recorded steps, and the login submission reaches the trace. The capture boundary correctly refuses them; the fix is to authenticate before tracing, as discovery and replay already do. |
| Run and action caps          | Stated to the model in the prompt; the harness does not enforce them.                                                                                                                                                                                                       |
| Older discovery corpus       | The 2026-09-15 Dolibarr discovery runs predate producer attestation. Only `20260929120114404-0aa09c9c` carries it.                                                                                                                                                          |
| Absolute paths in one ledger | The handoff run's intervention request records this machine's home path. It is not a credential, and the scanner reports it as a warning.                                                                                                                                   |
| Multi-tenant and drift       | Design only (see above).                                                                                                                                                                                                                                                    |

**Next, in order.**

1. Bind resume to the stage the intervention request named.
2. Record a LedgerSMB run that shows the password-expiry interstitial as a
   declared, capped recovery.
3. Let the harness enforce run and action caps.
4. Build a second surface driver — accessibility-tree desktop — to test the
   seam against something that is not a browser.
