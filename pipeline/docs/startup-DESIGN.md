# Non-blocking Pipeline Startup — Design

## Proposed Design
- Confirmed cause: `session_start` awaits `PipelineMonitor.start()`, which waits for the initial local and GitHub status read.
- Start the existing monitor without awaiting its initial refresh. Handle its background rejection without emitting agent messages. Keep root resolution, monitor ownership, generation guards and shutdown cleanup unchanged.
- The widget appears when the background read completes. Explicit status tools and commands retain their existing awaited behavior.

## Decisions & Trade-offs
- Apply the narrowly requested background-start fix, not a redesign of status caching or separate local/remote polling.
- Existing monitor ownership of the in-flight refresh lets shutdown cancel remote reads and wait for cleanup. No extra timers or detached reader state.

## Verification
- Hold a fake GitHub read unresolved and prove the session-start handler resolves before releasing it; then verify the eventual widget update.
- Keep shutdown-during-read coverage and adapt tests to wait for asynchronous widget readiness rather than assuming startup includes the first render.
- Run full tests, typecheck and loader smoke.

## Open Questions
None.
