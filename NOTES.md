# Decision Notes

## 2026-09-15 — Product and learning objective

### Decision

The LedgerSMB and Dolibarr work is a development laboratory, not the product
boundary. The durable product is a skill-guided authoring system that enables a
fresh LLM to take an unfamiliar application from no prior knowledge to a
reviewable deterministic capability.

The intended lifecycle is:

1. A fresh LLM loads the capability-author skill and receives a goal and target.
2. It establishes a reproducible environment and explores the application from
   known starting states.
3. It records each reset-to-terminal attempt, including successful and failed
   runs, as grounded browser evidence.
4. It uses repeated runs to distinguish stable application behavior from
   incidental values, timing, and UI state.
5. It constructs or revises a typed state-graph artifact using only grounded
   actions and explicitly reviewed detectors and recovery branches.
6. It executes that artifact through the generic deterministic engine without
   an LLM in the replay decision loop.
7. It resets and repeats replay, deliberately exercises useful failure states,
   and feeds every architectural lesson back into the skill and generic tooling.

### Development method

Everything learned while working through the selected target applications must
improve one of three durable layers:

- the capability-author skill, which tells a future LLM how to explore, record,
  reason about evidence, construct artifacts, test replay, and classify failures;
- generic scripts and interfaces for fixture lifecycle, capture, compilation,
  deterministic execution, evidence, policy, and handoff; or
- target-specific profiles and artifacts that contain application knowledge
  without leaking that knowledge into the generic engine.

Do not optimize merely for completing the four LedgerSMB scenarios. Use those
scenarios to discover the minimum general process, data model, and runtime a new
application will need. When an experiment exposes a weak locator, missing event,
ambiguous state transition, unsafe assumption, or awkward manual step, preserve
the run and update the skill with the general lesson before moving on.

### Success boundary

The project succeeds when the repository demonstrates one complete vertical
slice and the skill explains how to repeat the method on a new application. The
four LedgerSMB phases provide progressively richer training cases for building
that method. Dolibarr checks that the resulting architecture and instructions
are not accidentally LedgerSMB-specific.

## 2026-09-15 — Target application

### Decision

Use **LedgerSMB** as the primary target application. Keep **Dolibarr** as the
fallback.

### Rationale

- Dolibarr may prove to be the stronger target on purely technical or practical
  grounds.
- LedgerSMB is more closely aligned with the assignment's banking and financial
  back-office setting.
- That domain alignment is important enough to evaluate LedgerSMB first.

### Implications

- Pin and evaluate a specific LedgerSMB release before designing around its UI.
- Choose a workflow that exercises search, detail inspection, typed outputs,
  runtime outcomes, and a conservative boundary around state-changing actions.
- Fall back to Dolibarr if LedgerSMB cannot provide a repeatable local setup or a
  sufficiently useful workflow without disproportionate setup work.

### Still open

- LedgerSMB version and local deployment method.
- Representative workflow and seeded fixture data.

## 2026-09-15 — Authoring and execution architecture

### Decision

Separate the probabilistic capability-authoring plane from the deterministic
execution plane.

- A dense authoring skill guides LLM discovery, exception authoring, and artifact
  revision.
- A typed event ledger records actions and observations that actually occurred.
- An artifact compiler produces a versioned state graph from grounded evidence.
- A deterministic engine interprets approved artifacts without an LLM in its
  decision loop.
- Playwright is the first surface adapter rather than an engine dependency.
- Target-wide state knowledge lives in application profiles.
- Session ownership and human intervention live behind explicit control-transfer
  types.

### Scope amendment

Develop LedgerSMB and Dolibarr as first-class targets at the same time. LedgerSMB
remains the primary domain narrative, while Dolibarr validates that the
architecture is not accidentally coupled to one application. Dolibarr is no
longer only a dormant fallback.

### Still open

- Exact capability schema and graph semantics.
- Model provider and structured decision protocol.
- Persistent event-ledger format.
- Artifact validation and approval mechanism.
- Target versions, fixtures, and workflows.

## 2026-09-15 — Capture-first authoring loop

### Decision

Keep the capability-author skill monolithic while the architecture is changing
quickly. Its supporting references have been folded into the main `SKILL.md` so
the instructions can be revised as one unit.

The current authoring phase captures evidence only:

- Every attempt starts from a reset fixture.
- One reset-to-terminal attempt is one test run.
- A run ends as either `satisfied` or `error`.
- Every run retains a brief README, structured manifest, event ledger, and
  Playwright trace.
- A retry after another reset creates a separate run.
- Raw local run directories are ignored by Git.

### Deferred

Do not synthesize a stage graph, compile a deterministic artifact, or replay one
as part of this loop. Those steps follow after the capture corpus exposes the
real happy paths and exception shapes.

## 2026-09-15 — Evidence promotion

### Decision

Keep all raw test runs under the Git-ignored `runs/` tree. A completed run may be
explicitly marked as submission evidence by copying it, unchanged, to
`evidence/runs/<run-id>/`.

- Both `satisfied` and `error` runs may be promoted.
- Any number of distinct runs may be retained as evidence.
- Promotion must not remove or modify the raw run.
- Existing evidence is never overwritten implicitly.
- The run must be reviewed for secrets and unintended customer data first,
  especially inside the Playwright trace.

## 2026-09-15 — Repeatable target fixtures

### Decision

Use one target lifecycle for LedgerSMB and Dolibarr: `fresh`, `up`, `snapshot`,
`reset`, `stop`, and `destroy`. A named snapshot is a cold archive of every
persistent Docker volume plus a checksummed manifest.

- LedgerSMB 1.13.7 is pinned with PostgreSQL 15.14.
- Dolibarr 23.0.4 is pinned with MariaDB 11.4.8 and starts with its official demo
  data option enabled.
- Application, database, and snapshot-helper images are pinned by multi-platform
  digest.
- LedgerSMB snapshots its PostgreSQL volume.
- Dolibarr snapshots MariaDB, documents, and custom-module volumes.
- Every reset validates the snapshot before replacing current state and writes a
  reset receipt for the later capture loop.
- Raw snapshots remain local and Git-ignored.

### Rationale

The assignment needs a scalable demonstration, not exhaustive exception
coverage. Stable named starting points let us run a small, deliberate matrix of
happy and red scenarios without coupling the capture loop to one application's
storage layout.

### Still open

- The first reviewed baseline snapshot for each target.
- Exact synthetic entities and transactions in those baselines.
- The representative prompt matrix for exploration and evidence capture.

## 2026-09-15 — Four-phase LedgerSMB capability corpus

### Decision

Use four bounded LedgerSMB capabilities as the core training, recording, and
replay corpus. Each capability starts from a named state, ends at a named
snapshot, and is recorded as an independent run.

0. `initialize-company`
   - Start: fresh LedgerSMB Docker volumes created by `scripts/target fresh`.
   - Create the company database, select the chart of accounts and templates,
     create the initial administrator with the required permissions, log in, and
     verify that the application is usable.
   - End: `initialized-company`
1. `create-trading-partners`
   - Start: `initialized-company`
   - Create the synthetic customer and vendor with valid customer/vendor account
     classes and AR/AP defaults.
   - End: `partners-ready`
2. `create-inventory-catalog`
   - Start: `partners-ready`
   - Create `Main Warehouse` and the `TRAIL-PACK-40` inventory part with its
     pricing, unit, bin, reorder point, and account mappings.
   - End: `catalog-ready`
3. `exercise-inventory-lifecycle`
   - Start: `catalog-ready`
   - Post the 30-unit vendor purchase, post the three-unit customer sale, record
     a physical count of 25 from 27 expected, and approve the two-unit shortage.
   - End: `clean-baseline-v1`

The snapshot progression is therefore:

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

### Recording contract

- Invoke `fresh` for every `initialize-company` attempt. Reset to the named
  starting snapshot for every later capability attempt.
- Treat each reset-to-terminal attempt as a separate run.
- Capture the prompt, reset receipt, manifest, event ledger, Playwright trace,
  meaningful checkpoint screenshots, outcome, and run README.
- Capture at least two clean successful runs per capability before treating the
  interaction as understood.
- Preserve useful failed attempts as distinct runs and classify their failures.
- Compare repeated successes to identify incidental values such as timestamps,
  generated identifiers, transient DOM identifiers, menu state, and response
  timing before compiling deterministic selectors and transitions.

### Replay boundary

The deterministic replay must operate through the application UI and branch on
observable application state. Direct database queries may verify preconditions
and final accounting invariants, but they are test assertions rather than
replay actions or control-flow inputs.

The first successful Playwright trace is evidence, not the specification. The
stage graph should be compiled only after repeated recordings expose the stable
actions, observations, terminal conditions, and known exception shapes.

### Phase-zero replay pilot

Use `initialize-company` as the first deterministic engine pilot because it has
an exact empty starting condition and an unambiguous authenticated terminal
condition. The pilot must establish the minimum reusable engine behavior:

- validate its starting state and allowed origin;
- resolve stable semantic targets and enter typed inputs;
- wait for navigations and asynchronous application transitions;
- detect expected screens and terminal checkpoints;
- preserve a complete run when a stage fails;
- redact sensitive inputs from durable event evidence;
- verify the resulting company, user, permissions, and usable landing page; and
- create `initialized-company` only after all verification passes.

Docker `fresh` and `snapshot` operations belong to the surrounding harness, not
the browser stage graph. Browser authentication is part of `initialize-company`
because it proves the created account works. Later capabilities should use a
small authentication bootstrap or validated browser storage state rather than
recording login as part of every business workflow.

## 2026-09-15 — First deterministic replay slice

### Decision

Use the two successful `initialize-company` discovery runs to create the first
reviewed state graph and execute it with no model in the replay loop.

- Discovery source: `20260915162457450-f9c72fa6`
- Repeated discovery corroboration: `20260915162602665-abdeb328`
- Useful failed replay: `20260915170332042-8b83c035`
- Successful replay validations: `20260915170358856-fe344f46` and
  `20260915170434612-2d03545d`

The failed replay exposed a recorder-integrity issue: the event said the login
button was `form button`, while the discovery code actually found a button by
role inside the form. Exact target resolution rejected the false CSS locator.
The reviewed artifact now uses the role and accessible name that the discovery
actually exercised.

### Verified boundary

Both successful replays started from fresh Docker volumes and reached the
authenticated LedgerSMB home screen. The first replay was independently checked
for one application user, 136 LedgerSMB roles, and zero AR records, AP records,
parts, or entity credit accounts.

### Architecture learned

- Recorded actions ground the artifact, but stable detectors are reviewed
  annotations derived from repeated traces.
- The engine owns traversal, input binding, policy, and typed outcomes.
- The Playwright driver owns exact location, browser actions, state detection,
  extraction, and failure screenshots.
- Replay uses the same run evidence layout as discovery.
- Do not overwrite the existing `initialized-company` snapshot implicitly;
  snapshot creation remains an intentional post-verification harness action.
