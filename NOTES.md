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
