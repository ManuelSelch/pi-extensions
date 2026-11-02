# Agentic flow

`agentic-flow` is currently excluded from native loading in local settings. Its existing `/implement`, `/review`, and `/agentic-flow` commands remain unchanged. Enable it explicitly through `/extensions` to try the continuation draft; enabling also exposes those existing commands.

When loaded on a Pi runtime supporting structured prompt sections and `agent_before_settle`, the extension asks the model to end responses with a status line: `done`, `blocked`, or `not-finished`. At the final actionable boundary it continues only a normally completed assistant response ending exactly in `[agentic-flow: not-finished]`. Cancellation, errors, queued work, unavailable continuation, and missing or other status lines do not trigger it. A visible continuation message asks the agent to finish the original request while respecting approval and input requirements.

The limit is **two automatic continuations per user request**, currently a code constant. A notification reports continuations and an exhausted limit. The count resets on a new user request. There is no classifier, review, or pipeline integration yet.

This is a deterministic policy over a **model-provided signal**, not a deterministic assessment of task completion or approval needs. A model can omit or mislabel the status, so the extension can miss unfinished work or continue when it should not. Do not rely on the marker as an independent safety or approval guarantee. On older runtimes without structured prompt sections the model receives no status instructions, so automatic detection is not expected to work.

Behavior examples: [continuation scenarios](../../agentic-flow/tests/integration/continuation.test.cjs) use a simulated lifecycle. [Native boundary tests](../../agentic-flow/tests/integration/native-boundary.test.cjs) exercise Pi's actual settlement boundary against the development and installed server runtimes; neither uses a live provider.
