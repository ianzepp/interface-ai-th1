# Security and Sensitive-Data Audit

This file records a secret-and-personal-data audit of this repository and its
Git history, and the procedure used to produce it, so the audit can be rerun and
refreshed later.

Two rules govern this file:

1. **No secret values.** Findings cite locations, key names, lengths, and
   redacted prefixes only. Nothing here is allowed to be a usable credential.
2. **Every claim needs a command.** A finding or a clean result is recorded with
   the command that proves it, so a later run can reproduce or contradict it.

## Audit history

| Date       | Revision           | Scope                                                             | Result                                                             |
| ---------- | ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2026-09-17 | `c97cd83` (`main`) | Tracked tree, full history, object store, local ignored artifacts | Shipped surface clean; local-disk credentials found (see findings) |

Append a row when rerunning. Keep prior rows: the history of what was found and
when is part of the record.

## What this repository is, and why the audit is shaped this way

This is the `interface.ai` computer-use take-home: an LLM authors a browser
capability against a locally hosted open-source target (LedgerSMB 1.13.7 or
Dolibarr 23.0.4 in pinned Docker Compose projects), and a deterministic engine
replays the reviewed artifact without a model in the decision loop.

Three properties determine the audit's shape:

- **Two targets run as local Docker fixtures** with synthetic credentials
  (`interface-ai-local`, `interface-ai-root-local`, login `admin`). Those values
  are intentional, are documented as local-only, and are expected to appear in
  `targets/*/compose.yaml`.
- **The high-risk artifact class is not source code.** Playwright traces
  (`trace.zip`) capture network payloads, form values, cookies, and screenshots,
  so a trace can carry credentials that a text-level redaction pass cannot reach.
  The same is true of the compressed Docker volume snapshots under `snapshots/`.
- **The working machine holds far more than the repository.** `runs/`,
  `snapshots/`, `tmp/`, `dist/`, `.vivi/`, and `assignment.pdf` are all
  Git-ignored. They do not ship through `git clone`, but they do ship if the
  directory is zipped, synced, or copied.

The audit therefore splits into two questions that must be answered separately:
what is in Git (tracked tree, history, object store), and what is on local disk.

## How to rerun the audit

### Preconditions

```sh
git rev-parse --show-toplevel
git status --short --branch
git log --oneline | wc -l
```

Record the tip commit in the audit-history table. If the audit is being run on a
fresh clone rather than the authoring machine, the local-disk lanes will find
little or nothing, because `runs/`, `snapshots/`, `tmp/`, and `.vivi/` are
absent. Say so explicitly rather than reporting a clean local surface.

### Ground rules for every lane

- Read-only. No file in the repository or in `.git/` may be created, modified,
  or deleted; no `git gc`, `git prune`, `git repack`, `git reset`, `git stash`,
  `git checkout`, `git filter-repo`, or `git update-ref`. Scratch work goes in
  `mktemp -d` under `/tmp`.
- Stay inside the repository root. Never index `~`, `~/Library`, or other trees.
- Never print a full secret value. Report a redacted prefix plus length.
- Do not test whether a captured credential or cookie is still valid; that
  crosses from inspection into use.
- Label every finding **in Git** (would ship through a clone) or **local only**
  (Git-ignored). Prove the distinction with `git check-ignore -v <path>` and
  `git ls-files --error-unmatch <path>`.
- Known-benign values are not findings by themselves: `interface-ai-local`,
  `interface-ai-root-local`, `admin`, loopback `127.0.0.1`, and the Docker image
  digests in the Compose files. Flag them only where the location makes them
  meaningful, and say why.
- Keep each lane's own output volume bounded: count and sample, never dump
  archives or large files. One lane in the 2026-09-17 audit died from context
  bloat, which is why the local lane is now split in two.

### Lanes

Run these in parallel. Each lane is one subagent with the scope in the table;
the model slug column is the slug used on 2026-09-17 and is a starting point,
not a requirement.

| Lane                          | Model slug (2026-09-17) | Scope                                                                                                                                                                                          |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Tracked source and config  | `grok-4.6`              | Tracked files except `evidence/` and `node_modules/`: `src/`, `tests/`, `scripts/`, `schemas/`, `skills/`, `docs/`, `targets/`, root Markdown, `package.json`, `package-lock.json`, `.github/` |
| 2. Tracked evidence corpus    | `codex-gpt-5.6-terra`   | `evidence/**`: JSON, JSONL, Markdown, and every screenshot read as an image                                                                                                                    |
| 3. Full history content       | `grok-4.6`              | All commits: content, deleted paths, diffs, provider-key shapes, and whether the literal is still live at `HEAD`                                                                               |
| 4. Object-store forensics     | `codex-gpt-5.6-sol`     | Unreachable and dangling objects, reflogs, refs, pack contents, `.git/filter-repo/`, rewrite residue                                                                                           |
| 5. Local traces and snapshots | `codex-gpt-5.6-luna`    | `runs/*/trace.zip` and `snapshots/**/*.gz`, streamed rather than bulk-extracted                                                                                                                |
| 6. Local scratch, build, PDF  | `codex-gpt-5.6-sol`     | `tmp/`, `dist/`, `assignment.pdf`, `.env*`, `.vivi/`, `worktrees/`                                                                                                                             |
| 7. Personal information       | `zai-glm-5.3-flash`     | Commit identities, absolute paths, hostnames, contact identifiers, third-party data, and submission-facing exposure                                                                            |

Every lane must report: a one-line verdict; a findings table
(severity, what, exact location, redacted evidence, why it matters); what it
checked and found clean, with counts; what it could not check and why; and a
plain statement of any claim it did not personally verify.

### The scripted scan

`scripts/audit-secrets` is the mechanical pass, and it is the first thing to run.
It holds a curated pattern set and a curated file expectation next to the rules,
classifies every file as committable or local-only using Git, and exits non-zero
when a blocking finding sits on a file a clone would carry.

```sh
scripts/audit-secrets           # gate on committable files
scripts/audit-secrets --all     # also gate on ignored files, with full detail
scripts/audit-secrets --json    # machine-readable
```

It runs inside `npm test` as well, so a credential committed to a tracked file
fails the suite rather than waiting for someone to remember this document.

`npm run hooks:install` points the clone's `core.hooksPath` at `scripts/hooks`, so
the same scan runs as a pre-commit hook and refuses a commit whose staged content
carries a credential. The hook scans the index rather than the working tree,
because the index is what the commit would contain; a credential staged and then
removed from the working tree is invisible to a working-tree scan and caught by
this one. Installation is per clone, since Git does not share hooks through
history, and `git commit --no-verify` remains the deliberate escape hatch.

Two limits are deliberate and stated in its output: binary files are counted and
never read, so a clean result says nothing about trace archives, snapshots, or
screenshot pixels; and Git history is a separate pass. The lanes below remain the
way to cover those.

### Mechanical checks to reproduce

These are the commands behind the recorded results, kept as the manual record of
what the script checks. The lanes and the script between them cover the same
ground; the script is the one that runs every time.

Shipped surface:

```sh
# Fixture literals: expect only compose files plus one documentation mention.
git grep -c 'interface-ai-local' -- .
git grep -n '/Users/' -- .
git grep -nEi '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- .
git grep -nEi 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_|xox[baprs]-|sk-ant-|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}' -- .
git grep -n 'BEGIN [A-Z ]*PRIVATE KEY' -- .
```

History and object store:

```sh
git rev-list --all | wc -l
git log --all --name-only --pretty=format: | grep -c 'trace.zip'
git rev-list --objects --all | grep -cE '\.(zip|gz|sql)$'
git log --all --diff-filter=D --name-status --format='COMMIT %H %ad %s' --date=short
git log --format='%an <%ae>' | sort | uniq -c
git fsck --full --unreachable --no-reflogs

# Objects present but reachable from no ref.
git rev-list --all --objects | awk '{print $1}' | sort -u > /tmp/reachable.txt
git cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype) %(objectsize)' | sort > /tmp/all.txt
comm -23 <(awk '{print $1}' /tmp/all.txt) /tmp/reachable.txt

# No archive may survive in the object store.
export LC_ALL=C
git cat-file --batch-all-objects --batch | grep -a -c $'PK\003\004'

# Rewrite residue.
ls .git/filter-repo 2>/dev/null && cat .git/filter-repo/ref-map
```

Local disk:

```sh
find runs -name trace.zip | wc -l
for z in $(find runs -name trace.zip); do unzip -l "$z" >/dev/null 2>&1 || echo "malformed: $z"; done

# Credential typed into a form, and authorization headers, inside traces.
unzip -p runs/<run-id>/trace.zip trace.trace   | grep -a -c 'interface-ai-local'
unzip -p runs/<run-id>/trace.zip trace.network | grep -a -c -i 'authorization'
unzip -p runs/<run-id>/trace.zip trace.network | grep -a -o 'DOLSESSID_[0-9a-f]\{40\}'

# Cookie values captured in scratch transcripts.
grep -c -o 'DOLS[A-Za-z0-9_]*' tmp/rerun/*.log tmp/sweep/*.log

# Snapshot archive internals.
tar -tzf snapshots/dolibarr/demo-install-smoke/mariadb-data.tar.gz | grep -i healthcheck
tar -xOzf snapshots/dolibarr/demo-install-smoke/mariadb-data.tar.gz ./.my-healthcheck.cnf
grep -rlE '^[[:space:]]*(pwd|passwd|password)' .vivi/ 2>/dev/null | head
```

### Orchestrator duties

The audit is not finished when the lanes return. The orchestrating session must:

1. Independently reproduce every finding above `info` with its own command, and
   correct the lane's severity if the reproduction disagrees.
2. Re-check any claim that a lane marked unverified, or record it as unverified.
3. Reconcile lanes against each other. On 2026-09-17 the object-store lane missed
   `.git/filter-repo/` and a direct look was needed.
4. Confirm the mechanical counts (run directories, trace archives, malformed
   archives, screenshots) rather than quoting a lane's arithmetic.
5. Update the findings tables and append an audit-history row.

## Findings as of 2026-09-17 (`c97cd83`)

### In Git: this is what a reviewer receives

| Severity | Finding                                                        | Location                                                                                               | Status                 |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| Low      | Operator username and path into a private, unshared repository | `AGENTS.md:28` (`/Users/ianzepp/work/ianzepp/skills`)                                                  | Open                   |
| Low      | Fixture password literal recoverable from earlier history      | `src/authoring/ledgersmb-*-pilot.ts` and `src/runtime/ledgersmb-initialize-replay.ts` before `ab146a1` | Accepted (see note)    |
| Low      | Unreachable blob holds the fixture literal                     | `.git/objects/48/2d564e…`, blob `482d564e`, 30 bytes                                                   | Open                   |
| Info     | Unreachable blob of stale `run-recorder.ts` source             | blob `85e8b4ed`, 16.9 KB                                                                               | Open                   |
| Info     | Fixture passwords tracked by design                            | `targets/dolibarr/compose.yaml`, `targets/ledgersmb/compose.yaml`, named in `assignment-proof.md`      | Accepted by design     |
| Info     | Personal email on all 85 commits                               | commit metadata, author and committer                                                                  | Accepted (normal)      |
| Info     | Author line in the submission narrative                        | `REPORT.md:8`                                                                                          | Accepted (intentional) |
| Info     | Internal task identifier in a commit body                      | commit `185ceb2`, "task 2a21291f"                                                                      | Open (cosmetic)        |

Note on the recovered fixture literal: `ab146a1` replaced the hardcoded password
in the capture and replay pilots with an environment variable. The value remains
in history and is already published in `targets/*/compose.yaml`, so rewriting
history again would reduce no real exposure.

### Local only: Git-ignored, exposed only if the directory is copied

| Severity | Finding                                                                                              | Location                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| High     | Fixture password typed into password fields, `admin` login, CSRF tokens, Basic authorization headers | 26 LedgerSMB `runs/*/trace.zip` (`trace.trace`, `trace.network`)                                                 |
| High     | Session cookies in network records                                                                   | 50 Dolibarr traces; 26 LedgerSMB traces                                                                          |
| High     | Generated cleartext database password, not the fixture value                                         | `snapshots/dolibarr/demo-install-smoke/mariadb-data.tar.gz :: ./.my-healthcheck.cnf`                             |
| High     | Password hashes and demo user records inside a restorable database volume                            | same archive (`mysql/global_priv.MAD`, `dolidb/llx_user.ibd`); `documents.tar.gz :: ./backup-before-upgrade.sql` |
| Medium   | Four raw session cookie values in a plaintext transcript                                             | `tmp/sweep/high.log` (the log replays a scratch trace)                                                           |
| Medium   | Fixture passwords reproduced in transcripts                                                          | `tmp/sweep/low.log`, `tmp/rerun/r1.log`                                                                          |
| Medium   | Leftover trace scratch directory outside the repository                                              | `/private/tmp/interface-trace-finished.RCIagJ` (~9.4 MB)                                                         |
| Low      | Operator paths, hostname, and handle in ignored coordination state                                   | `tmp/**`, `.vivi/**`                                                                                             |
| Info     | Assignment contact address, no confidentiality marking                                               | `assignment.pdf` (Git-ignored)                                                                                   |
| Info     | Corpus integrity: unreadable trace archives                                                          | 4 of 87 archives under `runs/`                                                                                   |

Measured at audit time: 88 run directories, 87 trace archives, 140 screenshots,
365 MB under `runs/`, 89 MB under `snapshots/`, 14 MB under `tmp/`.

### Checked and found clean

Zero occurrences, across the tracked tree and the whole history, of: provider key
shapes (AWS, GitHub, Slack, Anthropic, OpenAI, xAI, Stripe), PEM private keys,
connection strings and credentialed URLs, real-looking passwords outside the
declared fixtures, and third-party email addresses. No trace archive or snapshot
archive survives in the Git object store (zero `PK\x03\x04` magic across all 901
objects). No `.env` or `.env.*` file exists anywhere in the repository. The
compiled `dist/` tree contains no credential literal that was later removed from
`src/`. The ten snapshot manifests carry no credential, host, or path fields.

### Personal information

One person is identifiable: the repository author, through the name and personal
email on all 85 commits (normal provenance), the deliberate `author:` line in
`REPORT.md`, and the home-directory path at `AGENTS.md:28`. All 85 commits use
the same identity, the same committer, and a single consistent timezone.

No third-party real personal data is tracked. The people and organizations in the
committed evidence (`Albert Einstein`, `Alice Adminson`, `Bob Bookkeeper`,
`Coraly Commercy`, `David Doe`, `Book Keeping Company`) come from Dolibarr's own
demo dataset, enabled by `DOLI_INIT_DEMO: "1"` in the pinned image, and the
screenshots show no credential values. One caveat: `Laurent Destailleur`, whose
name also appears, is the real founder of the Dolibarr project, published by the
vendor inside its own demo data. That maintainer's public package address also
appears in the ignored `tmp/sweep` transcripts; this file does not repeat it.

### Known contradiction in the submission narrative

`NOTES.md` states that the promoted runs were accepted after a scan found no
fixture password literal in any trace archive. `README.md` and
`evidence/README.md` state that the trace archives were removed because they held
a credential-bearing request URL and local session cookies. These cannot both be
current. The code, the object store, and the recovered trace evidence support the
second: the archives did contain credentials, which is why they were removed.

## Standing remediation

Until the submission is frozen, these remain open:

1. Any handoff that is not a plain `git clone` requires removing or quarantining
   `runs/`, `snapshots/*.gz`, `tmp/sweep/`, `tmp/rerun/`, and
   `/private/tmp/interface-trace-finished.RCIagJ`. That clears every high and
   medium local finding.
2. Genericize the path at `AGENTS.md:28`.
3. **Closed 2026-09-17, before the first push.** No server-side copy of the
   pre-rewrite history exists. The old `main` tip `583c77ed` is absent from every
   candidate repository on the account (`gh api repos/ianzepp/<repo>/commits/
583c77ed…` returns "No commit found" for each), an account-wide code search for
   the fixture literal returns nothing, and the published tree carries no trace
   archive, snapshot archive, or assignment PDF. The first push created
   `ianzepp/interface-ai-th1` at `04c4ae4`, from this repository's post-rewrite
   object graph only.
4. Reconcile the three documents named in the contradiction above.
5. Optionally clear the two unreachable blobs with
   `git reflog expire --expire=now --all && git gc --prune=now`, accepting that
   the literal they contain is already tracked in `targets/*/compose.yaml`.

Accepted by design and intentionally not remediated: the fixture credentials in
`targets/*/compose.yaml`, which are synthetic, loopback-only, and required by the
fixtures.

## Limitations

This audit does not cover: the contents of an external clone or backup; whether
credentials captured in local traces remain valid, since testing that would mean
using them; OCR of the 140 local screenshots (the 11 committed screenshots were
read as images); the full body of every `.vivi` mail blob (all 143 files were
machine-scanned and five were sampled); or compressed database values that fall
outside the scanned patterns, since no database was restored during the audit.

## Refresh triggers

Rerun the audit, or at least lanes 3 through 6, when: a capture or replay corpus
is added under `runs/`; a snapshot is created; history is rewritten; a remote is
added or a push is made; the repository is about to be submitted, handed over, or
archived; or the fixture credentials in `targets/*/compose.yaml` change.
