# Test Run 20260929120114404-0aa09c9c

- Status: `satisfied`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Producer: `external-llm/codex` model `not reported` sealed nonce `fbb1a2f4-1ac4-4fa0-ba0a-b5e49d4c4f21`
- Decision receipts: `4` sealed, terminal digest `21a6c1067775f837a0596e980a45d9d7fb442535020f640425624526c19e367f`
- Started: `2026-09-29T12:01:14.404Z`
- Finished: `2026-09-29T12:02:33.394Z`

## Goal

> Look up the Dolibarr third party named exactly "aaa" and report its customer code, vendor code, currency, and status.

## Situation

Fixture dolibarr/demo-install-smoke reset and authenticated for authoring.

## Outcome

Validated resume returned control to automation at checkpoint extract-profile.

Checkpoint: `extract-profile`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
