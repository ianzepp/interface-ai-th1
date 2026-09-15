# Test Run 20260915202031432-6995a2e8

- Status: `error`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:20:31.432Z`
- Finished: `2026-09-15T20:20:58.420Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Authenticated lookup for a third-party name absent from the demo fixture.

## Outcome

Dolibarr reported that no third party matched the requested name.

Error code: `third-party-not-found`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
