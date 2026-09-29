# Test Run 20260929120812777-6d5315d1

- Status: `satisfied`
- Target: `ledgersmb` `1.13.7`
- Fixture: `ledgersmb/fresh`
- Started: `2026-09-29T12:08:12.777Z`
- Finished: `2026-09-29T12:08:18.697Z`

## Goal

> Create a LedgerSMB company and its first administrator, then prove the account can authenticate.

## Situation

Deterministic replay against fresh LedgerSMB Docker volumes.

## Outcome

The deterministic artifact initialized LedgerSMB and reached the authenticated home screen.

Checkpoint: `authenticated-ledgersmb-home`

## Files

- `run.json` — structured run metadata and outcome
- `events.jsonl` — sanitized observations, decisions, and executed actions
- `trace.zip` — Playwright trace when capture completed
- `screenshots/` — meaningful checkpoint or terminal screenshots when captured
