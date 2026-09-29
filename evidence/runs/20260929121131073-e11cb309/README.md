# Test Run 20260929121131073-e11cb309

- Status: `satisfied`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-29T12:11:31.073Z`
- Finished: `2026-09-29T12:11:31.617Z`

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
