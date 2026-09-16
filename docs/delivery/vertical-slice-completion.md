# Vertical-slice completion: provenance, redaction, and human handoff

## Scope and ordering

This delivery completes one vertical slice: a real, provenance-bearing LLM discovery capture, a deterministic replay that can pause for a person on the **same** browser session, and evidence that is safe to promote. The shared hot module is `src/authoring/interactive-playwright-session.ts`; units which edit it serialize. The implementation does not add a second embedded model loop: the external model host remains the decision maker, while this repository owns the authenticated recording boundary, policy, browser context, trace, and ledger.

Run units in this order: `VS-01` → (`VS-02` and `VS-04` in parallel) → `VS-03` → `VS-05` → `VS-06` → `VS-07` → `VS-08` → `VS-09`. `VS-04` must follow `VS-01`: both own `src/authoring/run-recorder.ts` and `tests/run-recorder.test.ts`. `VS-03` follows both `VS-02` and `VS-04`, because it also owns those recorder seams. `VS-10` follows all implementation and replay work. `VS-11` is last. Do not put concurrent writers on `src/authoring/interactive-playwright-session.ts`, `src/authoring/run-recorder.ts`, or `tests/run-recorder.test.ts`.

A Hand can start immediately on `VS-01`. Once `VS-01` is complete, Hands may start `VS-02` and `VS-04` concurrently because their write scopes are disjoint.

## Settled design decisions

1. **Provenance recording — choose harness-attested producer and decision receipts.** Add a structured producer record to `TestRunManifest` with immutable session identity, producer kind (`external-llm` or `human`), provider, model, model-session/request identity, and a harness-generated session nonce. Add a decision-receipt field to `proposal` and an explicit rejected-decision event to `DiscoveryEvent`; each receipt identifies the producer, binds the prior observation event hash/sequence, the proposed command hash, and the harness-generated nonce. The launcher (`src/authoring/codex-run.ts` / `src/authoring/author-cli.ts`) invokes the external host with its JSON event stream, captures the host-authored session identity and resolved model, and seals a producer record containing the harness nonce, captured-stream digest, and child exit status into the lane directory. `discovery-session-cli.ts` reads only that sealed record from the harness-designated path at session creation and passes it into `SessionOptions`; it rejects producer, model, receipt, nonce, or sequence fields arriving over CLI, JSONL stdin, or the socket. The recorder computes the append-only decision-receipt chain and writes its terminal digest to the manifest. A review tool validates the chain, that every action has an earlier model decision bound to the observed state, and that the discovery run has a non-human host-authored producer record before promotion. This is checkable evidence of a specific model-host session, not a controller-authored assertion. Reject a free-text `model` field sent by the controller because it is forgeable and cannot bind a particular decision to the observation that preceded it.

2. **Observe before act — choose per-controller observation epochs.** A session begins with its already emitted initial observation as epoch zero. Every successful `observe` increments the external controller's observation epoch and records the observation event identity. An `act` is accepted only when its command carries the latest issued observation identity and it has not already been consumed by another action; the same parser and `handle` path enforce this for stdio and socket transports. A stale, missing, or consumed identity is refused before policy evaluation, appended as a `decision-rejected` event with code `observe-required`, and returned as a typed `action-rejected` record. Do not merely document the protocol or use a boolean set by `observe`: either leaves socket callers and repeated actions able to act on an unbound/stale screen.

3. **Value-level redaction — choose declared sensitive values.** Add `sensitiveInputValues` to the repository-owned session start options, populated by the target/session launcher from known fixture credentials and any explicitly declared sensitive invocation inputs. `FileTestRunRecorder` redacts exact declared values recursively in manifests, README rendering inputs, event actions (including generic `fill.value`), action results, observations, summaries, and diagnostics before persistence, in addition to the current key-name rule. The redactor must preserve structure and replace only the value with `[REDACTED]`; it must not infer sensitivity from an arbitrary field name alone. The target-profile declaration alternative is rejected because fixture/bootstrap and invocation values can be sensitive without being properties of a reusable profile; a sentinel-only scheme is rejected because it cannot protect a literal that reaches a generic fill action.

4. **Trace handling — choose trace exclusion during sensitive actions plus terminal scan-and-reject.** `PlaywrightTestRunCapture` receives the same declared sensitive values. Before a sensitive action is executed, it stops the active trace into a non-promotable temporary path; it restarts a clean trace only after the action, and removes the temporary trace. At finish it scans every candidate trace archive and recorded screenshot/DOM payload for exact sensitive values before moving the clean trace into the run directory. Any match finalizes the run as `error` with code `sensitive-evidence-detected`, records only redacted diagnostics, deletes/quarantines the candidate trace rather than placing it in a promotable run, and makes `promoteTestRuns` refuse it. Scanning alone is rejected because it first persists a secret in the ordinary run directory; keeping traces outside `evidence/` is rejected because the run itself is reviewable evidence and an unchecked later copy can reintroduce the secret.

5. **Six contaminated runs — choose removal and clean recapture.** Remove the six tracked evidence directories `evidence/runs/20260915173426044-cf172ab3`, `evidence/runs/20260915174331177-9a4ac259`, `evidence/runs/20260915174522338-d689ee84`, `evidence/runs/20260915174527865-4ee2f9eb`, `evidence/runs/20260915174532327-fbb724a9`, and `evidence/runs/20260915174535371-b7e6f918`: each has unredacted fill values and a trace containing sensitive-token matches, so retaining them is unsafe even with a disclaimer. Recapture only the evidence that remains necessary after the capture boundary lands, from the documented reset fixtures; retain the old run IDs only in the removal commit message, not in durable evidence. Retain-with-decision is rejected because the secret-bearing trace remains tracked. The four LedgerSMB pilots must be brought under `ArtifactPolicy` and the common capture/redaction boundary, rather than documented as out-of-policy harness scripts, because they execute browser actions that become evidence and the claimed vertical slice cannot have a policy bypass.

6. **Control transfer — choose `ControlLease` as the real session mechanism.** Construct one lease per `SessionRun`, initially held by `automation`; persist its controller and epoch in `SessionState`, record every transfer as a dedicated `control-transfer` ledger event, and bind requests to the current epoch. Automation commands require automation ownership; operator commands require human ownership. On intervention, automation first captures evidence, creates and records `InterventionRequest`, then compare-and-swap transfers the lease to human before returning `intervention-required`. A stale epoch or wrong owner is refused and recorded. Do not replace `ControlLease` with a pause boolean: it cannot distinguish a stale automation loop from the current human holder or provide an auditable takeover boundary.

7. **Operator seam — choose the existing Unix-socket session CLI.** Extend `scripts/session` / `src/authoring/session-cli.ts` with explicit `take-control`, `human-observe`, `human-act`, `resume`, and `release-control` commands. They use `requestSessionControl` and the live `SessionState.socketPath`, so a person reaches the exact running `BrowserContext`, not a new browser or fresh login. The command-line surface is the allowed minimal/mock operator UI under assignment section 3.6. Reject a separate operator browser window because it would not meet same-live-session control transfer.

8. **Resume — choose deterministic detector validation by automation.** While the human owns the lease, the person may make recorded manual actions and request a resume. The session captures a fresh observation and evaluates it against the artifact's explicitly admitted resume checkpoints/detectors; automation, not the person, decides `resume`, `complete`, or `reject`. Only a successful validation transfers the exact current lease epoch from human to automation and records both the validation and transfer; `complete` finalizes with the approved terminal outcome. A failed check records `resume-rejected`, retains human control, and returns the reason and evidence without guessing another stage. The current unconditional rejection in `src/intervention/resume.ts` is rejected because it leaves the declared handoff path nonfunctional.

9. **Result and schema impact — keep published artifact/invocation/result schemas stable for this thin authoring handoff.** The existing result schema already represents `intervention-required`, and the handoff request/lease/ledger are run evidence rather than capability or invocation data. Therefore do not change `schemas/capability.schema.json`, `schemas/invocation.schema.json`, or `schemas/result.schema.json` in this slice. Preserve all three committed artifacts as schema-valid and add/adjust assertions in `tests/schemas.test.ts` only if its result examples need to assert the unchanged intervention result. Change the TypeScript event and run-manifest contracts plus their focused recorder/session/control/capture tests. Reject adding provenance and handoff fields to the capability schema because an artifact is reviewed reusable behavior, whereas producer identity and a live lease belong to one run.

## Delivery units

### VS-01 — Attest producer identity and bind every discovery decision to evidence

- **one change:** Make every interactive discovery run carry harness-created model provenance and an append-only observation-to-decision receipt chain.
- **write_scope:** `src/authoring/codex-run.ts`, `src/authoring/author-cli.ts`, `src/authoring/interactive-playwright-session.ts`, `src/authoring/event-recorder.ts`, `src/authoring/run-recorder.ts`, `src/authoring/discovery-session-cli.ts`, `tests/interactive-playwright-session.test.ts`, `tests/run-recorder.test.ts`.
- **edit:** Have the launcher capture and seal the host JSON event stream’s resolved model/session identity, nonce, stream digest, and exit status; correct `author-cli.ts`’s unresolved-model comment, then pass only the sealed producer record to the session/ledger/manifest receipt seams.
- **done_when:** A finalized external-LLM run names a launcher-sealed, host-authored producer record and chain digest; each accepted action has a prior bound observation and proposal receipt; CLI, stdin, and socket producer metadata are rejected and cannot alter `run.json`.
- **validation:** `npm run build && node --test --test-name-pattern="interactive|run" dist/tests/*.test.js`.
- **depends_on:** none.
- **do_not:** Do not edit `src/runtime/engine.ts`, any JSON schema, `src/capabilities/`, `evidence/`, or create an embedded model loop.

### VS-02 — Enforce and record observe-before-act on both command transports

- **one change:** Require a fresh issued observation identity for every external action and retain an explicit refusal in the ledger.
- **write_scope:** `src/authoring/interactive-playwright-session.ts`, `src/authoring/event-recorder.ts`, `src/authoring/session-control.ts`, `tests/interactive-playwright-session.test.ts`, `tests/session-control.test.ts`.
- **edit:** Extend the shared command parser/handler and socket response path so stdio and socket `act` commands consume the current observation identity; append `observe-required` rejection evidence before returning the refusal.
- **done_when:** Missing, stale, and reused observations cannot execute a browser action through either transport, while observe then one valid act succeeds and leaves a linked ledger record.
- **validation:** `npm run build && node --test --test-name-pattern="interactive|session-control" dist/tests/*.test.js`.
- **depends_on:** VS-01.
- **do_not:** Do not add a transport-specific bypass, modify session launch authentication, or change replay graph semantics.

### VS-03 — Carry declared sensitive values through recording and trace capture

- **one change:** Redact declared sensitive values at every durable evidence boundary and reject any candidate trace that still contains one.
- **write_scope:** `src/authoring/redaction.ts`, `src/authoring/run-recorder.ts`, `src/authoring/playwright-run-capture.ts`, `src/authoring/interactive-playwright-session.ts`, `src/authoring/discovery-session-cli.ts`, `tests/redaction.test.ts`, `tests/run-recorder.test.ts`, `tests/playwright-run-capture.test.ts`.
- **edit:** Add exact-value redaction configuration to the existing recorder/capture options; suspend trace capture around sensitive actions, scan final trace candidates, and finalize contaminated runs with the declared error without writing a promotable trace.
- **done_when:** A generic `fill.value` equal to a declared sensitive value is absent from the manifest, ledger, README, trace, and screenshots; a synthetic contaminated trace fails closed with only redacted diagnostics.
- **validation:** `npm run build && node --test --test-name-pattern="redaction|run-recorder|playwright" dist/tests/*.test.js`.
- **depends_on:** VS-01, VS-02, VS-04.
- **do_not:** Do not rely solely on secret-looking key names, retain a sensitive temporary trace, or weaken trace persistence failure behavior.

### VS-04 — Gate evidence promotion on clean, attested finalized runs

- **one change:** Refuse promotion unless a run has finalized provenance/receipt integrity and clean trace-evidence status.
- **write_scope:** `src/authoring/evidence-promotion.ts`, `tests/evidence-promotion.test.ts`, `src/authoring/run-recorder.ts`, `tests/run-recorder.test.ts`.
- **edit:** Validate the new manifest provenance and trace-clean disposition before copying, preserving the existing all-candidates-before-copy atomicity.
- **done_when:** Promotion rejects a forged/missing producer receipt, broken receipt chain, or sensitive-evidence outcome and still promotes a finalized clean run unchanged.
- **validation:** `npm run build && node --test --test-name-pattern="evidence-promotion|run-recorder" dist/tests/*.test.js`.
- **depends_on:** VS-01.
- **do_not:** Do not scan or repair evidence after it has been copied, overwrite existing evidence, or edit tracked evidence in this unit.

### VS-05 — Make lease ownership and intervention requests live session behavior

- **one change:** Wire `ControlLease` and `InterventionRequest` into a paused interactive session and ledger.
- **write_scope:** `src/authoring/interactive-playwright-session.ts`, `src/authoring/event-recorder.ts`, `src/authoring/session-state.ts`, `src/intervention/request.ts`, `src/intervention/control-lease.ts`, `tests/interactive-playwright-session.test.ts`, `tests/session-state.test.ts`, `tests/control-lease.test.ts`.
- **edit:** Persist controller/epoch in session state, add explicit request and transfer events, and refuse automation actions after the compare-and-swap transfer to a human.
- **done_when:** An intervention returns context/evidence and a live session reference, records automation-to-human ownership at one epoch, and blocks automation until a valid transfer back.
- **validation:** `npm run build && node --test --test-name-pattern="interactive|session-state|control-lease" dist/tests/*.test.js`.
- **depends_on:** VS-02, VS-04.
- **do_not:** Do not add a boolean-only pause, create another browser context, or alter the public capability schemas.

### VS-06 — Expose human control on the existing live socket session

- **one change:** Add explicit operator control commands that operate the running session’s existing browser context under a human lease.
- **write_scope:** `src/authoring/session-cli.ts`, `src/authoring/session-control.ts`, `src/authoring/interactive-playwright-session.ts`, `src/authoring/session-state.ts`, `tests/session-control.test.ts`, `tests/session-state.test.ts`, `tests/interactive-playwright-session.test.ts`.
- **edit:** Extend the established CLI/socket vocabulary for takeover, human observation/action, release, and resume requests, passing current lease epoch and recording human actions distinctly from model decisions.
- **done_when:** A person can discover the active session from `scripts/session status`, take control through its socket, act in the already-running context, and an ordinary automation action cannot be mislabeled as human activity.
- **validation:** `npm run build && node --test --test-name-pattern="interactive|session-control|session-state" dist/tests/*.test.js`.
- **depends_on:** VS-05.
- **do_not:** Do not start a fresh browser/login for the operator, accept human actions after release, or add a second command parser.

### VS-07 — Validate a human-modified state before automated continuation

- **one change:** Implement detector-backed resume decisions and transfer control back only after a valid same-session checkpoint.
- **write_scope:** `src/intervention/resume.ts`, `src/intervention/control-lease.ts`, `src/authoring/interactive-playwright-session.ts`, `src/authoring/event-recorder.ts`, `tests/control-lease.test.ts`, `tests/interactive-playwright-session.test.ts`, `tests/state-machine.test.ts`.
- **edit:** Replace the rejecting resume stub with artifact-detector evaluation against a fresh observation; record validated resume, completion, and rejection paths and require the matching human lease epoch for transfer.
- **done_when:** Valid human recovery resumes the admitted stage or completes; unknown/invalid state keeps human ownership and returns a typed rejection with captured evidence rather than attempting an action.
- **validation:** `npm run build && node --test --test-name-pattern="interactive|control-lease|state-machine" dist/tests/*.test.js`.
- **depends_on:** VS-05, VS-06.
- **do_not:** Do not let an operator declare a stage without verification, silently reset the fixture/session, or change `schemas/result.schema.json`.

### VS-08 — Bring all LedgerSMB capture pilots under the common policy and evidence boundary

- **one change:** Route the four LedgerSMB pilots through `ArtifactPolicy` plus the declared-sensitive-value recorder/capture path.
- **write_scope:** `src/authoring/ledgersmb-initialize-pilot.ts`, `src/authoring/ledgersmb-partners-pilot.ts`, `src/authoring/ledgersmb-catalog-pilot.ts`, `src/authoring/ledgersmb-lifecycle-pilot.ts`, `src/authoring/redaction.ts`, `src/authoring/run-recorder.ts`, `src/authoring/playwright-run-capture.ts`, `tests/policy.test.ts`, `tests/redaction.test.ts`, `tests/run-recorder.test.ts`, `tests/playwright-run-capture.test.ts`.
- **edit:** At each pilot’s existing action seam evaluate the same allowlist/risk policy before browser execution and provide fixture-sensitive values to the common recorder/capture APIs.
- **done_when:** Every pilot refuses an out-of-policy action before it reaches Playwright and cannot persist its declared fixture secret in event or trace evidence.
- **validation:** `npm run build && node --test --test-name-pattern="policy|redaction|run-recorder|playwright" dist/tests/*.test.js`.
- **depends_on:** VS-03.
- **do_not:** Do not treat pilots as an unreviewed policy exception, invoke Docker during unit tests, or retain/modify old evidence in this unit.

### VS-09 — Preserve published schema compatibility while proving intervention result behavior

- **one change:** Confirm the unchanged published schemas and committed artifacts cover the completed handoff result contract.
- **write_scope:** `tests/schemas.test.ts`, `tests/artifact-quality.test.ts`, `src/audit/artifact-rubric.ts`.
- **edit:** Add only compatibility/regression assertions needed to prove existing `intervention-required` results and all three artifacts remain valid; schemas and runtime source are verification targets, not write targets.
- **done_when:** The three committed artifacts validate against the published capability schema, invocation/result fixtures validate, and the existing engine intervention terminal outcome remains typed and schema-valid.
- **validation:** `npm run build && node --test --test-name-pattern="schemas|artifact-quality|engine|state-machine" dist/tests/*.test.js`.
- **depends_on:** VS-07.
- **do_not:** Do not edit schema or runtime source, version-bump schemas for per-run ledger data, weaken artifact validation, or edit capability artifacts merely to make an unrelated test pass.

### VS-10 — Recapture and promote one complete clean handoff replay as acceptance evidence

- **one change:** Produce and review a clean promoted replay run proving pause, human action, detector-validated resume, and terminal behavior on the same live session.
- **write_scope:** `runs/`, `evidence/runs/`, `src/capabilities/dolibarr-third-party-lookup.ts`, `src/runtime/dolibarr-third-party-replay.ts`, `src/authoring/interactive-playwright-session.ts`, `src/authoring/session-cli.ts`, `scripts/session`, `scripts/promote-run`.
- **edit:** Use the implemented operator socket seam against one documented reset fixture; inspect the raw run, promote exactly the reviewed clean run, and add its ID to artifact provenance only if the replay and persisted result verify it.
- **done_when:** One promoted replay run contains an intervention request, automation-to-human transfer, separately recorded human action in the same run/browser session, fresh-observation resume validation, human-to-automation transfer, and a verified terminal result with no declared sensitive value in ledger/trace/screenshots; the artifact provenance names that run only after review.
- **validation:** `DOLIBARR_FIXTURE_PASSWORD=<fixture-password> npm run replay:dolibarr:third-party`.
- **depends_on:** VS-03, VS-04, VS-06, VS-07, VS-09.
- **do_not:** Do not run fixture lifecycle while another capture is active, promote a run before secret review, substitute a fresh operator browser, or claim a model drove this deterministic replay.

### VS-11 — Remove contaminated tracked evidence and update the submission proof narrative

- **one change:** Delete the six unsafe evidence records and truthfully update the reviewed proof/write-up to point only at clean, attested discovery and replay evidence.
- **write_scope:** `evidence/runs/20260915173426044-cf172ab3/`, `evidence/runs/20260915174331177-9a4ac259/`, `evidence/runs/20260915174522338-d689ee84/`, `evidence/runs/20260915174527865-4ee2f9eb/`, `evidence/runs/20260915174532327-fbb724a9/`, `evidence/runs/20260915174535371-b7e6f918/`, `assignment-proof.md`, `REPORT.md`, `README.md`.
- **edit:** Remove each contaminated directory as one intentional cleanup, then update the proof matrix and submission narrative from the new checked evidence rather than preserving stale claims.
- **done_when:** None of the six sensitive evidence directories remains tracked; no README/report/proof claim cites them as evidence; the remaining evidence set includes an attested LLM discovery run and the promoted same-session handoff replay.
- **validation:** `if git grep -n -i -E "password|secret|authorization" -- evidence/runs; then exit 1; fi`.
- **reconciliation:** The Mind runs `npm run verify` during final reconciliation.
- **depends_on:** VS-08, VS-10.
- **do_not:** Do not redact historical evidence in place, leave its trace archive tracked, fabricate a replacement run ID, or change source behavior in this cleanup unit.

## Acceptance evidence

The final review must inspect the manifest, receipt chain, events, screenshots, trace-clean disposition, trace archive, and terminal result for the new discovery and replay runs. The discovery run must prove a non-human external model producer through the harness-attested receipt and linked observation/decision/action sequence. The replay run named by `VS-10` is mandatory: it must show `intervention-requested`, automation-to-human `control-transfer`, a human action, detector-backed `resume-validated`, human-to-automation transfer, and the verified terminal outcome in one run directory. The Mind runs the full final code check, `npm run verify`, during reconciliation; Hands run only their focused unit validation commands. Target-facing commands are run only after review of the completed source units.
