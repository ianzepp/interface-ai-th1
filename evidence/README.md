# Evidence

This directory contains submission evidence produced by genuine discovery and,
later, replay runs. Do not add fabricated, hand-authored, or secret-bearing
evidence.

Finalized discovery and replay runs are promoted into:

```text
evidence/runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
├── screenshots/
└── result.json        # deterministic replays when emitted
```

The repository currently retains 11 promoted Dolibarr runs. Every promoted run
retains its README, manifest, event ledger, and screenshots; the five
deterministic replay runs also retain `result.json`. The `files` map in each
manifest still records `trace.zip` because that run produced a trace. The
manifests are historical run records and were not rewritten.

Every trace archive was removed from the repository and its Git history in the
2026-09-16 history rewrite. The archives held a credential-bearing request URL
and local session cookies, and text redaction cannot reach inside a binary
archive. The six LedgerSMB capture runs that carried this material were removed
with them; that removal is permanent in history. The surviving evidence for
each run is therefore the manifest, ledger, README, screenshots, and typed
result where present. No trace archive is surviving evidence in this commit.

Both successful and failed runs may be promoted. From the repository root:

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

The command accepts only finalized runs and never overwrites an existing evidence
copy. Review the local trace and logs for sensitive data before promotion; the
tracked trace archives described above have been removed.

Export every reviewed capability artifact into byte-stable JSON with:

```sh
npm run export:artifact
```

The command discovers all committed artifacts under `src/capabilities/` and writes
one document per artifact to `evidence/capabilities/<id>.json`.
