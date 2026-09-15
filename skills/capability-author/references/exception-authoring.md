# Exception authoring

Classify each observed terminal or intermediate condition as one of:

- business outcome: a legitimate result the caller must receive;
- recoverable condition: a state with a bounded, policy-safe recovery;
- intervention required: a person must control or decide;
- hard failure: execution must stop with debuggable evidence.

Specify where the condition can occur, the observable signals that identify it,
the allowed transition, the retry or recovery budget, and the post-recovery
checkpoint.

Exercise declared exceptions with fixture data or controlled fault injection.
Seeing an exception during LLM discovery does not prove it is handled; replay the
artifact without the model and verify its structured result.

Every stage needs a deterministic fallback. If no declared detector matches,
capture evidence and request intervention rather than guessing.
