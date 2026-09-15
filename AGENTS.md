# Agent Operator Guide

This repository is the `interface.ai` computer-use automation take-home. It
contains a small path from browser discovery to a reviewed, deterministic
capability replay.

This file is the operational index. Read the source documents for the full
contract, then use the commands and boundaries below instead of rediscovering
the workflow from scratch.

## Read first

- [`assignment.md`](assignment.md) is the assignment contract and evaluation
  target. Use it for required behavior and deliverables.
- [`NOTES.md`](NOTES.md) records settled product, architecture, target, fixture,
  and evidence decisions. Treat implementation claims as claims to verify
  against current code, tests, Git history, and receipts.
- [`README.md`](README.md) is the project overview and script index.
- [`skills/capability-author/SKILL.md`](skills/capability-author/SKILL.md) is the
  detailed procedure for fixture setup, browser capture, evidence, artifact
  authoring, and replay validation.
- Shared skills live in
  `/Users/ianzepp/work/ianzepp/skills`. Read its relevant `AGENTS.md` and the
  applicable skill before using a named workflow such as factory, auditor,
  polish, or tugboat. Do not copy shared skills into this repository.

Assignment and notes are authority for requirements and settled decisions, not
proof that a feature is implemented. Current code, tests, traces, manifests,
and Git history are the evidence boundary.

## Current architecture

The discovery agent is the external LLM host following the repo-owned
`capability-author` skill and operating the live target through computer-use
tools. The repository does not embed a second model loop, model-provider SDK, or
automatic semantic graph compiler. Do not treat their absence as unfinished
architecture and do not recreate the removed embedded-agent/compiler stubs.

The authoring control plane and execution plane are deliberately asymmetric:

- The LLM host loads `skills/capability-author/SKILL.md`, accepts the operator's
  goal and target, chooses reset fixtures and experiments, observes the live UI,
  and makes one bounded computer-use decision at a time.
- `scripts/target` supplies resettable Docker fixtures and reset receipts.
- The authoring recorder and Playwright tracing preserve each individual
  reset-to-terminal attempt under `runs/<run-id>/`.
- `npm run draft:artifact` mechanically extracts a provisional linear artifact
  from one successful run. It does not approve the draft or infer exception
  semantics.
- The LLM-guided authoring session compares multiple successful, failed, and
  recovered runs, then uses explicit judgment to revise the draft into the
  smallest evidence-grounded state graph.
- `DeterministicEngine` replays an approved artifact without an LLM in its
  decision loop.

An end-to-end authoring loop is a corpus-building session, not one browser run.
It normally contains several successful runs, deliberate exception runs,
recovery runs where justified, draft revisions, and deterministic replay runs.
The loop ends only when the skill's artifact approval conditions hold.

The repository currently has a reviewed LedgerSMB initialization artifact and
deterministic replay pilot plus staged LedgerSMB capture evidence. The next
cross-target proof is a complete Dolibarr authoring session using the same
skill, fixture, evidence, artifact, and replay boundaries.

## Repository map

- `src/authoring/` — capture, event/run recording, draft extraction, evidence
  promotion, and target-specific capture pilots.
- `src/capabilities/` — reviewed capability artifacts.
- `src/runtime/` — deterministic engine, policy, state-machine traversal,
  results, and replay pilots.
- `src/surfaces/` — browser surface-driver abstraction and Playwright driver.
- `src/targets/` — target registry, profiles, and detectors.
- `src/intervention/` — human-control and resume seams.
- `schemas/` — JSON Schemas for capabilities, invocations, and results.
- `tests/` — Node test-runner tests for runtime, policy, targeting, recording,
  redaction, schemas, and target harness behavior.
- `targets/` — pinned Docker Compose definitions for LedgerSMB and Dolibarr.
- `scripts/target` — the target lifecycle wrapper and snapshot manager.
- `runs/` — local raw capture/replay runs; Git-ignored.
- `evidence/` — deliberately reviewed, tracked run copies.
- `snapshots/` — local named target snapshots; Git-ignored.

## First-time host setup

Required local tools:

- Node.js 24 or newer.
- npm.
- Docker Engine or Docker Desktop with Docker Compose v2 running.
- curl, used by the target wrapper's readiness check.
- `unzip`, used by the draft extractor to inspect `trace.zip`.

From the repository root:

```sh
node --version
npm --version
docker info
docker compose version
npm ci
```

The Compose files use pinned application and database image digests. The first
target start may pull several images. Browser capture uses Playwright's
Chromium; if `chromium.launch` reports that the browser is missing, install it
once with:

```sh
npx playwright install chromium
```

The local Compose environments bind only to loopback. They are evaluation
fixtures, not production deployments.

## Target matrix

The two targets use separate Compose projects and ports, so both can be running
at the same time.

| Target    | Version | Browser URL             | Database         | Compose project          |
| --------- | ------- | ----------------------- | ---------------- | ------------------------ |
| LedgerSMB | 1.13.7  | `http://127.0.0.1:5762` | PostgreSQL 15.14 | `interface-ai-ledgersmb` |
| Dolibarr  | 23.0.4  | `http://127.0.0.1:8080` | MariaDB 11.4.8   | `interface-ai-dolibarr`  |

The target definitions pin all application/database image digests. LedgerSMB
starts with fresh PostgreSQL volumes and no company database. Dolibarr uses its
official demo-data initialization option. Credentials in the Compose files and
pilots are synthetic local fixture credentials only; never reuse them outside
these containers or copy them into durable evidence unnecessarily.

## Target lifecycle

Always run these commands from the repository root. Replace `<target>` with
`ledgersmb` or `dolibarr`.

Inspect without changing target state:

```sh
scripts/target --help
scripts/target list
scripts/target list <target>
scripts/target config <target>
scripts/target url <target>
scripts/target status <target>
```

Start, stop, and preserve the current target state:

```sh
scripts/target up <target>
scripts/target stop <target>
```

`up` pulls missing pinned images, starts the Compose services, and waits for the
target health URL. `stop` stops containers but preserves their volumes. Use
`up` to resume that state.

Create a clean install for initial exploration:

```sh
scripts/target fresh <target>
```

`fresh` deletes only the selected target's containers and persistent Docker
volumes, recreates them, and waits for readiness. It is destructive to that
target's local state. Use it for LedgerSMB `initialize-company` attempts or
when intentionally discarding the current fixture.

Freeze a reviewed state as a named snapshot:

```sh
scripts/target snapshot <target> <snapshot-name>
```

Snapshot names must start with a lowercase letter or digit and contain only
lowercase letters, digits, dots, underscores, and hyphens. Snapshot creation
briefly stops the target, archives every persistent volume, writes a checksummed
manifest with image identities, then restarts the target. It refuses to
overwrite an existing snapshot.

Restore a named snapshot:

```sh
scripts/target reset <target> <snapshot-name>
```

`reset` validates the snapshot manifest and archive hashes, removes only the
selected target's current volumes, restores every archived volume, starts the
services, waits for readiness, and writes:

```text
tmp/targets/<target>/last-reset.json
```

That reset receipt and the snapshot manifest are the evidence that the fixture
was restored. Do not start a capture until the reset has completed.

Delete a target's containers and persistent volumes only when intentionally
discarding its local state:

```sh
scripts/target destroy <target>
```

Never run `fresh`, `reset`, `snapshot`, or `destroy` during an active browser
capture. Use `up`, `stop`, and `status` when preserving the current state.

If readiness fails, the target wrapper prints Compose status and recent logs.
Useful bounded follow-up commands are:

```sh
docker compose \
  --project-name interface-ai-ledgersmb \
  --file targets/ledgersmb/compose.yaml logs --tail 80

docker compose \
  --project-name interface-ai-dolibarr \
  --file targets/dolibarr/compose.yaml logs --tail 80
```

## LedgerSMB fixture progression

The intended four-phase corpus is:

```text
fresh Docker volumes
  -> initialize-company
initialized-company
  -> create-trading-partners
partners-ready
  -> create-inventory-catalog
catalog-ready
  -> exercise-inventory-lifecycle
clean-baseline-v1
```

The named starting snapshots are consumed by the package scripts:

| Phase                          | Starting state                  | Ending state          |
| ------------------------------ | ------------------------------- | --------------------- |
| `initialize-company`           | `ledgersmb/fresh`               | `initialized-company` |
| `create-trading-partners`      | `ledgersmb/initialized-company` | `partners-ready`      |
| `create-inventory-catalog`     | `ledgersmb/partners-ready`      | `catalog-ready`       |
| `exercise-inventory-lifecycle` | `ledgersmb/catalog-ready`       | `clean-baseline-v1`   |

The ending names are conventions enforced by the workflow, not automatically
created by the capture commands. Create each ending snapshot explicitly only
after the browser checkpoint and independent persisted-state assertions pass:

```sh
scripts/target snapshot ledgersmb initialized-company
scripts/target snapshot ledgersmb partners-ready
scripts/target snapshot ledgersmb catalog-ready
scripts/target snapshot ledgersmb clean-baseline-v1
```

## Capture a Playwright run

Every attempt is one complete reset-to-terminal run. A retry after another
reset gets a new run ID. Save failed, stalled, exploratory, and successful runs;
do not discard failures that reveal an unknown state or application condition.

### Built-in LedgerSMB pilots

After the required snapshots exist, use the package scripts:

```sh
npm run capture:ledgersmb:initialize
npm run capture:ledgersmb:partners
npm run capture:ledgersmb:catalog
npm run capture:ledgersmb:lifecycle
```

The scripts build TypeScript, reset the correct target fixture, launch the
headless Playwright pilot, record the run, and print its run directory. The
initialization command uses `fresh ledgersmb`; later commands use `reset` with
their named starting snapshot.

For a single fresh end-to-end attempt through all four phases:

```sh
npm run capture:ledgersmb:end-to-end
```

This builds, runs `fresh ledgersmb`, and invokes the four pilots sequentially on
the same live target. It stops at the first failed phase. It does not create
intermediate snapshots automatically.

### What a capture must record

The capture boundary is implemented by `FileTestRunRecorder` and
`PlaywrightTestRunCapture`:

1. Establish the goal, success condition, exact target/version, fixture ID,
   typed inputs, allowed origin, and action/time limits.
2. Reset the target and retain the reset receipt.
3. Create the run before the first browser action.
4. Start Playwright tracing with screenshots and DOM snapshots.
5. Observe, decide on one bounded typed action, execute it, and append a
   redacted event.
6. Wait for an application-owned state marker or explicit terminal condition.
7. Capture meaningful checkpoint and terminal screenshots.
8. Finish the trace and finalize the run as `satisfied` or `error`.

The standard run layout is:

```text
runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
├── trace.zip
└── screenshots/
```

Inspect a completed run without guessing from the console summary:

```sh
sed -n '1,220p' runs/<run-id>/README.md
jq '{runId,status,targetProfile,targetVersion,fixtureId,outcome}' \
  runs/<run-id>/run.json
sed -n '1,120p' runs/<run-id>/events.jsonl
```

The Playwright trace is the browser evidence. Open it with the Playwright
trace viewer when visual or DOM inspection is needed; the repository does not
turn a trace into a capability automatically.

For a new target-specific pilot, follow the existing files under
`src/authoring/` rather than inventing a second recorder. Use
`FileTestRunRecorder.start`, `PlaywrightTestRunCapture.start`, a fresh browser
context, explicit action recording, redacted events, screenshots, and a
`capture.finish` call in both success and failure paths. Add a package script
that builds before running the compiled pilot.

Prefer stable targets in this order:

1. accessible role and name;
2. explicit label relationship;
3. stable application-owned test identifier;
4. stable nearby text plus structural context;
5. CSS or DOM structure only as a last resort.

A URL change alone does not prove that a client-rendered screen is ready. Wait
for a unique application-owned heading, landmark, value, or state marker. Do
not replace an observed transition race with a fixed sleep.

## Review and promote evidence

Review `run.json`, `README.md`, `events.jsonl`, screenshots, and `trace.zip`
before promotion. Check for credentials, tokens, cookies, authorization data,
unexpected customer data, and misleading success claims. Both `satisfied` and
`error` runs are valid evidence.

Promote only finalized runs with all required files:

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

Promotion copies the run unchanged to `evidence/runs/<run-id>/`, leaves the raw
run untouched, refuses to overwrite existing evidence, and does not invent or
repair missing evidence. Evidence is a deliberate submission record, not a
dump of every local run.

## Convert a run corpus into a replay

Artifact authoring is intentionally partly mechanical and partly judgment-led.
`npm run draft:artifact` consumes one successful run and emits a provisional
linear draft. No command automatically turns arbitrary traces and failures into
an approved semantic graph; the `capability-author` skill defines the
corpus-level review and revision process.

The complete conversion procedure is:

1. Capture at least two clean successful runs from the same reset fixture.
2. Compare their event ledgers, traces, screenshots, and target resolutions.
3. Separate stable actions and state transitions from incidental values,
   generated IDs, timestamps, menu state, and timing.
4. Run `npm run draft:artifact` against the first successful run.
5. Review and revise a typed `CapabilityArtifact` under `src/capabilities/`.
6. Bind invocation values as typed inputs instead of preserving accidental
   literals.
7. Add stable post-action detectors, explicit transitions, and an `otherwise`
   terminal outcome for every stage.
8. Design and capture a small risk-ranked exception matrix; merge only observed
   business outcomes and demonstrated recoveries through explicit review.
9. Enforce the artifact origin and action allowlists with `ArtifactPolicy`.
10. Add or revise a replay pilot using `DeterministicEngine` and the
    `PlaywrightBrowserDriver`.
11. Add focused engine/artifact tests and run the replay from every admitted
    reset scenario.
12. Verify visible terminal checkpoints and authoritative persisted state.
13. Record successful replay run IDs in artifact provenance only after
    verification.

The existing phase-zero example is the model for this process:

- artifact: `src/capabilities/ledgersmb-initialize.ts`;
- replay runner: `src/runtime/ledgersmb-initialize-replay.ts`;
- command: `npm run replay:ledgersmb:initialize`.

That replay command builds, runs `fresh ledgersmb`, executes the reviewed
initialization artifact without an LLM, records another run under `runs/`, and
leaves the verified target running. It does not create or overwrite a snapshot.
After independent checks, create the ending snapshot explicitly:

```sh
scripts/target snapshot ledgersmb initialized-company
```

### Generate a first-pass draft

The repository includes a draft extractor for a finalized successful run. It
uses `events.jsonl` as the semantic source, reads `trace.zip` for Playwright
evidence metadata, and writes an inspectable draft envelope. It does not claim
that the draft is approved or that one happy-path run contains failure branches.

```sh
npm run draft:artifact -- \
  --run runs/<successful-run-id> \
  --id <capability-id> \
  --out tmp/drafts/<capability-id>.json
```

To compare the generated artifact with a compiled hand-reviewed artifact:

```sh
npm run draft:artifact -- \
  --run runs/20260915162457450-f9c72fa6 \
  --id ledgersmb.initialize-company \
  --out tmp/drafts/ledgersmb-initialize.json \
  --compare dist/src/capabilities/ledgersmb-initialize.js \
  --compare-export ledgerSmbInitializeArtifact
```

The command builds first, writes the draft and a comparison report under
`tmp/drafts/`, and reports exact action matches plus detector-signal and
top-level differences. The draft intentionally warns about inferred inputs,
CSS targets, provisional detectors, unresolved sensitive fields, missing typed
outputs, and the absence of red-path or persisted-state review. Treat those
warnings as the review queue before promoting anything into an approved
capability.

Docker reset and snapshot operations belong to the outer harness, not the
browser state graph. Direct database queries may verify preconditions and final
invariants, but must not become replay actions or hidden control-flow inputs.

## Replay design boundaries

- Discovery may decide; replay may execute only the reviewed artifact.
- The engine owns graph traversal, input binding, policy evaluation, target
  resolution, detector matching, extraction, and typed terminal results.
- The surface driver owns browser location, actions, waiting, observation, and
  evidence capture.
- The artifact owns application-specific actions and states.
- Runtime conditions such as validation errors, expired sessions, and missing
  records should be detected and returned as typed outcomes when supported by
  the artifact, not hidden as generic crashes.
- Unknown states that could mutate data or leave the allowed origin are
  stopping conditions, not invitations to guess.

## Validation commands

Use the smallest relevant check, then the full suite for a completed change:

```sh
npm run check
npm run lint
npm run format:check
npm test
npm run verify
```

`npm test` builds first and then runs the compiled Node test suite. The unit
suite does not start Docker targets or a real browser; target-facing captures
and replays are separate local integration operations.

## Git and safety process

Before changing files:

```sh
git rev-parse --show-toplevel
git status --short --branch
git diff -- <paths>
```

Preserve unrelated worktree changes. Do not reset, stash, overwrite, or
reformat unrelated files. Keep changes narrow, add focused tests for behavior
changes, and never weaken a test or policy rule to make the suite pass.

Keep commits path-limited and intentional. Do not commit unless the task or
repository workflow explicitly calls for a commit. When reporting work, state
what changed, what was verified, what was not run, remaining uncertainty, and
the commit count plus short hash and subject when commits were made.

Use synthetic local fixture data. Redact credentials, tokens, cookies,
authorization values, and other secrets from event payloads, URLs, trace titles,
screenshots, and documentation. Do not upload, deploy, publish evidence, or
modify external systems without an explicit request.
