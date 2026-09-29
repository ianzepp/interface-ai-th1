# interface.ai Computer-Use Take-Home

A small computer-use system for legacy back-office applications. An external
LLM drives a real browser application one observed action at a time; a
reviewed, typed capability artifact captures what it learned; a deterministic
engine replays that artifact with no model in the loop; and when automation
cannot safely proceed, a human takes over the same live browser session and
hands it back.

[`REPORT.md`](REPORT.md) is the design write-up. [`evidence/`](evidence/) holds
the runs that prove each step. The two proxy targets are
[Dolibarr](https://www.dolibarr.org/) 23.0.4 and
[LedgerSMB](https://ledgersmb.org/) 1.13.7, pinned and run locally in Docker
with their own synthetic demo data.

## Setup

Requirements:

- Node.js 24 or newer, and npm.
- Docker Engine or Docker Desktop with Compose v2, running.
- `curl` and `unzip`.
- For discovery only: the [Codex CLI](https://github.com/openai/codex)
  (`codex`), signed in with access to a model. The repository embeds no model
  SDK and holds no API key; the model host is external by design. Replay and
  the test suite need no model.

```sh
npm ci
npx playwright install chromium
npm run hooks:install        # optional: credential scan before every commit
```

The fixture credentials are synthetic, loopback-only values declared in the
Compose files. Export them from there rather than copying them anywhere:

```sh
export DOLIBARR_FIXTURE_PASSWORD=$(sed -n 's/^ *DOLI_ADMIN_PASSWORD: *//p' targets/dolibarr/compose.yaml)
export LEDGERSMB_FIXTURE_PASSWORD=$(sed -n 's/^ *POSTGRES_PASSWORD: *//p' targets/ledgersmb/compose.yaml | head -1)
```

Snapshots are local and ignored by Git, so create the Dolibarr starting fixture
once. `fresh` installs Dolibarr with its official demo data:

```sh
scripts/target fresh dolibarr
scripts/target snapshot dolibarr demo-install-smoke
```

### Without live services

```sh
npm run verify
```

Typecheck, lint, format check, and 150 tests. It starts no Docker target, no
browser application, and no model. Everything the live runs produced is already
committed under [`evidence/`](evidence/).

## Demo path

### 1. Run the agent on a goal, with a human escalation

The goal below is deliberately under-specified: Dolibarr's demo data has two
open third parties named exactly `aaa`. The prompt gives the model a general
rule — escalate rather than guess when a judgment is not yours — and never
mentions this case.

In one terminal, start the scripted operator. It waits for a handoff, then acts
on out-of-band knowledge the model does not have: which customer the caller
means. In Dolibarr 23.0.4's demo data that record is `socid=58`.

```sh
scripts/mock-operator --lane demo \
  --rationale "The caller's account is customer code CU2506-00032; open that record." \
  -- --type navigate --url 'http://127.0.0.1:8080/societe/card.php?socid=58'
```

In a second terminal, run one discovery session:

```sh
scripts/author --single-run --target dolibarr --fixture demo-install-smoke \
  --lane demo --max-actions 25 \
  --goal 'Look up the Dolibarr third party named exactly "aaa" and report its customer code, vendor code, currency, and status.'
```

Codex resets the fixture, starts a recorded session, and drives it through
`scripts/session` (observe, then act, one action at a time). When it sees two
matches it runs `scripts/session escalate`. That records an intervention request
with a screenshot and hands the lease to the operator. The operator acts in the
same browser and runs `scripts/session resume`. Automation then checks the page
against the reviewed artifact's detectors before taking control back. It reads
the record and finishes. The run lands in `runs/<run-id>/`. The committed
instance of this run is
[`20260929120114404-0aa09c9c`](evidence/runs/20260929120114404-0aa09c9c/).

Drop the operator and use a unique name, such as `Book Keeping Company`, for a
plain discovery run. Review a finished run, then promote it:

```sh
scripts/promote-run <run-id>
npm run draft:artifact -- --run runs/<run-id> --id <capability-id> --out tmp/drafts/<capability-id>.json
```

The draft is a provisional linear graph with a warning list. A reviewed artifact
is written by hand from the whole corpus: which states are stable, which
failures are business outcomes. The committed lookup artifact,
[`src/capabilities/dolibarr-third-party-lookup.ts`](src/capabilities/dolibarr-third-party-lookup.ts),
is that review of the 2026-09-15 discovery corpus for this goal.

### 2. Replay the artifact deterministically

Each command resets the fixture, replays the reviewed artifact with no model,
and writes the typed result to `runs/<run-id>/result.json`:

```sh
npm run replay:dolibarr:third-party
DOLIBARR_LOOKUP_NAME="No Such Fixture Company" DOLIBARR_EXPECT_RESULT=third-party-not-found \
  npm run replay:dolibarr:third-party
DOLIBARR_LOOKUP_NAME=aaa DOLIBARR_EXPECT_RESULT=third-party-ambiguous \
  npm run replay:dolibarr:third-party
DOLIBARR_SKIP_AUTH=1 DOLIBARR_EXPECT_RESULT=authentication-required \
  npm run replay:dolibarr:third-party
```

These give, in order:

- `success`, with six typed outputs;
- the `third-party-not-found` business outcome;
- the `third-party-ambiguous` business outcome;
- `intervention-required` / `authentication-required`, when the protected
  route redirects to login.

The other two artifacts replay the same way:

```sh
npm run replay:dolibarr:create-party
npm run replay:ledgersmb:initialize
```

## Evidence map

| What                                                  | Where                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed artifacts as JSON                            | [`evidence/capabilities/`](evidence/capabilities/)                                                                                                                                                                                                                                                                                       |
| LLM discovery with escalation and same-session resume | [`20260929120114404-0aa09c9c`](evidence/runs/20260929120114404-0aa09c9c/)                                                                                                                                                                                                                                                                |
| LLM discovery corpus behind the lookup artifact       | [`…201727769-f02bcb33`](evidence/runs/20260915201727769-f02bcb33/), [`…201943054-c67afa9b`](evidence/runs/20260915201943054-c67afa9b/), plus exception runs [`…6995a2e8`](evidence/runs/20260915202031432-6995a2e8/), [`…97cf9873`](evidence/runs/20260915202113470-97cf9873/), [`…9abd1d52`](evidence/runs/20260915202202470-9abd1d52/) |
| Replay: success (twice, byte-identical outputs)       | [`…004445ba`](evidence/runs/20260915202650455-004445ba/), [`…48b0cf0c`](evidence/runs/20260915202710527-48b0cf0c/); re-run 2026-09-29 with the same outputs: [`…c8587ea8`](evidence/runs/20260929121117013-c8587ea8/)                                                                                                                    |
| Replay: business outcomes and intervention            | [`…7b93abd6`](evidence/runs/20260915202725488-7b93abd6/) not found, [`…769ba7f6`](evidence/runs/20260915202742493-769ba7f6/) ambiguous (re-run: [`…e11cb309`](evidence/runs/20260929121131073-e11cb309/)), [`…ed9759b5`](evidence/runs/20260915202758596-ed9759b5/) authentication required                                              |
| Replay: a real failure, with its stage and screenshot | [`…f1eee304`](evidence/runs/20260915202607595-f1eee304/)                                                                                                                                                                                                                                                                                 |
| Replays of the other two artifacts                    | [`…05d43891`](evidence/runs/20260915215946224-05d43891/) create customer and contact, [`…6d5315d1`](evidence/runs/20260929120812777-6d5315d1/) LedgerSMB initialization                                                                                                                                                                  |

Each run holds `README.md` (a short human account), `run.json` (manifest,
outcome, and producer attestation where a model decided), `events.jsonl` (every
observation, proposal, policy verdict, action, intervention, and control
transfer), `screenshots/`, and `result.json` for Dolibarr replays. Trace
archives stay local; [`evidence/README.md`](evidence/README.md) explains why.

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
provides `up`, `stop`, `status`, `config`, `url`, `port`, `reserve-port`, `list`,
and `destroy` commands. `reserve-port` is used by `scripts/author-lane`. Every
command accepts `--lane <name>` and `--port <n>` to operate on an isolated
instance instead of the default one. See
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

| Option                                                                                                        | Meaning                                                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--lane <name>`                                                                                               | Lane name. Lowercase letters, digits, and hyphens. Required.       |
| `--target <name>`                                                                                             | `ledgersmb` or `dolibarr`. Required.                               |
| `--fixture <snapshot>`                                                                                        | Snapshot to start from, without the target prefix. Required.       |
| `--goal <text>`                                                                                               | The capability goal. Required.                                     |
| `--port <n>`                                                                                                  | Host port. Defaults to one derived from the lane name.             |
| `--workspace <path>`                                                                                          | Isolated worktree path. Defaults to `worktrees/<lane>`.            |
| `--no-isolation`                                                                                              | Use the shared working tree instead of an isolated worktree.       |
| `--keep`                                                                                                      | Leave the instance running, and print how to inspect or remove it. |
| `--no-author`                                                                                                 | Provision and tear down without an authoring session.              |
| `--audit`                                                                                                     | Audit the produced artifact before teardown.                       |
| `--model`, `--reasoning-effort`, `--max-runs`, `--max-actions`, `--timeout`, `--codex-sandbox`, `--preflight` | Forwarded to `scripts/author`.                                     |

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

| Option                       | Meaning                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `--goal <text>`              | The capability goal. Required.                                                          |
| `--target <name>`            | `ledgersmb` or `dolibarr`. Required.                                                    |
| `--fixture <snapshot>`       | Starting fixture snapshot name. Required.                                               |
| `--lane <name>`              | Lane name; defaults to a timestamped value.                                             |
| `--origin <url>`             | Allowed origin; defaults to the target profile's origin.                                |
| `--max-runs <n>`             | Recorded runs allowed in total. Defaults to 12, including two reserved validation runs. |
| `--max-actions <n>`          | Browser actions allowed per run. Defaults to 60.                                        |
| `--timeout <ms>`             | Whole-session budget. Defaults to one hour.                                             |
| `--model <model>`            | Model passed to `codex exec`.                                                           |
| `--reasoning-effort <level>` | Reasoning effort passed to `codex exec`.                                                |
| `--codex-sandbox <mode>`     | `read-only`, `workspace-write`, or `danger-full-access`.                                |
| `--single-run`               | Capture one recorded discovery run toward the goal instead of authoring a capability.   |
| `--preflight`                | Verify the transport only, without authoring anything.                                  |
| `--print-prompt`             | Print the prompt and exit.                                                              |

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

`--single-run` is the demo path's discovery step: one reset, one session, one
run, and a general instruction to escalate instead of guessing. Without it the
session works the skill's whole corpus loop.

The launcher seals a producer record before Codex starts and folds Codex's own
session id (`thread_id`) and stream digest into every run it produced, which is
what promotion checks. Codex does not report the model it resolved, so the
attested model is `null`; the requested model is in
`tmp/discovery/<lane>/session-metadata.json`.

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
scripts/session escalate --reason "<what you see and why you stopped>"
scripts/session wait-for-control [--timeout <ms>]
scripts/session take-control
scripts/session human-observe [--screenshot]
scripts/session human-act --type activate --role button --name Save --rationale "<why>"
scripts/session resume
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

Control is a lease with an epoch. `escalate` (automation) or `take-control`
(operator) moves it to a human; `human-observe` and `human-act` then work only
under the human's epoch, and automation's `act` is refused. `resume` asks
automation to check the live page against the reviewed artifact's detectors:
a match returns the lease to automation at the matching stage, and anything
else is recorded as `resume-rejected` and leaves the human in control.

### `scripts/mock-operator` — the scripted operator console

The assignment lets the operator console be mocked; this is that mock. It waits
until a lane's session hands control to a human, observes the live page,
performs one recorded `human-act`, and runs `resume` — all through
`scripts/session`, so the ledger records it exactly as it would a person.

```sh
scripts/mock-operator --lane <lane> --rationale "<why>" [--timeout <seconds>] \
  -- <human-act action flags>
```

### `scripts/audit-secrets` — scan for credential values

Checks the repository for credential values in the places they actually show up,
using a curated pattern set rather than entropy, and reports whether each file
would travel with a clone.

```sh
scripts/audit-secrets                 # gate on files a clone would carry
scripts/audit-secrets --staged        # scan the staged index used by a commit
scripts/audit-secrets --all           # also gate on ignored files, with full detail
scripts/audit-secrets --json          # machine-readable output
scripts/audit-secrets --root <path>   # scan a repository root other than cwd
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

### `npm run draft:artifact` — extract a provisional artifact

Builds and extracts an inspectable linear draft from one finalized successful
run. The draft remains provisional and needs corpus-level review.

```sh
npm run draft:artifact -- --run runs/<run-id> --id <capability-id> --out <path>
```

### `scripts/export-artifact` — export reviewed artifacts

Builds and writes every reviewed source artifact as deterministic JSON under
`evidence/capabilities/`. The npm alias is `npm run export:artifact`.

```sh
npm run export:artifact
```

### `scripts/promote-run`

Copies one or more reviewed, completed local runs into the tracked evidence
directory without modifying the originals or overwriting existing evidence. A
run must contain `README.md`, `run.json`, `events.jsonl`, and `trace.zip`. A run
that records model or human decisions must carry a launcher-sealed, attested
producer and a valid decision-receipt chain. A deterministic replay may omit the
producer only if its ledger holds no decision or handoff event. A
`sensitive-evidence-detected` outcome is refused. The copied `trace.zip` is
ignored by Git; see [`evidence/README.md`](evidence/README.md).

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

### LedgerSMB initialization capture pilot

Build the pilot, replace the current LedgerSMB volumes with a fresh install,
and record the complete company-and-user initialization as one run:

```sh
LEDGERSMB_FIXTURE_PASSWORD=<fixture-password> \
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
LEDGERSMB_FIXTURE_PASSWORD=<fixture-password> \
  npm run replay:ledgersmb:initialize
```

The command records the replay under `runs/` and leaves the verified initialized
target running. It does not overwrite an existing snapshot. After reviewing the
run and persisted-state assertions, snapshot it under an intentional name with
`scripts/target snapshot ledgersmb <snapshot-name>`.

### LedgerSMB staged captures

Each command resets its named starting fixture and records one independent run:

```sh
LEDGERSMB_FIXTURE_PASSWORD=<fixture-password> \
  npm run capture:ledgersmb:partners
LEDGERSMB_FIXTURE_PASSWORD=<fixture-password> \
  npm run capture:ledgersmb:catalog
LEDGERSMB_FIXTURE_PASSWORD=<fixture-password> \
  npm run capture:ledgersmb:lifecycle
```

They create the customer and vendor, create the warehouse and inventory item,
then exercise and approve the purchase, sale, and physical-count lifecycle.

To prove the complete dependency chain without intermediate snapshot restores,
start from fresh volumes and record all four phases in sequence:

```sh
LEDGERSMB_FIXTURE_PASSWORD=<fixture-password> \
  npm run capture:ledgersmb:end-to-end
```

The command stops at the first failed phase and leaves one run directory per
attempted phase under `runs/`.

### Dolibarr replays

The demo path above covers discovery. The reviewed Dolibarr artifacts replay
with:

```sh
npm run replay:dolibarr:third-party
npm run replay:dolibarr:create-party
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

When a TypeScript 7 release exposes a programmatic API supported by
`typescript-eslint`, reconsider this pin; any move remains a dependency decision.
