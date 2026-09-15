# interface.ai Computer-Use Take-Home

## Intent

Build a small, complete computer-use automation system for the interface.ai
engineering take-home assignment.

The required vertical slice is:

1. An LLM discovers a workflow by operating a real local browser application.
2. The successful run becomes a typed, versioned capability artifact.
3. A deterministic executor replays that artifact without an LLM making decisions.
4. The system reports typed outputs, business outcomes, recoverable conditions, and
   hard failures.
5. A human can take control of the same live session and return control to the
   automation.
6. Guardrails, redacted observability, and evidence cover discovery and replay.

## Current State

The assignment has been reviewed. The repository now contains the initial
TypeScript architecture skeleton: a capability-authoring skill and event ledger,
versioned JSON schemas, a deterministic runtime, a Playwright surface adapter,
target profiles, and human-control seams.

LedgerSMB and Dolibarr are both first-class local browser targets. Their versions,
detectors, fixtures, and representative workflows remain to be grounded through
live inspection.

The original assignment PDF is available locally as `assignment.pdf` and is
intentionally ignored by Git.

## Next Actions

- Select and pin LedgerSMB and Dolibarr versions.
- Launch both applications and replace target-profile stubs with observed facts.
- Define the smallest representative workflow and exceptional states.
- Harden the draft graph semantics before implementing the compiler and engine.
- Turn every must-have requirement into an executable acceptance check.
