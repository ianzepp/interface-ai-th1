# Test Run 20260915201727769-f02bcb33

- Status: `satisfied`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:17:27.769Z`
- Finished: `2026-09-15T20:18:10.284Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Authenticated administrator starts from the demo fixture home page.

## Outcome

Found one exact-name third party and opened its account profile.

Checkpoint: `third-party-profile-visible`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
