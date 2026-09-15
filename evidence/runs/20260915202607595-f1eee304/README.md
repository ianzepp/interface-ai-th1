# Test Run 20260915202607595-f1eee304

- Status: `error`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:26:07.595Z`
- Finished: `2026-09-15T20:26:08.099Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Deterministic replay for expected result success.

## Outcome

Expected success, received stage-execution-failed: {"type":"failure","code":"stage-execution-failed","detail":{"stageId":"open-result","expected":"Open the sole exact-name result and return its account profile.","observed":"Missing target [{\"kind\":\"text\",\"text\":\"{{input.name}}\",\"exact\":true}]","evidence":[{"kind":"screenshot","path":"screenshots/1789503968016-failure-open-result.png","redacted":false}]}}

Error code: `deterministic-replay-failed`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
