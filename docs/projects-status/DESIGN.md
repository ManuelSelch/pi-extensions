# Interactive Projects Status Popup — Design

## Proposed Design
- Implement approved mockup revision 1. Keep the existing catalogue, public pipeline adapter and text status commands; add `/projects browse` without changing bare `/projects`.
- In the extensions repository, add pure browser state under `projects/src/Domain`, incremental status coordination under `App`, and separate terminal Components/Containers. Each browser interaction owns its reader, refresh generation and subscription. Emit loading/results/errors progressively; deduplicate repository identities and run at most four reads concurrently. Text reporting retains its existing API and lifecycle.
- Terminal Container opens `ctx.ui.custom()` as an overlay. Components render value-only snapshots using Pi width/theme utilities; input uses Pi key handling and a searchable bounded viewport. Render separate local/GitHub indicators and in-place details, not a combined verdict.
- Pi Chat needs a new narrow, optional extension-view channel across `pi-server`, `pi-sdk-typescript` and `pi-chat`. Server’s public extension registry registers the projects-browser provider; it returns sanitized, path-free snapshots and refresh/dispose callbacks. No filesystem or pipeline access occurs in the browser.
- SDK defines capability-gated `extension.view.open`, `extension.view.refresh`, `extension.view.close` operations and targeted view-update events. Open returns an opaque view ID and initial snapshot before reads complete. Buffer updates until that response is sent. Server binds ownership to the initiating connection/session; reject foreign IDs and dispose on disconnect, session replacement/close, reload and shutdown. Updates carry view ID and refresh generation; clients ignore obsolete updates.
- Pi Chat routes the exact `/projects browse` command locally to this channel instead of submitting it to the model. A thin container binds SDK updates to Mantine presentation matching the mockup; search/selection/expansion stay client-local. Reuse composer-focus restoration on dialog exit.

## Decisions & Trade-offs
- Current server implements `ctx.ui.custom()` as a no-op; existing prompts support only select/confirm/input/editor. Neither supports this interactive browser. Do not emulate it with repeated prompts or globally broadcast extension state.
- Cross-repository protocol work is required; keep the channel limited to the present projects-browser use case, validate payloads and bound snapshot sizes. Unsupported clients receive text-command guidance. Clients without the optional capability receive no new events; Swift UI changes are outside scope.
- Keep terminal use independent of an installed server package. Register the web provider only when the optional host API is present. No new polling, remote-cache bypass or pipeline execution. Refresh cancellation suppresses obsolete work even where underlying reads cannot abort immediately.
- Update pinned server/SDK artifacts and receipts in their consumers after independent tests. No publishing, pushing or live service replacement.

## Verification
- TDD covers search/selection, incremental completion, four-read concurrency, shared membership, errors and cancellation. Preserve text report regressions and Pi loader/typecheck tests.
- Driver-based terminal and browser tests cover approved interactions, narrow layouts, Unicode/control characters, focus and lifecycle races. Server/SDK tests cover capability negotiation, response/update ordering, payload bounds and cross-connection ownership.
- Verify each affected repository and its artifact consumers before committing completed implementation steps.

## Open Questions
None.
