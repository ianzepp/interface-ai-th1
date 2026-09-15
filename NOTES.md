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

- The external LLM host loads the repo-owned authoring skill and is the
  discovery control plane. The repository does not embed a duplicate model loop.
- A typed event ledger records actions and observations that actually occurred.
- A mechanical extractor produces a provisional linear draft from a successful
  run. The LLM-guided authoring session compares the run corpus and uses explicit
  judgment to revise that draft into a versioned state graph.
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

### Boundary ruling

Do not add an embedded model-provider SDK, a second autonomous discovery-agent
class, or an automatic semantic failure-to-graph compiler merely to duplicate
the LLM host and skill. The required integration proof is a recorded
corpus-level authoring session in which the skill-driven LLM operates the live
surface and the resulting reviewed artifact passes deterministic replay.

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

### Replay timing baseline

The two successful deterministic initialization replays took 6.495 seconds and
6.439 seconds from replay-run creation through finalization, for a mean of 6.467
seconds. The complete development command, including compilation, destructive
Docker reset, service health checks, and browser replay, took approximately
14–15 seconds in the observed local runs.

`run.json` directly stores the replay `startedAt` and `finishedAt` timestamps.
`events.jsonl` stores timestamps for every completed action and detector
checkpoint, so stage durations are derivable even though they are not currently
materialized as explicit duration fields. The outer compilation and Docker-reset
time is not part of the replay metadata.

Mean stage durations across the two successful replays (`n = 2`) were:

| Stage                   |     Mean |
| ----------------------- | -------: |
| `open-setup`            |   319 ms |
| `fill-db-admin`         |    24 ms |
| `fill-db-password`      |    35 ms |
| `fill-company`          |    11 ms |
| `create-company`        | 3,439 ms |
| `open-country-list`     |    49 ms |
| `choose-chart-country`  |    39 ms |
| `confirm-chart-country` |   256 ms |
| `confirm-chart`         |   341 ms |
| `load-templates`        |   245 ms |
| `fill-username`         |    12 ms |
| `fill-user-password`    |    12 ms |
| `fill-first-name`       |    10 ms |
| `fill-last-name`        |    10 ms |
| `fill-employee-number`  |    11 ms |
| `fill-birth-date`       |    13 ms |
| `fill-tax-id`           |     8 ms |
| `open-salutation`       |    46 ms |
| `choose-salutation`     |    48 ms |
| `open-country`          |    80 ms |
| `choose-country`        |   101 ms |
| `open-permissions`      |    71 ms |
| `choose-permissions`    |    83 ms |
| `create-user`           |   271 ms |
| `open-login`            |    77 ms |
| `fill-login-user`       |    12 ms |
| `fill-login-password`   |    10 ms |
| `fill-login-company`    |     9 ms |
| `authenticate`          |   531 ms |
| `dismiss-expiry`        |   263 ms |

## 2026-09-15 — Remaining LedgerSMB discovery captures

The three post-initialization phases now each have two successful recorded
runs from their named starting fixture:

| Phase                          | Successful runs                                            | Mean capture time |
| ------------------------------ | ---------------------------------------------------------- | ----------------: |
| `create-trading-partners`      | `20260915172018412-bc071dc3`, `20260915172035044-358c074c` |           3.639 s |
| `create-inventory-catalog`     | `20260915172329463-f794ccde`, `20260915172345524-ddd21616` |           2.951 s |
| `exercise-inventory-lifecycle` | `20260915174132599-b4f1d635`, `20260915174207782-dc9b4034` |          12.785 s |

These durations come directly from each run's `startedAt` and `finishedAt`
metadata and exclude fixture reset, compilation, and service health checks.

The lifecycle's persisted-state check confirmed posted purchase `BILL-2001`
for 2,175 USD, posted sale `INV-1001` for 387 USD, approved physical count
`COUNT-001`, expected quantity 27, counted quantity 25, variance -2, and final
on-hand quantity 25.

Useful failures captured during lifecycle authoring exposed two reusable UI
conditions. A known password-expiry interstitial can block the first menu action
and must be handled as an explicit branch. More subtly, a route change can occur
before a client-rendered content frame changes; a replay must wait for a unique
marker on the destination stage before resolving controls whose labels are
shared with the prior stage. The physical-count workflow also requires an
explicit accounting-effective date even though the UI accepts a blank field.

### Fresh end-to-end proof

`npm run capture:ledgersmb:end-to-end` subsequently succeeded from fresh Docker
volumes without intermediate snapshot restores. It produced four satisfied run
artifacts in sequence:

- `20260915174522338-d689ee84` — initialize company and administrator (5.374 s)
- `20260915174527865-4ee2f9eb` — create trading partners (4.304 s)
- `20260915174532327-fbb724a9` — create inventory catalog (2.890 s)
- `20260915174535371-b7e6f918` — exercise inventory lifecycle (10.082 s)

The captured browser phases spanned 23.115 seconds from the first run's start to
the last run's finish. This excludes compilation, fresh-volume creation, and
service health checks. A final independent database check reproduced the same
posted amounts, approved count, variance, and on-hand quantity listed above.

The first contiguous attempt failed even though each isolated fixture-based
phase had passed. Item autocomplete had closed before its dependent description
and price fields finished populating, allowing the replay to race the
application and submit an invalid sales price. Waiting for application-derived
field values, rather than adding a fixed delay, made both the isolated and
contiguous execution paths deterministic.

Company database creation dominates the replay at roughly 53% of total browser
time. These numbers are an initial local baseline rather than a performance
claim; future evidence should report hardware/environment, sample count, and a
distribution rather than only a mean.
