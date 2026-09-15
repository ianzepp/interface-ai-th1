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

The assignment has been reviewed. The target will be a locally hosted,
browser-based finance, banking, or accounting application. The concrete target,
implementation stack, and architecture remain open decisions.

The original assignment PDF is intentionally kept outside this repository.

## Next Actions

- Evaluate LedgerSMB, Mifos X, and Dolibarr as target applications.
- Select and pin the target application version.
- Define the smallest representative workflow and exceptional states.
- Choose the implementation stack and capability-artifact schema.
- Turn every must-have requirement into an executable acceptance check.
