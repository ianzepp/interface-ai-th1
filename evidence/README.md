# Evidence

Submission evidence produced by real discovery and replay runs. Do not add
fabricated, hand-authored, or secret-bearing evidence.

```text
evidence/
├── capabilities/<id>.json    # reviewed artifacts, exported by npm run export:artifact
└── runs/<run-id>/
    ├── README.md             # short human account of the run
    ├── run.json              # manifest, outcome, producer attestation
    ├── events.jsonl          # observations, proposals, verdicts, actions, handoff
    ├── screenshots/
    └── result.json           # typed terminal result, Dolibarr replays only
```

The 16 promoted runs:

- **6 LLM discovery runs.** Five are the 2026-09-15 Dolibarr lookup corpus: two
  happy runs and three exception experiments. The sixth,
  `20260929120114404-0aa09c9c`, is the live escalation and same-session handoff.
- **9 deterministic replays**, covering all three reviewed artifacts.
- **1 failed replay**, `20260915202607595-f1eee304`, kept because it names the
  stage and the defect it exposed.

The [top-level README](../README.md#evidence-map) maps each run to what it
proves.

## Why no trace archives

Every run produced a Playwright `trace.zip`, and each manifest's `files` map
still names it. No trace is tracked. Traces capture network records, including
session cookies, and text redaction cannot reach inside a binary archive.

The 2026-09-16 audit found this the hard way. The earlier trace archives held a
credential-bearing request URL and local session cookies, and six LedgerSMB
capture runs also held the fixture password in their ledgers. All of it was
removed from the repository and its history.

Now `scripts/promote-run` still copies a run's trace, so a local reviewer can
open it, but `.gitignore` excludes `evidence/runs/*/trace.zip`.

## Promotion

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

Promotion copies a finalized run unchanged and never overwrites existing
evidence. It refuses:

- a run whose outcome is `sensitive-evidence-detected`;
- a run that records model or human decisions without a launcher-sealed,
  host-attested producer and a valid decision-receipt chain.

A deterministic replay records no decisions, so it may omit the producer.

Before promoting, review the ledger and screenshots. `npm run audit:secrets`
scans every file a commit would carry.

The 2026-09-15 runs were recorded before producer attestation existed, so
their manifests carry no producer. They are historical records and were not
rewritten.
