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

The repository contains the complete skill-driven authoring loop and reviewed
deterministic vertical slices for LedgerSMB initialization and Dolibarr
third-party lookup.

[`assignment-proof.md`](assignment-proof.md) tracks each original requirement
against live implementation, tests, evidence, and remaining gaps. It is the
status authority; [`REPORT.md`](REPORT.md) is the shorter required submission
write-up.

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

LedgerSMB and Dolibarr are both first-class local browser targets. Their
versions, Docker images, local origins, and complete persistent state boundaries
are pinned. The committed evidence contains live runs for both targets.

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

Two repeated discovery captures produced a reviewed state graph for LedgerSMB
company initialization. The Playwright surface driver and deterministic engine
now replay that artifact without an LLM, enforce exact target resolution and
origin/action policy, bind invocation inputs, route on screen detectors, and
save successful or failed replay runs in the same evidence shape as discovery.

For Dolibarr, an external LLM drove a long-lived Playwright session one action
at a time. Two happy runs, three exception runs, and a useful failed replay were
reviewed into `dolibarr.lookup-third-party`. Deterministic replays now return a
typed six-field profile, `third-party-not-found`, `third-party-ambiguous`, or an
`authentication-required` intervention without model decisions.

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

### LedgerSMB initialization capture pilot

Build the pilot, replace the current LedgerSMB volumes with a fresh install,
and record the complete company-and-user initialization as one run:

```sh
npm run capture:ledgersmb:initialize
```

The command writes a finalized run under `runs/`, including its event ledger,
Playwright trace, and checkpoint screenshots. It deliberately does not create a
snapshot. After reviewing and verifying a satisfied run, freeze the initialized
fixture separately:

```sh
scripts/target snapshot ledgersmb initialized-company
```

### LedgerSMB initialization replay pilot

Build the deterministic artifact and engine, replace the current LedgerSMB
volumes with a fresh install, then replay the reviewed initialization graph:

```sh
npm run replay:ledgersmb:initialize
```

The command records the replay under `runs/` and leaves the verified initialized
target running. It does not overwrite an existing snapshot. After reviewing the
run and persisted-state assertions, snapshot it under an intentional name with
`scripts/target snapshot ledgersmb <snapshot-name>`.

### LedgerSMB staged captures

Each command resets its named starting fixture and records one independent run:

```sh
npm run capture:ledgersmb:partners
npm run capture:ledgersmb:catalog
npm run capture:ledgersmb:lifecycle
```

They create the customer and vendor, create the warehouse and inventory item,
then exercise and approve the purchase, sale, and physical-count lifecycle.

To prove the complete dependency chain without intermediate snapshot restores,
start from fresh volumes and record all four phases in sequence:

```sh
npm run capture:ledgersmb:end-to-end
```

The command stops at the first failed phase and leaves one run directory per
attempted phase under `runs/`.

### Dolibarr interactive discovery and replay

Reset the demo snapshot, then start an external-controller capture session:

```sh
scripts/target reset dolibarr demo-install-smoke
DOLIBARR_FIXTURE_PASSWORD=<fixture-password> \
  npm run discover:dolibarr:third-party
```

The process exchanges JSONL commands and observations over stdin/stdout while
recording one Playwright trace. The external LLM chooses each action; the repo
does not embed a model SDK.

Replay the reviewed artifact from the same reset snapshot:

```sh
DOLIBARR_FIXTURE_PASSWORD=<fixture-password> \
  npm run replay:dolibarr:third-party
```

Use `DOLIBARR_LOOKUP_NAME`, `DOLIBARR_EXPECT_RESULT`, and
`DOLIBARR_SKIP_AUTH=1` to exercise the admitted business and intervention
branches. The replay writes its typed terminal value to `result.json`.

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

- Capture the `create-trading-partners` phase twice from `initialized-company`.
- Annotate its stable targets and post-action detectors from the repeated traces.
- Add a deliberate replay breakage and preserve the typed failure run.
- Generalize artifact construction only after the second capability exposes the
  first genuinely repeated pattern.
