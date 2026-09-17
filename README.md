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

Every reset-to-terminal discovery attempt is saved as one test run. A live run
has a brief README, structured manifest, sanitized event ledger, and Playwright
trace; binary traces may be removed during evidence review. Runs terminate as
either `satisfied` or `error`; failed and exploratory runs are first-class
evidence rather than discarded attempts.

Raw runs live under `runs/<run-id>/` and are ignored by Git. The tracked
[`runs/README.md`](runs/README.md) describes the layout.

After review, any number of finalized successful or failed runs can be promoted
into tracked `evidence/runs/<run-id>/` copies with
`scripts/promote-run <run-id> [<run-id> ...]`.

The toolchain is in place and enforced by CI: strict TypeScript, type-aware
ESLint, Prettier, and EditorConfig, all run by `npm run verify`.

LedgerSMB and Dolibarr are both first-class local browser targets. Their
versions, Docker images, local origins, and complete persistent state boundaries
are pinned. The committed evidence currently retains 11 Dolibarr runs. The six
LedgerSMB capture runs from the earlier corpus were permanently removed from the
repository and its history during the 2026-09-16 rewrite because their binary
traces contained credential-bearing material.

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

Earlier repeated discovery captures produced a reviewed state graph for
LedgerSMB company initialization. The Playwright surface driver and
deterministic engine now replay that artifact without an LLM, enforce exact
target resolution and origin/action policy, bind invocation inputs, route on
screen detectors, and save successful or failed replay runs in the same recorder
shape as discovery.

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
provides `up`, `stop`, `status`, `config`, `url`, `port`, `list`, and `destroy`
commands, and every command accepts `--lane <name>` and `--port <n>` to operate
on an isolated instance instead of the default one. See
[`scripts/author-lane`](#scriptsauthor-lane--one-authoring-session-against-one-private-instance)
for when that matters.

### `scripts/author-lane` — one authoring session against one private instance

Runs the whole lifecycle around an authoring session: provision an isolated
Docker instance at a named checkpoint, hand the goal to `scripts/author`, then
tear the instance down.

```sh
scripts/author-lane \
  --lane lookup \
  --target dolibarr \
  --fixture demo-install-smoke \
  --goal "Look up a Dolibarr third party by exact name and return its account profile."
```

| Option                                                                                  | Meaning                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--lane <name>`                                                                         | Lane name. Lowercase letters, digits, and hyphens. Required.       |
| `--target <name>`                                                                       | `ledgersmb` or `dolibarr`. Required.                               |
| `--fixture <snapshot>`                                                                  | Snapshot to start from, without the target prefix. Required.       |
| `--goal <text>`                                                                         | The capability goal. Required.                                     |
| `--port <n>`                                                                            | Host port. Defaults to one derived from the lane name.             |
| `--keep`                                                                                | Leave the instance running, and print how to inspect or remove it. |
| `--no-author`                                                                           | Provision and tear down without an authoring session.              |
| `--model`, `--max-runs`, `--max-actions`, `--timeout`, `--codex-sandbox`, `--preflight` | Forwarded to `scripts/author`.                                     |

Teardown runs even when the session fails or is interrupted, so a failed lane
cannot keep a database and a port claimed. Use `--keep` when you want to inspect
a failure instead.

#### Why a lane at all

A target's default Compose project, volume names, and host port are pinned, so
two default instances cannot coexist. A lane gets its own project name, its own
volumes, and its own host port, which lets several scenarios run side by side
without sharing a database. The snapshot itself is shared: a snapshot archives
volume _contents_, so the same checkpoint restores into any lane.

Lanes are independent of the default instance too, so a lane can be added while
the default instance keeps running:

```sh
scripts/author-lane --lane alpha --target dolibarr \
  --fixture demo-install-smoke --no-author --keep
scripts/author-lane --lane beta --target dolibarr \
  --fixture demo-install-smoke --no-author --keep

scripts/target port --lane alpha dolibarr
scripts/target destroy --lane alpha dolibarr
```

Every `scripts/target` command accepts `--lane <name>` and `--port <n>`. Without
`--lane`, a target behaves exactly as before: the pinned project, volumes, and
port are untouched.

A lane's session is also given its own origin, because the session's allowlist
holds exactly one origin and a lane answers on a different port. The allowlist is
not widened — a session on a lane refuses the default instance's port as firmly
as it refuses any other.

### `scripts/author` — scripted discovery with an external host

Runs one self-contained authoring session. The script writes a prompt, launches
the Codex CLI once, and reports what came back. Every decision inside that
session — which fixture to reset, how many runs to capture, whether an observed
exception is a business outcome, what the artifact should say — is made by the
model following
[`skills/capability-author/SKILL.md`](skills/capability-author/SKILL.md).

```sh
scripts/author \
  --goal "Look up a Dolibarr third party by exact name and return its account profile." \
  --target dolibarr \
  --fixture demo-install-smoke
```

The launcher owns nothing about the work. It has no browser, no fixture
operation, and no socket of its own, which is what makes concurrency possible:
because a session is one self-contained execution rather than a sequence the
launcher steps through, several can run at once, each on its own lane.

| Option                   | Meaning                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `--goal <text>`          | The capability goal. Required.                                                                             |
| `--target <name>`        | `ledgersmb` or `dolibarr`. Required.                                                                       |
| `--fixture <snapshot>`   | Starting fixture snapshot name. Required.                                                                  |
| `--lane <name>`          | Lane name; defaults to a timestamped value.                                                                |
| `--max-runs <n>`         | Recorded runs allowed in total. Defaults to 8, which leaves room for the happy path plus a failure matrix. |
| `--max-actions <n>`      | Browser actions allowed per run. Defaults to 60.                                                           |
| `--timeout <ms>`         | Whole-session budget. Defaults to one hour.                                                                |
| `--model <model>`        | Model passed to `codex exec`.                                                                              |
| `--codex-sandbox <mode>` | `read-only`, `workspace-write`, or `danger-full-access`.                                                   |
| `--preflight`            | Verify the transport only, without authoring anything.                                                     |
| `--print-prompt`         | Print the prompt and exit.                                                                                 |

Each session writes its prompt, its final message, and its report under
`tmp/discovery/<lane>/`, so what the model was asked is part of the record.

**Sandbox.** Codex runs with full access by default, because the harness needs
it: resetting a fixture invokes Docker, and driving the browser means connecting
to a Unix socket. Both fail inside a restricted sandbox. The trade-off is that
the model has this machine's permissions inside this repository, so review the
diff before committing. The prompt forbids committing, and `--codex-sandbox`
narrows the permissions when a flow does not need Docker.

Start with `--preflight`. It asks the model for one round trip against the
session and exits, so a transport problem is diagnosed in seconds instead of
being inferred from a long run that never got anywhere.

### `scripts/session` — the browser hand

The long-lived side of discovery. A session holds one Playwright context, the run
recorder, the policy gate, and the trace, so it cannot be restarted per action;
this CLI is how a caller reaches the session that is already running.

```sh
scripts/session start --target dolibarr --fixture demo-install-smoke --goal "<goal>"
scripts/session observe [--screenshot]
scripts/session act --type navigate --url <url> --rationale "<why>"
scripts/session act --type activate --role button --name Create --rationale "<why>"
scripts/session act --type fill --css '#username' --value <value> --rationale "<why>"
scripts/session checkpoint --name <name> [--satisfied true|false]
scripts/session finish --status satisfied --summary "<what happened>" --checkpoint <name>
scripts/session finish --status error --summary "<what happened>" --code <code>
scripts/session status
scripts/session stop
```

Targets are given as flags rather than as JSON, because a model composing JSON in
a shell has to escape selectors and quotes by hand, and one mistake costs a turn.
Output is rendered rather than echoed as JSON, for the same reason.

Zero exit status means the session answered, including when it answered
`rejected`; a refusal is an outcome to reason about, not a broken tool. Non-zero
means the command could not be delivered at all.

The session enforces the target's origin and action allowlists and records a
proposal before every action, so a refused action leaves evidence rather than a
gap. Authentication happens before tracing starts, so a fixture credential
reaches neither the trace nor the ledger.

### `scripts/audit-secrets` — scan for credential values

Checks the repository for credential values in the places they actually show up,
using a curated pattern set rather than entropy, and reports whether each file
would travel with a clone.

```sh
scripts/audit-secrets           # gate on files a clone would carry
scripts/audit-secrets --all     # also gate on ignored files, with full detail
scripts/audit-secrets --json    # machine-readable output
```

Exit status is 1 when a blocking finding sits on a committable file. A blocking
finding inside an ignored file — a session cookie in a local trace, a credential
in a pilot's ledger — is reported and does not gate, because every local capture
corpus has them and a command that always fails is a command nobody runs. The
same scan runs inside `npm test`, so a credential reaching a tracked file fails
the suite.

The rules and their curated path exceptions live in `src/audit/secret-scan.ts`.
Two limits are stated in the output rather than left implicit: binary files are
counted and never read, so a clean result says nothing about trace archives,
snapshots, or screenshot pixels; and Git history is a separate pass. See
[`SECURITY.md`](SECURITY.md) for the full audit and how to rerun it.

#### Commit hook

`npm run hooks:install` points this clone's `core.hooksPath` at `scripts/hooks`,
so `scripts/hooks/pre-commit` runs the scan before every commit and refuses the
commit when a credential would be included.

```sh
npm run hooks:install              # once per clone; idempotent
git config --unset core.hooksPath  # to remove it again
```

Git does not share hooks through history, so this is a per-clone step: a fresh
clone has no hook until it runs. The installer refuses to replace a hooks path it
did not set, because silently disabling someone else's hooks is worse than not
installing this one.

The hook reads the index rather than the working tree, so it checks the content
the commit would actually contain — including a credential that was staged and
then removed from the working tree, which a working-tree scan cannot see. If the
scan cannot run at all, the hook refuses the commit rather than passing silently.
`git commit --no-verify` is the deliberate escape hatch.

### `scripts/audit-artifact` — review a capability artifact

Reviews an artifact in two layers, and the difference between them is the point.

```sh
scripts/audit-artifact                              # every artifact
scripts/audit-artifact --capability dolibarr.lookup-third-party
scripts/audit-artifact --source src/capabilities/some-capability.ts
scripts/audit-artifact --capability <id> --model-review
```

**The mechanical layer always runs, and it is free.** It is a rubric of rules
decidable from the artifact alone: whether `targetProfile` resolves, whether policy
origins belong to the target's profile, whether a state-changing activation
resolves by position rather than identity, whether a `fill` or `select` could
observe its own effect, whether the graph is structurally sound and reachable, and
whether the contract's declared inputs and outputs are actually bound and produced.
It exits non-zero on a blocking finding, so it works as a gate.

**The model layer is opt-in** with `--model-review`. It exists only for what a
program cannot decide: whether a detector is meaningful, whether the branch claim
is true, whether any stage was guessed rather than observed. It defaults to
`gpt-5.6-sol` at `medium` — a different model family from the usual author, because
independence matters more than capability in a reviewer — and the reviewer is fixed
so that reviews of different artifacts stay comparable.

The reviewer is told what the mechanical pass already found, so it does not
rediscover it, and it is told to report rather than repair. It also has to cite
evidence for every finding, and it is explicitly asked what the author did _not_
admit to, because an artifact that documents its own weaknesses makes it easy for a
reviewer to add nothing.

Reports land in `tmp/audit/`. `scripts/author-lane --audit` runs this against what a
lane produces, before tearing it down.

#### Where the mechanical layer is enforced

`tests/artifact-quality.test.ts` runs the rubric over every artifact, discovered
from the source tree so a new capability cannot skip it. Only blocking findings
gate: a warning means the artifact is weaker than the skill asks for, and firing the
build on warnings trains everyone to ignore them. Recorded blocking findings live in
a ledger in that file whose counts must match in both directions, so fixing one
forces its entry out and a stale entry cannot survive.

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
