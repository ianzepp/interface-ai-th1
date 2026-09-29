# Local runs

Every discovery session and every replay creates one child directory here:

```text
runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
├── trace.zip
├── screenshots/
└── result.json        # deterministic replays that emit a typed result
```

The run manifest's `files` map records the shape.

The child directories are ignored by Git, because traces and observations can
be large or sensitive. Review a completed run for sensitive data, then promote
it:

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

Promotion copies the run to `evidence/runs/<run-id>/`. It never changes the
local run or overwrites existing evidence. It accepts only a finalized run that
holds every required file, including `trace.zip`. It rejects:

- a `sensitive-evidence-detected` outcome;
- a run that records decisions without an attested producer.

See [`evidence/README.md`](../evidence/README.md).
