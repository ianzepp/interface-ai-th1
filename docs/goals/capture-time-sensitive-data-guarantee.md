# Goal: capture-time sensitive-data guarantee

## Goal

Every run directory the recorder finalizes is safe to commit, by construction
rather than by selection: a secret that reached the browser cannot reach a
persisted run artifact, and a run that cannot guarantee that finalizes as
`sensitive-evidence-detected` instead of leaving a directory that looks usable.

## Why this goal exists

The assignment requires it at the core, not at the boundary: "Never persist
secrets or raw sensitive data (credentials, tokens, full PII) into artifacts or
logs. Redact appropriately." (`assignment.md:101`), and "Keep secrets out of the
repo." (`assignment.md:241`).

The repository owns two gates, and only one of them answers that requirement:

- **Capture** writes the run.
- **Promotion** (`src/authoring/evidence-promotion.ts`) copies a run into
  `evidence/` **unchanged**.

Because promotion is a copy, a run that exists on disk in an unsafe state is not
merely unpromotable — it is wasted work. The evidence set is a hand-selected
list of runs that prove the functionality works, so the selected runs must be
safe, which means the runs they are selected from must be safe. Safety that
holds only because someone chose the clean files is luck, not a property, and
the local corpus shows the same file types in both states: the tracked
`evidence/` corpus scans clean while 26 local event ledgers carry the fixture
password, 50 local traces carry session cookies, and one local README carries a
csrf token. The tracked corpus is clean because of the 2026-09-16 rewrite and
the promotion choices, not because anything prevented the defect.

Solving it once at the recording boundary also simplifies everything downstream:
the `runs/` ignore rules become an editorial choice about blob noise rather than
a secrecy control, promotion becomes a curation decision rather than a security
gate, and the evidence set can keep traces again (the gap recorded in
`tmp/vivi/need-09-trace-gap.md`).

## Relationship to settled decisions

This goal **extends** the recorded decisions in
`docs/delivery/vertical-slice-completion.md` rather than reversing them:

- Decision 3 (declared sensitive values, launcher-supplied) stands. It
  correctly rejected declaring sensitivity on the target profile, because
  invocation values can be sensitive without being properties of a reusable
  profile. This goal does not reintroduce that.
- Decision 4 (trace exclusion during sensitive actions plus terminal
  scan-and-reject) stands and is implemented. This goal closes the gaps that
  remain around it.

## What already holds

Verified on 2026-09-17 at `c97cd83`:

- **Trace suspension.** An action carrying a declared sensitive value runs with
  the trace stopped, so the credential is never captured
  (`src/authoring/playwright-run-capture.ts:79-114`).
- **Terminal trace scan.** At finish, the decompressed trace is scanned for
  declared values; a match finalizes the run as `error` with
  `sensitive-evidence-detected` and discards the trace (`:125-151`, `:179-195`).
- **Promotion refusal.** A run with that terminal code cannot be promoted
  (`src/authoring/evidence-promotion.ts:106-113`).
- **Write-time redaction.** The manifest and the rendered README are passed
  through `redactKnownSecrets` before persistence
  (`src/authoring/run-recorder.ts:446-462`).
- **Fail-loud fixture values.** The discovery session derives declared values
  from the target and throws when the environment variable is missing
  (`src/authoring/discovery-session-cli.ts:118`, `:262-271`).

## What is missing

### H1 — the protection has no independent net

Every protection is a function of a caller-supplied list, and an empty list is
indistinguishable from "no secrets present": `evidenceContainsSensitiveValue`
returns `false` when the list is empty
(`src/authoring/playwright-run-capture.ts:183`), and the parameter defaults to
`[]` (`:59`). The known call sites pass values (`[PASSWORD]` in the four
LedgerSMB pilots; `fixtureSensitiveValues(target)` in the session CLI), so this
is not a live defect — it is an absent obligation. A new pilot, a new target, or
a new session launcher can ship with no declaration and no warning.

### H2 — matching is key-name and exact-value only

`SENSITIVE_KEY` (`src/authoring/redaction.ts:19`) matches field **names**, and
exact-value matching only covers values the launcher declared. A secret embedded
in free text passes through untouched, which is how a csrf token reaches a
persisted artifact through a browser error message:

```sh
grep -l 'csrf_token=' runs/*/README.md runs/*/run.json | wc -l   # 1 and 1
grep -l 'csrf_token=' runs/*/events.jsonl | wc -l                # 7
grep -l 'interface-ai-local' runs/*/events.jsonl | wc -l         # 26
```

The manifest's `outcome` field is a rendered error string, so it carries
whatever the browser reported, including a request URL. This is a requirement
violation under `assignment.md:101`, which names tokens explicitly.

### H3 — pixels are out of scope and screenshots are unmasked

`src/authoring/playwright-run-capture.ts:176` states plainly that screenshot
pixels are not scanned, because byte matching cannot recover a rendered value.
Checkpoint screenshots are written with `page.screenshot({ path, fullPage: true })`
(`src/surfaces/playwright-driver.ts:185`) and no `mask`. Trace suspension
protects the trace; it does nothing for a screenshot taken while a populated
credential field is on screen. The 11 tracked screenshots were reviewed as
images and show no credential values, so this is an unguarded path rather than a
known leak.

### H4 — the assertion covers one artifact, not the run

`evidenceContainsSensitiveValue` is called only on the candidate trace. The
ledger, manifest, and README are redacted but never verified, so nothing asserts
that the directory a run leaves behind is clean.

### H5 — the reviewed contract cannot declare an input as secret

`contract.inputs` is a name-to-type map with no sensitivity marker
(`schemas/capability.schema.json:77-84`), and
`src/capabilities/ledgersmb-initialize.ts:62,65` declares `databasePassword`
and `password` as bare `"string"`. The authority for "this input is a secret" is
therefore a hand-wired constant in the runner
(`src/runtime/ledgersmb-initialize-replay.ts:37`), not the reviewed artifact.

### H6 — the historical corpus is already dirty

A forward-only fix cannot clean what is already written. The pre-`ab146a1` runs
predate value-level redaction, and 28 of them carry the fixture literal or a
csrf token in their text artifacts. This needs a one-time disposition; it is not
part of the forward guarantee.

## Settled decisions

1. **Fail closed on observed credential interaction — chosen.** A capture that
   performs a value-setting action against a control the browser identifies as
   credential-bearing (`input[type=password]`, or an action whose target the
   recorder can classify as a credential field) must be covered by a declared
   sensitive value; if it is not, the recorder declares the value itself from
   the action it is about to execute, and the run fails closed if the value
   cannot be established. Rejected: relying on the launcher's declaration alone,
   because the empty case fails open silently (H1). Rejected: declaring
   sensitivity on the target profile, already rejected by the recorded decision
   in `vertical-slice-completion.md` and insufficient for invocation values.
   The observed action is better evidence than either, because typing into a
   password control is an observable fact rather than a maintained list.
2. **Shape-based scrubbing of every persisted string — chosen.** In addition to
   key-name and exact-value rules, scrub strings for credential shapes:
   sensitive key names appearing anywhere inside a value, query parameters whose
   names match `/token|key|secret|password|csrf|session/i`, `authorization` and
   `set-cookie` forms, and session-cookie patterns. Applied to every string the
   recorder persists, including the rendered `outcome` and any recorded URL.
   Rejected: declaration-only matching, which is what H2 exploits. Rejected:
   dropping `outcome` text from the README entirely, which loses the failure
   context that makes a failed run useful evidence.
3. **A run-wide finalize assertion — chosen.** At finalize, scan every artifact
   the run wrote — ledger, manifest, rendered README, result, and the
   decompressed trace — for declared values and credential shapes, and finalize
   as `sensitive-evidence-detected` if any hit is found. Rejected: the current
   trace-only scan, which leaves the text artifacts unverified (H4).
4. **Credential controls are masked in screenshots — chosen.** Pass `mask` for
   credential-bearing controls on every checkpoint screenshot, and never capture
   a screenshot while a credential value is on screen. Rejected: OCR-based
   screenshot scanning, which is brittle and detects the value only after
   persisting it (H3).
5. **Recorded inputs may declare sensitivity — chosen.** Add an optional
   sensitivity marker to `contract.inputs` so a reviewed artifact can state that
   `password` is a secret, and have the replay launcher bind declared sensitive
   values from the artifact instead of a hand-wired constant. The schema change
   is additive: existing artifacts stay valid and keep working with the current
   constant. Rejected: leaving the authority in the runner, which is H5 and
   makes a security property escape review.
6. **Historical corpus disposition — chosen: exclude, do not silently edit.**
   The pre-`ab146a1` runs leave the committable surface. If a specific one is
   needed as evidence, it is recaptured under the new boundary, or scrubbed by a
   script that records the scrub in that run's README. Rejected: editing an
   evidence ledger in place, because a record that has been silently rewritten
   lies about its own provenance.
7. **Scope boundary — chosen: the recorder, not the machine.** This goal covers
   artifacts the recorder writes. It does not cover `snapshots/` (written by
   `scripts/target snapshot`, and holding a generated database password and
   password hashes), the authoring transcripts under `tmp/` (the launcher's
   boundary), the target application's own state, or anything already written.
   Those are named follow-ups, not silent gaps.

## Definition of done

1. A capture that types into a credential-bearing control without a declared
   value either declares the value itself or finalizes as
   `sensitive-evidence-detected`; it cannot finalize as clean.
2. No string persisted by the recorder contains a credential-shaped query
   parameter or header form. Proof: the H2 commands above return `0` for a run
   produced after this goal, on a fixture that produces a csrf-bearing URL.
3. Finalize scans every written artifact, not only the trace. Proof: a test that
   plants a declared sentinel and a credential-shaped string into the ledger and
   rendered README paths and asserts the run finalizes `sensitive-evidence-detected`
   with neither value present in the directory.
4. Every checkpoint screenshot taken while a credential control is present masks
   that control. Proof: a test asserting the screenshot call passes a non-empty
   `mask`, plus a manual check of one captured image.
5. A reviewed artifact can mark an input sensitive, the replay launcher binds
   declared sensitive values from the artifact, and `npm run check` plus
   `tests/schemas.test.ts` confirm existing artifacts and invocations stay valid.
6. The committable run surface scans clean: every run directory that Git would
   commit contains no declared sensitive value and no credential shape.
7. `SECURITY.md` is refreshed with the resulting state, and the standing items it
   records are updated to reflect what this goal closed.

## Non-goals

- Changing the promotion gate beyond what decision 3 implies. Promotion stays a
  curation decision; this goal removes the security reason to gate it.
- Committing traces to `evidence/`. That is `need-09-trace-gap.md`'s question
  and it becomes answerable — not answered — once capture is safe.
- Changing `.gitignore`. That is a downstream editorial decision that gets
  simpler once this goal lands.
- Remediating `snapshots/` or `tmp/`. Named follow-ups under decision 7.

## Candidate delivery units

For the planner to formalize, sequence, and size; write scopes are the files
each unit is expected to own.

| Unit | One change                                                                                      | Write scope                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| U1   | Credential-shape scrubbing rules, applied to every persisted string                             | `src/authoring/redaction.ts`, `tests/redaction.test.ts`                                                 |
| U2   | Fail-closed coverage for observed credential interaction, with self-declaration from the action | `src/authoring/playwright-run-capture.ts`, `tests/playwright-run-capture.test.ts`                       |
| U3   | Run-wide finalize assertion over every artifact the run wrote                                   | `src/authoring/playwright-run-capture.ts`, `src/authoring/run-recorder.ts`, their tests                 |
| U4   | Screenshot masking for credential controls                                                      | `src/surfaces/playwright-driver.ts`, the pilot screenshot call sites, their tests                       |
| U5   | Optional sensitivity marker on `contract.inputs`, bound by the replay launcher                  | `schemas/capability.schema.json`, `src/runtime/ledgersmb-initialize-replay.ts`, `tests/schemas.test.ts` |
| U6   | Historical-run disposition and the committable-surface scan                                     | the run corpus and its ignore rules, plus one hygiene test                                              |

U1 and U5 are independent and may run concurrently. U2 and U3 both write the
capture module and must serialize. U6 depends on U1 and U3 to know what "clean"
means.

## Verification commands

```sh
# H1 — the protection's independent net
grep -n 'sensitiveInputValues.length === 0' src/authoring/playwright-run-capture.ts

# H2 — free text currently passes through
grep -l 'csrf_token=' runs/*/README.md runs/*/run.json | wc -l
grep -l 'csrf_token=' runs/*/events.jsonl | wc -l
grep -l 'interface-ai-local' runs/*/events.jsonl | wc -l

# H3 — screenshots are unmasked
grep -n 'screenshot(' src/surfaces/playwright-driver.ts

# H4 — the assertion covers the trace only
grep -n 'evidenceContainsSensitiveValue' src/authoring/playwright-run-capture.ts

# H5 — inputs carry a type, not a sensitivity
# (prints databasePassword and password as bare "string" values)
jq -r '.contract.inputs' evidence/capabilities/ledgersmb.initialize-company.json

# Repository gate
npm run verify

# The scan that proves done-condition 6, and that fails when a credential reaches
# a committable file. See SECURITY.md for its coverage limits.
scripts/audit-secrets
scripts/audit-secrets --all
```
