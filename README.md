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

The toolchain is in place and enforced by CI: strict TypeScript, type-aware
ESLint, Prettier, and EditorConfig, all run by `npm run verify`.

LedgerSMB and Dolibarr are both first-class local browser targets. Their versions,
detectors, fixtures, and representative workflows remain to be grounded through
live inspection.

The original assignment PDF is available locally as `assignment.pdf` and is
intentionally ignored by Git.

## Development

Requires Node 24 or newer.

```sh
npm ci
```

| Command                | What it does                               |
| ---------------------- | ------------------------------------------ |
| `npm run build`        | Compile to `dist/`                         |
| `npm run check`        | Typecheck without emitting                 |
| `npm test`             | Build, then run the Node test runner suite |
| `npm run lint`         | ESLint with type-aware rules               |
| `npm run lint:fix`     | ESLint with autofixes                      |
| `npm run format`       | Write Prettier formatting                  |
| `npm run format:check` | Verify formatting without writing          |
| `npm run verify`       | Typecheck, lint, format check, and test    |

`npm run verify` is what CI runs on every push and pull request.

### TypeScript version

Pinned to TypeScript 6. TypeScript 7 is the native compiler and is faster, but it
ships no programmatic compiler API yet, so `typescript-eslint` cannot load it and
type-aware linting would be impossible. Compile speed is not a constraint here:
this system spends its time driving browser surfaces, not building. One compiler
serves both the build and the linter, so the two can never disagree.

When TypeScript 7.1 ships an API that `typescript-eslint` supports, this pin moves
to 7 in a single dependency bump.

## Next Actions

- Select and pin LedgerSMB and Dolibarr versions.
- Launch both applications and replace target-profile stubs with observed facts.
- Define the smallest representative workflow and exceptional states.
- Harden the draft graph semantics before implementing the compiler and engine.
- Turn every must-have requirement into an executable acceptance check.
