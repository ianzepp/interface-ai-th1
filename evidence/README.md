# Evidence

This directory contains submission evidence produced by genuine discovery and,
later, replay runs. Do not add fabricated, hand-authored, or secret-bearing
evidence.

Reviewed discovery runs are promoted without alteration into:

```text
evidence/runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
├── trace.zip
├── screenshots/
└── result.json        # deterministic replays when emitted
```

Both successful and failed runs may be promoted. From the repository root:

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

The command accepts only finalized runs and never overwrites an existing evidence
copy. Review the trace and logs for sensitive data before promotion.

The assignment also requires a saved example capability artifact in this
directory. That export has not been added yet; the current reviewed artifacts
live under `src/capabilities/`. Track this and other submission gaps in
[`../assignment-proof.md`](../assignment-proof.md).
