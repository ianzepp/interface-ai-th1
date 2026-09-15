# Artifact semantics

The artifact is a versioned state graph and invocation contract, not a transcript,
screen recording, or generated Playwright program.

It must identify:

- the target profile and supported application version;
- typed inputs and their bindings;
- typed outputs and extraction rules;
- an entry stage and uniquely named stages;
- actions, state detectors, transitions, and a fallback for every stage;
- the success checkpoint and terminal outcome taxonomy;
- the policy applied during replay; and
- provenance linking the artifact to discovery and validation runs.

Artifact compilation may normalize executed events and incorporate reviewed
additions. It must not infer unobserved success or silently convert ambiguous
controls into executable targets.
