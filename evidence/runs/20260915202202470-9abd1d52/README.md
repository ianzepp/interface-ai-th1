# Test Run 20260915202202470-9abd1d52

- Status: `error`
- Target: `dolibarr` `23.0.4`
- Fixture: `dolibarr/demo-install-smoke`
- Started: `2026-09-15T20:22:02.470Z`
- Finished: `2026-09-15T20:22:28.096Z`

## Goal

> Look up a Dolibarr third party by exact name and return its account profile.

## Situation

Unauthenticated browser attempts to start a protected third-party lookup.

## Outcome

The protected lookup redirected to the login page before any capability action could run.

Error code: `authentication-required`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
