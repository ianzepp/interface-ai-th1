# Test Run 20260915202758596-ed9759b5

- Status: `satisfied`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:27:58.596Z`
- Finished: `2026-09-15T20:27:58.723Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Deterministic replay for expected result authentication-required.

## Outcome

The deterministic artifact returned the expected typed result: authentication-required.

Checkpoint: `authentication-required`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
