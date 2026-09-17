---
document: REPORT.md
title: Computer-use automation for legacy bank back-office applications
submission: interface.ai engineering take-home
status: published
report-version: 0.2.0
date: 2026-09-17
author: Ian Zepp
assignment: assignment.md
tracking: assignment-proof.md
evidence: evidence/
reviewed-artifacts: 3
corpus-runs: 11
verification: npm run verify
repository: https://github.com/ianzepp/interface-ai-th1
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

The two promoted Dolibarr discovery runs preserve this observe/propose/action
protocol, but their historical manifests carry no producer or decision-receipt
attestation, so they are not independent proof of external-LLM authorship.

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
than a prompt. The repository ships the session controller and CLI, but still needs
an external model host. **Fixture lifecycle stays outside the graph**: Docker `fresh`,
`snapshot`, and `reset` are harness operations, never stages, because a capability that snapshotted
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
passes 139 tests, including those checks. Reviewed artifacts are also exported as JSON
under `evidence/capabilities/`; the tracked evidence retains manifests, ledgers,
READMEs, screenshots, and typed replay results, but no trace archives.

# Determinism & error handling

Determinism comes from removing every choice: bind, verify policy, check origin, require
one match, act, route on the first detector that fires. Every stage declares an
`otherwise`, so an unrecognized state cannot continue by default.

The result contract's main job is separating a legitimate answer from a defect. "No such
third party" is a fact the caller needs; a selector that matched nothing is a bug a
maintainer debugs. Collapsing the two forces callers to read prose to tell them apart,
and hides real outages behind routine-looking answers.

| Result                  | Meaning                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `success`               | Declared outputs, checkpoint verified.                                                                    |
| `business-outcome`      | A real answer with a code. Not an error.                                                                  |
| `intervention-required` | A live-session caller can hand off; the replay pilot records the typed result but does not hand off live. |
| `failure`               | Unrecoverable. Carries stage, expected state, observed divergence, evidence.                              |

The Dolibarr capability exercises this result contract end to end. Two happy replays
returned identical outputs — `Book Keeping Company`, `CU1108-0004`, `SU1108-0004`,
`EUR - Euros`, `Open`,
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

An earlier, unpromoted LedgerSMB replay failed from the same instinct in the other
direction. The recorder had serialized the login control as `form button` while discovery
actually resolved it by role and accessible name — the recorded locator and the executed
locator were not the same thing. Both failures argue the same way:
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
reading logs — capability, goal, stage, reason, timestamp, evidence, and a live
run/session reference from that moment. `ControlLease` gives the session one owner at a
time and moves it by compare-and-swap with an incrementing epoch, so a resumed automation
loop cannot write over a person who is still working.

**Honest limit.** The handoff mechanism is implemented, but it is not demonstrated in
promoted evidence. The Unix-socket `scripts/session` surface supports `take-control`,
`human-observe`, `human-act`, and `resume`; `evaluateResume` returns `resume`, `complete`,
or `reject` and is covered by tests; and `createInterventionRequest` is called by the
interactive session. A local run records two control transfers and a validated resume,
but no promoted run demonstrates the full manual sequence. The deterministic replay pilot
records the typed intervention result and closes its browser rather than handing off live.

# Safety

**Allowlists.** Every action is checked against an origin allowlist and an action
allowlist, in the discovery session and in the engine. The engine also refuses a runtime
policy that differs from the artifact's, so a capability cannot widen its own permissions
by editing the caller.

**Risk classes.** Each stage declares `safe`, `reversible`, or `irreversible`. Irreversible
actions are blocked outright or pause for a person per `riskyActionMode`; no configuration
lets one run unattended.

**Redaction.** Event payloads, the run manifest, and the README pass through recursive
key-name and declared-value redaction on the way to disk, replacing values rather than
dropping keys so a reviewer can tell "a credential was present and withheld" from "no
credential was here". The discovery session also authenticates _before_ tracing starts,
so a fixture credential cannot enter a trace at all.

The repository also ships `scripts/audit-secrets`, with `--staged`, `--all`, `--json`,
and `--root` modes, plus `scripts/hooks/pre-commit`, installed by
`scripts/install-hooks`. `SECURITY.md` records the gate's limits: binary traces,
screenshot pixels, and Git history remain separate audit surfaces.

Auditing that last decision found a real defect on the other target:

- The 11 surviving promoted Dolibarr event ledgers are clean.
- The former six-run LedgerSMB capture corpus contained the fixture password in
  both its event ledgers and binary traces.
- Those six runs and every trace archive were permanently removed from the
  repository and its history in the 2026-09-16 rewrite because the traces held a
  credential-bearing request URL and local session cookies; text redaction cannot
  reach inside a binary archive.
- The surviving `README.md` files and `run.json` manifests are clean because
  key-name and declared-value redaction works there.

The historical defect was structural. A `fill` action stores its value under a generic
`value` property, so key-name redaction cannot cover it; binary traces require a separate
capture boundary. The current boundary redacts declared values, suspends tracing around
declared sensitive actions, scans the finished trace, and discards a trace containing a
match. Remaining gaps are undeclared values and credential-shaped strings in free text,
screenshot pixels, and verification that covers only the trace rather than the whole run.
The values were synthetic fixture data, and the removal is permanent in history; the
capture-time guarantee remains incomplete, but the capture path is partial rather than an
unresolved violation.

**Honest limit.** The guardrails cover the discovery session, the four scripted
LedgerSMB capture pilots, and both replay runners. The pilots now reference
`ArtifactPolicy` and the common capture boundary, so they enforce policy but do not record
interactive proposal and decision events. Their removed historical ledgers therefore show
executed actions without proposal events, while the Dolibarr ledgers show proposal,
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

| Area               | State                       | Missing                                                                                                                                                                                                      |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Discovery inputs   | Partial                     | `scripts/author` accepts goal, target, fixture, and `--max-runs`, `--max-actions`, and `--timeout`; the older launcher still hard-codes goal/target, and caps are not harness-enforced.                      |
| Recovery branches  | Described, not demonstrated | No artifact contains a bounded recovery edge reaching a declared resume state.                                                                                                                               |
| Escalation handoff | Partial                     | The live session surface and resume validation are implemented and tested, but no promoted run demonstrates full same-session manual takeover.                                                               |
| Evidence hygiene   | Partial                     | The removed six-run LedgerSMB corpus contained the fixture password in both ledger and trace; remaining capture gaps are undeclared values, credential-shaped text, screenshots, and whole-run verification. |
| Artifact export    | Shipped                     | Three reviewed artifacts are exported as JSON under `evidence/capabilities/`.                                                                                                                                |
| Schema enforcement | Shipped                     | The test suite validates committed artifacts and promoted results against `schemas/`; exported JSON demonstrates the artifact contract under `evidence/`.                                                    |
| Publication        | Published                   | The repository is public at `https://github.com/ianzepp/interface-ai-th1`; the assignment still requires emailing the URL to `assignments@interface.ai`.                                                     |

Two matter more than the rest. The escalation handoff mechanism is real, but its full
manual sequence is not demonstrated in promoted evidence — the difference between a
vertical slice that runs all the way through and one that stops a step short. Secret
handling could still disqualify an otherwise working submission, and it is mechanical
rather than architectural: the capture boundary protects declared values and scans traces,
while remaining gaps cover undeclared values, credential-shaped text, screenshots, and
whole-run verification. The affected runs were permanently removed from the repository and
history; future captures still need those protections.

**Next, in order.** Record and promote a target-facing same-session takeover and validated
resume. Close the remaining capture-time gaps before future capture. Keep the reviewed
artifact exports under `evidence/capabilities/` synchronized with the source artifacts.
Document the older launcher's hard-coded goal and target and its prompt-level limits, then
email the public repository URL to `assignments@interface.ai`.

Per-requirement status, gap detail, and evidence identifiers live in
[`assignment-proof.md`](assignment-proof.md), the authority for what is done.
