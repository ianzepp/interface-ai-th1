---
document: REPORT.md
title: Computer-use automation for legacy bank back-office applications
submission: interface.ai engineering take-home
status: draft
report-version: 0.2.0
date: 2026-09-15
author: Ian Zepp
assignment: assignment.md
tracking: assignment-proof.md
evidence: evidence/runs/
reviewed-artifacts: 2
corpus-runs: 11
verification: npm run verify
repository: pending publication
---

# Architecture

Two planes, joined by one artifact.

**Authoring is probabilistic.** An external LLM loads
`skills/capability-author/SKILL.md`, receives a goal and a reset Docker fixture, and
drives a live browser one bounded action at a time through
`src/authoring/interactive-playwright-session.ts`, writing one JSON command per line
on stdin — `observe`, `act`, `checkpoint`, `finish` — and reading one JSON result per
line back. Policy is evaluated and the verdict written to the ledger _before_ the
action runs, so a refused action leaves evidence instead of a hole.

**Replay is deterministic.** `src/runtime/engine.ts` walks a reviewed artifact and
never asks a model anything: bind inputs, refuse a runtime policy that differs from
the artifact's, check the origin about to be touched, require a unique target match,
act, wait for a declared detector, extract typed outputs, follow one explicit
transition.

Three terms keep the planes from blurring. A **run** is one immutable
reset-to-terminal attempt, saved whether it succeeded or not. A **corpus** is the runs
behind one artifact — successes that establish what is stable, exceptions that
establish what is real, replays that validate or refute. An **artifact** is the
reviewed graph that replay executes.

Three decisions carry the rest. **The model host stays outside the repository**: no
model-provider SDK and no second agent loop, so this repository is a system rather
than a prompt — at the cost of a discovery demo that needs a controller it does not
ship. **Fixture lifecycle stays outside the graph**: Docker `fresh`, `snapshot`, and
`reset` are harness operations, never stages, because a capability that snapshotted
its own fixture could not be replayed against another institution's data. **Artifacts
are reviewed code, not generated output**: `npm run draft:artifact` extracts a
provisional graph mechanically, but which states are stable, which failures are
business outcomes, and which recoveries are safe is judgment no trace contains.

# Artifact schema

A `CapabilityArtifact` is a versioned **state graph**, and that is the schema's central
claim. A transcript records one path through an application; a graph says what states
replay recognizes and what each one means, which is the only way to answer what happens
when the page is not where the recording left it.

Four review surfaces: **`contract`** — goal, typed inputs, outputs, and a prose
`successCondition`, so a reviewer can judge the flow independently of its steps;
**`stages`** — at most one action each, a risk class, detectors, typed extractions,
explicit transitions, and a fail-closed `otherwise`; **`policy`** — allowed origins,
allowed action types, irreversible-action treatment; and **`provenance`** — the
discovery run, the supporting corpus, and the validating replays.

Targeting is schema, not driver detail. A `TargetDescriptor` holds an ordered candidate
list and a `require: "exactly-one"` pin: zero matches is missing, several is ambiguous,
and neither falls through to a convenient first match, because silently picking one of
two identical records is worse than stopping. Candidates are ranked by meaning —
accessible role and name, label, stable application-owned identifier, stable nearby
text with structural context, CSS last — and the schema cannot enforce that order, which
is why review exists.

Detector `scope` (`runtime`, `target`, `capability`) is the reuse lever: a lost session
belongs to the application and therefore to a shared target profile, while "results are
visible" belongs to one capability.

**Enforcement.** `schemas/capability.schema.json` uses typed `$ref` definitions for
the graph vocabulary, with `additionalProperties: false` on each object it defines.
`tests/schemas.test.ts` uses an Ajv 2020 validator to check every committed artifact
against the capability schema, every promoted replay result against the result schema,
and the intervention fixture against the invocation schema. The current package suite
passes 119 tests, including those checks. The remaining demonstration gap is that the
approved artifact is committed as TypeScript rather than exported as a JSON example
under `/evidence/`.

# Determinism & error handling

Determinism comes from removing every choice: bind, verify policy, check origin, require
one match, act, route on the first detector that fires. Every stage declares an
`otherwise`, so an unrecognized state cannot continue by default.

The result contract's main job is separating a legitimate answer from a defect. "No such
third party" is a fact the caller needs; a selector that matched nothing is a bug a
maintainer debugs. Collapsing the two forces callers to read prose to tell them apart,
and hides real outages behind routine-looking answers.

| Result                  | Meaning                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `success`               | Declared outputs, checkpoint verified.                                       |
| `business-outcome`      | A real answer with a code. Not an error.                                     |
| `intervention-required` | A person is needed; the run and its session stay open.                       |
| `failure`               | Unrecoverable. Carries stage, expected state, observed divergence, evidence. |

The Dolibarr capability proves this end to end. Two happy replays returned identical
outputs — `Book Keeping Company`, `CU1108-0004`, `SU1108-0004`, `EUR - Euros`, `Open`,
`PCV` — byte-for-byte the same `result.json`, and each admitted exception has its own
replayed run: `third-party-not-found`, `third-party-ambiguous` when two exact names
compete, and `authentication-required` when a protected route redirects to login.

The saving is measurable. Discovery of that lookup took 25.6–42.5 seconds of browser
time across five runs; deterministic replay took 0.127–0.858 seconds across six. The
comparable happy path went from 42.5 seconds to 0.86, with no model in the loop.

One retained failure is worth more than the successes. Run
`20260915202607595-f1eee304` failed with `stage-execution-failed` at `open-result`,
observed as `Missing target [{"kind":"text","text":"{{input.name}}","exact":true}]`, with
a screenshot attached. Strict resolution had rejected a placeholder the engine never
substituted: input binding covered detector targets but not action targets. A lenient
fallback would have absorbed the bug into a plausible-looking replay; instead the failure
named its own stage, and the fix now has a test.

An earlier failure came from the same instinct in the other direction. LedgerSMB's first
replay was rejected because the recorder had serialized the login control as `form button`
while discovery actually resolved it by role and accessible name — the recorded locator
and the executed locator were not the same thing. Both failures argue the same way:
strictness is what turns a silent divergence into a named stage.

**Honest limit.** No committed artifact contains a recovery branch — an edge that takes a
bounded corrective action and resumes. The skill's standard is that a recorded action
must reach the declared resume state and a mutating action may not be retried while
commit status is uncertain; no run in the corpus satisfies it, so recoverable conditions
are described rather than demonstrated. Drift detection is absent too.

# Heterogeneity & multi-tenant

`SurfaceDriver` is the seam, six operations wide: `observe`, `locate`, `act`, `waitFor`,
`extract`, `captureEvidence`. A capability is recorded against a surface, never a browser,
so a legacy frameset app, an accessibility-tree desktop client, or a
screenshot-plus-coordinate controller can implement the same six operations without
touching the artifact schema or the engine. Two properties matter more than the list:
`waitFor` takes detectors rather than a duration, so "ready" means a recognized state and
never an elapsed time; and `extract` is separate from `captureEvidence` because outputs
are data the caller asked for while evidence is diagnostic material a human reads when
something broke.

Multi-tenant reuse is why target knowledge is split out of capabilities. `TargetProfile`
holds what is true of a whole application — supported versions, allowed origins, detectors
for states any flow in that product can hit — so a version bump changes one profile
instead of invalidating every recorded flow. A production registry would key a base
artifact by vendor, product, and qualified version range, apply reviewed tenant overlays
for origins, branding, labels, and locator alternatives, and qualify drift by replaying
the existing corpus against a candidate tenant or version — promoting only what was
checked and failing closed when no supported profile matches.

**Honest limit.** This section is design. One driver exists; the `relative` candidate kind
throws; the LedgerSMB profile's global detector list is empty, so the two targets do not
yet share a detector on equal footing. There is no overlay mechanism, no version-range
matching, and no drift detection.

# Escalation & handoff

"Stuck" is declared in two places. The engine raises `intervention-required` when policy
would need a person to confirm an irreversible action, and an artifact can route a
recognized state to intervention as a declared outcome — the more interesting path,
because it puts the judgment where the application knowledge already lives.

Routing is proved against a real condition rather than a mock. The `authentication-required`
replay deliberately starts unauthenticated, the protected route redirects to login, and
replay returns `intervention-required` naming `dolibarr.lookup-third-party:open-list`, the
stage where it stopped — rather than entering a credential or continuing blindly.

Two types carry the rest. `InterventionRequest` holds what an operator needs without
reading logs — capability, goal, stage, reason, timestamp, evidence from that moment — and
deliberately does not reference the session, which transfers separately. `ControlLease`
gives the session one owner at a time and moves it by compare-and-swap with an incrementing
epoch, so a resumed automation loop cannot write over a person who is still working.

**Honest limit.** The largest gap in the submission. No operator surface pauses the live
session, exposes it for manual input, records what the person did, and validates a
recognized state before resuming. `evaluateResume` is a stub that always rejects and is
covered by no test; `createInterventionRequest` is defined but never called. What exists is
the routing and the ownership semantics — a real seam, correctly shaped, with the
integration behind it unbuilt.

# Safety

**Allowlists.** Every action is checked against an origin allowlist and an action
allowlist, in the discovery session and in the engine. The engine also refuses a runtime
policy that differs from the artifact's, so a capability cannot widen its own permissions
by editing the caller.

**Risk classes.** Each stage declares `safe`, `reversible`, or `irreversible`. Irreversible
actions are blocked outright or pause for a person per `riskyActionMode`; no configuration
lets one run unattended.

**Redaction.** Event payloads and the run manifest pass through recursive key-name
redaction on the way to disk, replacing values rather than dropping keys so a reviewer can
tell "a credential was present and withheld" from "no credential was here". The discovery
session also authenticates _before_ tracing starts, so a fixture credential cannot enter a
trace at all.

Auditing that last decision found a real defect on the other target:

- The 11 surviving promoted Dolibarr event ledgers are clean.
- The former six-run LedgerSMB capture corpus contained the fixture password in
  both its event ledgers and binary traces.
- Those six runs and every trace archive were permanently removed from the
  repository and its history in the 2026-09-16 rewrite because the traces held a
  credential-bearing request URL and local session cookies; text redaction cannot
  reach inside a binary archive.
- The surviving `README.md` files and `run.json` manifests are clean because
  key-name redaction works there.

The cause is structural. A `fill` action stores its value under a generic `value`
property, and `value` is not — and cannot sensibly be — a sensitive key name; and key-name
redaction says nothing about a binary trace, which Playwright writes and never passes through
it. Both limits were already documented in `redaction.ts`; the audit's contribution was
that the LedgerSMB corpus exercised them. The values were synthetic fixture data, and the
removal is permanent in history, but the capture and redaction paths remain an unresolved
violation of the assignment's absolute no-secret-persistence rule, treated as a blocker
rather than a nit.

**Honest limit.** The guardrails cover the discovery session and both replay runners. The
four scripted LedgerSMB capture pilots drive Playwright directly and never reference
`ArtifactPolicy`, so they neither enforce nor record a verdict — which is why their ledgers
show executed actions with no proposal event while the Dolibarr ledgers show proposal,
decision, then action.

# Cuts

**Deliberately left out.** The assignment asks for abstractions that could scale, not
scaling infrastructure. The same reasoning removed queues, service decomposition, tenant
plumbing, and fleet distribution (none would change a decision in the schema or the
engine); a desktop driver (building one would show the seam works, not that it was designed
correctly); automatic semantic failure merging (the meaning of an unseen failure is a
judgment call, and a tool that guessed it would be indistinguishable from one that
fabricated it — hence the extractor's marked draft and warning list); and open-ended LLM
recovery during replay, where determinism is most valuable and least affordable to lose.

**Not yet done.** Incomplete requirements, not choices:

| Area               | State                       | Missing                                                                                                                                     |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery inputs   | Partial                     | Goal, target, and stopping limits are hard-coded in the launcher; no step or run cap.                                                       |
| Recovery branches  | Described, not demonstrated | No artifact contains a bounded recovery edge reaching a declared resume state.                                                              |
| Escalation handoff | Routing only                | No operator surface, no same-session takeover; `evaluateResume` stubbed and untested.                                                       |
| Evidence hygiene   | Blocker                     | The removed six-run LedgerSMB corpus contained the fixture password in both ledger and trace; future capture still needs a fix.             |
| Artifact export    | Missing                     | Artifacts live in `src/capabilities/`; no JSON example saved under `evidence/`.                                                             |
| Schema enforcement | Missing                     | The test suite now validates committed artifacts against `schemas/`; no exported JSON example demonstrates that contract under `evidence/`. |
| Publication        | Missing                     | No git remote, so the repository is not yet public.                                                                                         |

Two matter more than the rest. The escalation handoff is the one requirement whose seam is
real but whose integration is absent — the difference between a vertical slice that runs all
the way through and one that stops a step short. Secret handling could disqualify an
otherwise working submission, and it is mechanical rather than architectural: redact values
on known-sensitive targets, keep fill values out of the durable ledger, and stop writing
traces that contain a credential. The affected runs were permanently removed from the
repository and history; future captures still need those protections.

**Next, in order.** Integrate and record a real same-session takeover and validated resume.
Fix fill-value and trace handling before any future capture. Export a reviewed artifact to
`evidence/` while retaining the existing schema validation. Make goal, target, and
stopping limits explicit launcher inputs and write a complete copy-paste discovery demo.
Then publish.

Per-requirement status, gap detail, and evidence identifiers live in
[`assignment-proof.md`](assignment-proof.md), the authority for what is done.
