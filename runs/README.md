# Local test runs

Each fresh-environment LLM attempt creates one child directory here. A completed
run has this shape:

```text
runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
├── trace.zip
└── screenshots/
```

Deterministic replays also write `result.json`, which carries the typed terminal
value. The run manifest's `files` map records the shape.

The child directories are ignored by Git because traces and observations can be
large or sensitive. After reviewing a completed run for sensitive data, promote
one or more runs with:

```sh
scripts/promote-run <run-id> [<run-id> ...]
```

Promotion copies them to `evidence/runs/<run-id>/` without changing the local
runs or overwriting existing evidence. It accepts only a finalized run holding
every required file, including `trace.zip`, and rejects a run whose outcome is
`sensitive-evidence-detected`.
