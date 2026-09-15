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

The assignment has been reviewed. The repository contains the initial
architecture skeleton, but current implementation work is intentionally focused
on the capture-only authoring loop.

Every reset-to-terminal discovery attempt is saved as one test run. A run has a
brief README, structured manifest, sanitized event ledger, and Playwright trace.
Runs terminate as either `satisfied` or `error`; failed and exploratory runs are
first-class evidence rather than discarded attempts.

Raw runs live under `runs/<run-id>/` and are ignored by Git. The tracked
[`runs/README.md`](runs/README.md) describes the layout.

After review, any number of finalized successful or failed runs can be promoted
into tracked `evidence/runs/<run-id>/` copies with
`scripts/promote-run <run-id> [<run-id> ...]`.

The toolchain is in place and enforced by CI: strict TypeScript, type-aware
ESLint, Prettier, and EditorConfig, all run by `npm run verify`.

LedgerSMB and Dolibarr are both first-class local browser targets. Their versions,
Docker images, local origins, and complete persistent state boundaries are now
pinned. Their detectors, named fixture contents, and representative workflows
remain to be grounded through live inspection.

Both targets use one snapshot lifecycle:

```sh
scripts/target fresh dolibarr
# Explore or arrange synthetic fixture data in the browser.
scripts/target snapshot dolibarr demo-baseline
scripts/target reset dolibarr demo-baseline
```

Replace `dolibarr` with `ledgersmb` to use the same lifecycle there. `fresh` and
`reset` are destructive only to the selected target's local Docker volumes.
Named snapshots live under `snapshots/<target>/<name>/`, include a checksummed
manifest, and are ignored by Git. Run `scripts/target --help` for non-destructive
start, stop, status, URL, and snapshot-listing commands.

Stage-graph synthesis and deterministic replay are explicitly deferred until the
capture corpus is useful.

The original assignment PDF is available locally as `assignment.pdf` and is
intentionally ignored by Git.

## Project Scripts

### `scripts/target`

Manages the pinned LedgerSMB and Dolibarr Docker environments and their local
snapshots. Run `scripts/target --help` for the complete command list; the usual
workflow is:

```sh
scripts/target fresh dolibarr
scripts/target snapshot dolibarr demo-baseline
scripts/target reset dolibarr demo-baseline
```

Use `ledgersmb` in place of `dolibarr` for the other target. The script also
provides `up`, `stop`, `status`, `config`, `url`, `list`, and `destroy` commands.

### `scripts/promote-run`

Copies one or more reviewed, completed local runs into the tracked evidence
directory without modifying the originals or overwriting existing evidence.

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

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

- Launch both applications and replace target-profile detector stubs with observed facts.
- Create and inspect the first named baseline snapshot for each target.
- Select the smallest capture scenario against each grounded baseline.
- Wire the model-driven computer-use loop to the run recorder.
- Capture happy-path and deliberate error runs for both targets.
- Turn every must-have requirement into an executable acceptance check.
