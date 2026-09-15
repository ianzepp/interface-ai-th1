# Test Run 20260915202742493-769ba7f6

- Status: `satisfied`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:27:42.493Z`
- Finished: `2026-09-15T20:27:43.014Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Deterministic replay for expected result third-party-ambiguous.

## Outcome

The deterministic artifact returned the expected typed result: third-party-ambiguous.

Checkpoint: `third-party-ambiguous`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
