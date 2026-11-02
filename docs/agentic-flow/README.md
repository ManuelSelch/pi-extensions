# Agentic flow

`agentic-flow` exposes `/agentic-flow`, `/implement`, and `/review`. Enable the extension through `/extensions` if disabled. It requires a Pi runtime supporting structured prompt sections and `agent_before_settle`.

## Deterministic continuation

The extension asks the model to end responses with a status line: `done`, `blocked`, or `not-finished`. At the final actionable boundary it continues only a normally completed assistant response ending exactly in `[agentic-flow: not-finished]`. Cancellation, errors, queued work, and missing or other status lines do not trigger it. A visible message asks the agent to finish the original request while respecting approval and input requirements.

The limit is **two automatic continuations per user request**, currently a code constant. Notifications report continuations, an exhausted limit, and boundary details when a marker is observed but not continued. This is a deterministic policy over a **model-provided signal**, not a deterministic assessment of task completion or approval needs. A model can omit or mislabel the status; do not rely on it as an independent safety or approval guarantee.

## Jev observation

Jev is off by default. `/agentic-flow jev on` enables observation for the current loaded session; `/agentic-flow jev off` disables it. It resets to off on session start or reload. `/agentic-flow` reports the current state and selected provider. Environment variables must be available to the Pi server process, not only a separate terminal:

- TypeSafe (default): `JEV_PROVIDER=typesafe`, `TYPESAFE_API_KEY`; model `jev-1.14.0`.
- OpenRouter: `JEV_PROVIDER=openrouter`, `OPENROUTER_API_KEY`; native Decisions model `typesafe/jev-1.14`.

**Privacy:** enabling observation authorizes transmission of the most recent user request and subsequent assistant and tool-result text to the configured external provider. The text may contain secrets and is not redacted. System instructions, earlier conversation, thinking, images, tool-call arguments and custom messages are omitted; omissions may make the assessment uncertain. Payloads above 24,000 bytes fail rather than silently truncate. Provider calls have a 30-second timeout and a 65,536-byte response limit. Failures use content-free diagnostics.

On settlement Jev reports `done`, `blocked`, `not-finished`, or `uncertain` and its returned confidence. It does **not** trigger continuation; the existing marker policy remains active even if Jev disagrees or fails. Confidence is provider output, not a calibrated guarantee. No review or pipeline integration is implemented.

## Synthetic Jev replay

Run `node agentic-flow/jev/replay-cli.ts --live` from the repository root with the provider environment variables above. The explicit `--live` flag sends six synthetic fixtures (two each for Done, Blocked and Not Finished) to the configured provider, with one request per fixture; charges may apply. Expected labels and fixture IDs remain local. The report shows expected and actual outcomes, confidence, disagreements and errors; errors produce a nonzero exit status. Without `--live`, no requests are made. The fixtures are development examples, not a held-out benchmark or evidence of calibrated accuracy.

Transport and validation are adapted from the local `pi-session-analyzer` Jev implementation. Behavior examples: [continuation](../../agentic-flow/tests/integration/continuation.test.cjs), [Jev observation](../../agentic-flow/tests/integration/jev-observation.test.cjs), and [native boundary](../../agentic-flow/tests/integration/native-boundary.test.cjs). The provider tests use mocked HTTP; none of these tests calls a live model.
