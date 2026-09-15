# Local test runs

Each fresh-environment LLM attempt creates one child directory here. A completed
run has this shape:

```text
runs/<run-id>/
├── README.md
├── run.json
├── events.jsonl
└── trace.zip
```

The child directories are ignored by Git because traces and observations can be
large or sensitive. After review and redaction, representative runs may be copied
into `evidence/` for the final submission.
