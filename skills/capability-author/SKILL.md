---
name: capability-author
description: Discover UI workflows through grounded computer use and author or revise typed deterministic capability artifacts. Use during capability discovery and exception authoring, not during deterministic replay.
---

# Capability Author

Create a reviewable capability from actions that were actually executed against
an allowlisted live surface.

## Invariants

- Executed events and observations are the source of truth. Never invent a step,
  locator, output, checkpoint, or successful result.
- Preserve input provenance. Invocation values become bindings, not embedded
  literals.
- Treat an artifact produced from one successful run as a draft.
- Known states receive explicit detectors and transitions. Unknown states stop
  and request human intervention.
- Keep secrets, credentials, tokens, and sensitive raw data out of artifacts and
  persisted logs.
- Do not weaken policy to complete discovery.
- Deterministic replay never invokes this skill or an LLM for decisions.

## Workflow

1. Read [artifact semantics](references/artifact-semantics.md) before creating or
   revising an artifact.
2. Read [targeting](references/targeting.md) when proposing target descriptors or
   reviewing ambiguous controls.
3. Read [exception authoring](references/exception-authoring.md) when adding red
   paths, recovery rules, or intervention transitions.
4. Start from a goal contract containing typed inputs, typed outputs, a success
   condition, target profile, limits, and policy.
5. Operate only through typed computer-use actions. Record the sanitized
   observation, proposed action, concise rationale, policy decision, executed
   result, and evidence reference.
6. Finish discovery only after the declared checkpoint is observed. Preserve
   incomplete runs as evidence, but do not emit them as successful capabilities.
7. Compile the draft from the typed event ledger. Reject artifact content that
   cannot be traced to an executed event or an explicit reviewed addition.
8. Validate each declared branch without model decisions before promoting a new
   artifact version.
