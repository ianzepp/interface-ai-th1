# Architecture

The system has two deliberately asymmetric planes. During authoring, an
external LLM loads the repository-owned `capability-author` skill, receives a
goal, and controls a live application one bounded action at a time. A
long-lived Playwright session returns observations over JSONL and records the
LLM's proposed action, rationale, policy decision, executed result, trace, and
selected proof screenshots. Docker snapshots make each attempt independently
resettable. One run is an immutable reset-to-terminal experiment; the
authoring unit is a corpus of corroborating successes, failures, and recoveries.

After the first success, a mechanical extractor emits a provisional linear
artifact. The LLM then compares the corpus and makes the semantic judgments the
extractor cannot: which targets and state markers are stable, which values are
inputs, which failures are business outcomes, and which observed recoveries
belong in the graph. Replay is a separate execution plane. The
`DeterministicEngine` interprets only the reviewed artifact and never asks a
model what to do.

This architecture was exercised against two pinned local applications:
LedgerSMB 1.13.7 and Dolibarr 23.0.4. The complete Dolibarr authoring corpus has
two happy runs, no-match, ambiguity, and authentication-required experiments,
plus a failed replay that exposed missing target-template binding. The revised
artifact then passed two happy replays and one replay for every admitted
exception.

# Artifact schema

A `CapabilityArtifact` is a versioned state graph with four review surfaces:

- a contract naming the goal, typed invocation inputs, typed outputs, and
  success condition;
- stages containing at most one action, a risk class, post-action detectors,
  typed extractions, explicit transitions, and a fail-closed `otherwise` edge;
- policy recording allowed origins, allowed action types, and irreversible
  action treatment; and
- provenance linking the primary discovery run, supporting corpus, and checked
  replay runs.

Targets are ordered candidate descriptors rather than coordinates. Resolution
requires exactly one match: zero is missing and more than one is ambiguous.
The Dolibarr artifact binds `baseUrl` and `name`, then returns canonical name,
customer code, vendor code, currency, status, and customer/vendor nature. It
uses result cardinality to distinguish a unique exact match from duplicate
exact names and routes the latter as a business outcome instead of silently
choosing the first row.

The artifact is intentionally not a transcript. The event ledger says what
happened in one run; the reviewed graph says what states replay recognizes and
what each recognized state means. The draft extractor preserves that boundary
by marking its output provisional and warning about uninferred outputs,
incidental literals, CSS targets, and absent red-path review.

# Determinism & error handling

Replay binds invocation values, verifies the artifact and runtime policies
match, checks the current or destination origin, requires unique target
resolution, executes one typed action, waits for declared state detectors,
extracts typed outputs, and follows one explicit transition. Every stage has an
`otherwise` destination; unknown states cannot fall through to another click.
Playwright is responsible for browser mechanics, while the engine owns graph
traversal and result semantics.

The result contract separates success, business outcomes, intervention, and
hard failure. The Dolibarr replay returns the six requested fields on a unique
match, `third-party-not-found` for an empty result, `third-party-ambiguous` for
duplicate exact names, and `authentication-required` when a protected route
redirects to login. Hard failures include the stage, expected state, observed
divergence, and screenshot evidence. Two clean happy replays produced identical
outputs. One retained failed replay demonstrated the value of strictness: the
engine refused an unbound target template rather than guessing, and the generic
binding code was corrected before replaying again.

The current artifact does not demonstrate an automatic recovery branch. The
authoring skill defines the standard: a condition is recoverable only after a
recorded bounded action reaches a declared resume state, and retrying a mutating
action is forbidden while commit status is uncertain. That requirement remains
to be proven in the implementation.

# Heterogeneity & multi-tenant

`SurfaceDriver` is the seam between a capability and the technology used to
perceive and operate an application. Its vocabulary covers observations,
ordered target candidates, actions, detectors, extraction, and evidence.
Playwright is one adapter. A legacy browser, accessibility API, remote desktop,
or native automation adapter can implement the same contract without changing
the engine or artifact graph. Raw CSS is available for hostile legacy markup
but ranked below roles, labels, application-owned identifiers, and stable
structural context.

Application knowledge lives in target profiles and capability artifacts rather
than the engine. A production registry would key a base artifact by vendor,
product, and qualified version range, then apply reviewed tenant overlays for
origins, branding, labels, feature flags, and locator alternatives. Shared
target detectors would identify login, permission, outage, and version states
across capabilities. Drift qualification would run the same artifact corpus
against a candidate tenant/version, promote only checked overrides, and fail
closed when no supported profile matches. The two local targets test the
boundary, but tenant overlays, desktop drivers, and fleet distribution are
design-only here as permitted by the assignment.

# Escalation & handoff

The result model can return `intervention-required`, and the authentication
experiment proves that replay stops deliberately instead of entering a
credential or continuing blindly. `InterventionRequest` carries capability,
goal, stage, reason, timestamp, and evidence. `ControlLease` gives the live
session one explicit owner—automation or human—and uses compare-and-swap
transfers with an epoch so stale controllers cannot act over the current owner.

This seam is not yet a complete handoff. There is no integrated operator
surface that pauses the active Playwright session, exposes it for manual input,
records the person's actions, and validates a recognized state before returning
control. `evaluateResume` is explicitly unimplemented. Therefore the project
currently demonstrates intervention routing and ownership semantics, but not
the assignment's required same-session human takeover and resume.

# Safety

Both authoring and replay evaluate actions against explicit action and origin
allowlists. Each artifact stage declares safe, reversible, or irreversible
risk. Irreversible actions are either blocked or require confirmation; there is
no unattended allow mode. Unknown targets, ambiguous targets, unrecognized
states, policy mismatches, and origin changes stop rather than guess. Fixtures
use loopback-only Docker services and synthetic data, and reset/snapshot
operations stay outside the browser graph.

Event persistence applies recursive key-name redaction, and the Dolibarr
workflow authenticates before trace capture. Its promoted traces were scanned
for the fixture password. However, the current redactor cannot recognize a
secret stored as a generic fill `value`, and older promoted LedgerSMB ledgers
contain synthetic credential or identifier literals. Playwright traces are not
post-redacted either. This is a real submission blocker against the assignment's
absolute no-secret-persistence rule, even though the values belong only to local
fixtures.

# Cuts

The implementation favors one deep, evidence-backed browser capability over a
fleet service. It deliberately omits queues, tenant management, a desktop
driver, automatic semantic failure merging, automatic approval, exhaustive
fuzzing, and open-ended model fallback during replay. Graph revision remains a
reviewable LLM/human judgment because a successful trace cannot determine the
meaning or safety of unseen failures.

The remaining must-have work is narrower and more important than those scale
features: integrate and record same-session human takeover/resume; enforce
goal, target, step, and whole-run limits as launcher inputs; prevent sensitive
fill values and trace data from entering evidence and replace affected older
runs; and save the reviewed example artifact under `/evidence/`. Finally, the
repository has no configured remote, so public GitHub publication and submission
remain operator-controlled release steps. The detailed live status and evidence
IDs are maintained in `assignment-proof.md`.
