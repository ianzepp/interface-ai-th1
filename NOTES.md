# Decision Notes

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
