# Test Run 20260915201943054-c67afa9b

- Status: `satisfied`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:19:43.054Z`
- Finished: `2026-09-15T20:20:14.413Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Authenticated administrator starts from the demo fixture home page.

## Outcome

Repeated the unique exact-name lookup and opened the same account profile.

Checkpoint: `third-party-profile-visible`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
