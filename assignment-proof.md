# Assignment Proof Matrix

This maps each requirement in the assignment brief to the code and committed
evidence that satisfy it. The brief itself (`assignment.md`, `assignment.pdf`)
is kept local and is not in the repository. [`REPORT.md`](REPORT.md) is the
design write-up; this file is the checklist behind it. Last verified
2026-09-29 against `npm run verify` (159 tests) and `evidence/`.

Status meanings: **Satisfied** — implemented and proven by tests or committed
evidence. **Partial** — part of the requirement is unproven. **Design-only** —
the brief asks for design, not implementation.

## Core requirements

| Requirement                    | Status                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Known gaps                                                                                                                                                                            |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3.1 Goal-driven agent loop** | **Satisfied**                           | `scripts/author --single-run` takes goal, target, and fixture; Codex drives `scripts/session` (observe → decide → act) until it finishes, escalates, or errors. Attested run [`20260929120114404-0aa09c9c`](evidence/runs/20260929120114404-0aa09c9c/); 2026-09-15 corpus of five Dolibarr discovery runs.                                                                                                                                            | Run and action caps are stated in the prompt, not enforced by the harness. Codex does not report its resolved model, so the attestation records `model: null`.                        |
| **3.2 Structured artifact**    | **Satisfied**                           | [`src/runtime/state-machine.ts`](src/runtime/state-machine.ts), [`schemas/capability.schema.json`](schemas/capability.schema.json), three reviewed artifacts under [`src/capabilities/`](src/capabilities/), exported to [`evidence/capabilities/`](evidence/capabilities/). Contract (typed inputs/outputs, success condition), stages, targets with `exactly-one`, detectors, transitions, fail-closed `otherwise`, policy, provenance.             | —                                                                                                                                                                                     |
| **3.3 Deterministic replay**   | **Satisfied** (recovery: contract only) | [`src/runtime/engine.ts`](src/runtime/engine.ts). Lookup replays: success twice with byte-identical outputs and again 14 days later; `third-party-not-found`; `third-party-ambiguous`; `authentication-required`; one real `failure` naming its stage. Create-customer and LedgerSMB replays promoted. Typed results validated against [`schemas/result.schema.json`](schemas/result.schema.json).                                                    | A recovery transition (declared, capped, reported in `recoveries`, `recovery-exhausted`) is implemented and tested, but no committed artifact declares one.                           |
| **3.4 Safety guardrails**      | **Satisfied**                           | [`src/runtime/policy.ts`](src/runtime/policy.ts): origin and action allowlists in session and engine; engine refuses a policy that differs from the artifact's; irreversible actions blocked or paused. [`src/authoring/redaction.ts`](src/authoring/redaction.ts), trace suspension and scanning, [`scripts/audit-secrets`](scripts/audit-secrets) in `npm test` and a pre-commit hook. [`SECURITY.md`](SECURITY.md).                                | Undeclared sensitive values in free text and screenshot pixels are not caught. During discovery the model declares an action's risk.                                                  |
| **3.5 Evidence**               | **Satisfied**                           | [`src/authoring/run-recorder.ts`](src/authoring/run-recorder.ts): manifest, redacted event ledger (observations, proposals with rationale, policy verdicts, actions, interventions, control transfers, resume decisions), screenshots, typed results. 16 promoted runs, including success, business outcomes, intervention, and failure.                                                                                                              | Traces are kept local, not committed (they carry session cookies).                                                                                                                    |
| **3.6 Escalation & handoff**   | **Satisfied**                           | [`src/intervention/`](src/intervention/): `InterventionRequest`, `ControlLease` (epoch compare-and-swap), `evaluateResume`. `scripts/session escalate`, `take-control`, `human-observe`, `human-act`, `resume`; [`scripts/mock-operator`](scripts/mock-operator). Run `20260929120114404-0aa09c9c`: model escalation → request with screenshot → lease to human → human action in the same browser → detector-validated resume → automation finishes. | Resume accepts any stage of the bound artifact whose detector matches, not only the stage the request needed. Replay runners return `intervention-required` but have no live handoff. |
| **3.7 Heterogeneity & scale**  | **Design-only**                         | [`src/surfaces/surface-driver.ts`](src/surfaces/surface-driver.ts) (six-operation seam), [`src/targets/`](src/targets/) target profiles; REPORT section 4.                                                                                                                                                                                                                                                                                            | One driver; the `relative` candidate kind throws; no tenant overlays or version-range matching.                                                                                       |

## End-to-end vertical slice

**Satisfied.** A goal went to a real LLM-driven run (`…0aa09c9c`, and the
2026-09-15 corpus for the same capability). That corpus was reviewed into the
lookup artifact. The artifact replays deterministically, with typed outputs,
two business outcomes, an intervention, and a real failure. A human took over
the live session and handed it back. Evidence for every step is committed.

## Deliverables

| Deliverable                  | Status        | Proof                                                                                                                                                                      |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **6.1 Source and README**    | **Satisfied** | [`README.md`](README.md): setup (keys and config), running without live services, and the exact demo path from goal to replay.                                             |
| **6.2 Seven-section report** | **Satisfied** | [`REPORT.md`](REPORT.md), with the seven required headings in order.                                                                                                       |
| **6.3 Evidence**             | **Satisfied** | [`evidence/`](evidence/): exported artifacts; logs from discovery and replay runs; replays that return `not-found`, `ambiguous`, `authentication-required`, and a failure. |
| **11 Submission**            | **Operator**  | Push `main` to the public repository, then email the URL to `assignments@interface.ai` from the address used to apply, with the URL on its own line.                       |

## Reproducing the checks

```sh
npm run verify                                           # typecheck, lint, format, 159 tests
npm run audit:secrets                                    # credential scan over committable files
find evidence/runs -name trace.zip | xargs git ls-files  # prints nothing: no trace is tracked
jq -r '"\(.runId) \(.startedAt) \(.finishedAt)"' evidence/runs/*/run.json
```
