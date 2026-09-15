# Test Run 20260915202113470-97cf9873

- Status: `error`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:21:13.470Z`
- Finished: `2026-09-15T20:21:39.572Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Authenticated lookup for a name with multiple exact matches in the demo fixture.

## Outcome

Two records exactly matched the requested name, so choosing either would be unsafe.

Error code: `third-party-ambiguous`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
