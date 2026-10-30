# Quiz and readable pending prompts — Design

## Overview
- Implement the approved [revision 4 mockup][mockup] by improving Pi Chat's existing select/editor views. Minimize/reopen is local presentation state; the server continues waiting on the same prompt.
- Add explicit formatted prompt content to the SDK contract and a small host presentation helper. The quiz still calls Pi's existing select/editor methods; no Pi fork, custom terminal component, browser quiz renderer registry, or new question lifecycle is introduced. [Requirements](REQUIREMENTS.md) remain the scope reference.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| TypeScript SDK | [promptSchema][sdk-wire], [uiPromptSchema][sdk-models] | Changed | Carry the same explicit content/submission fields through authoritative v2 wire validation and application projection validation |
| TypeScript SDK | Proposed `extension-ui` subpath with `selectWithPresentation` / `editWithPresentation` | New | Structural, Pi-independent types; call existing UI methods with host presentation scope, or compose readable terminal titles |
| pi-server | [createWebUiContext][server-ui] | Changed | Expose proposed host-only `withPromptPresentation` capability; attach call-scoped presentation to the next standard dialog request |
| pi-server | [UiPromptRegistry][registry], [ServerPublisher][publisher] | Reused/changed at request boundary | Own pending requests, IDs, settlement and expiry; transport explicit content without dropping it |
| Pi Chat | [AppControllerProvider][controller], proposed prompt presentation controller | Changed/new | Own browser-only per-prompt drafts and minimized state outside SDK snapshots; reconcile against all live sessions |
| Pi Chat | [PromptModal][modal], proposed `PendingPrompt` | Changed/new | Render existing controls and Markdown body; minimize/reopen without responding; show pending bar above composer |
| Pi Chat | [ComposerView][composer], [GlobalKeyboardController][keyboard], existing focus helpers | Changed | Place pending bar within measured footer; distinguish visible overlays from pending work and prevent shortcut/focus conflicts |
| Pi Chat | [Markdown][markdown] | Reused | Safe lists/emphasis, highlighted code, display math; disable images in prompts; do not enable raw HTML |
| Extensions | Proposed `quiz/index.ts`; existing teach skill | New/changed | Collect one question's answer/reasoning; agent evaluates and chooses subsequent questions |
| Swift SDK | [Protocol artifact importer][swift-import] | Changed artifacts only | Import regenerated authoritative schemas/fixtures; retain existing structured-question UI limitations |

- **Server state:** prompt content and lifetime. **SDK state:** authoritative session projection. **Browser state:** `{minimized, value, query, activeOption, selectedOption, submitting}` keyed by server instance, runtime session ID, and prompt ID. The presentation controller outlives tab view changes, but not a browser reload; no localStorage or draft synchronization between controllers.

## Runtime flow
1. The agent prepares a question and expected solution, then calls `quiz` with question ID, short title, Markdown question content, and uniquely identified plain-text options. The answer key is not a tool parameter.
2. `quiz` calls proposed `selectWithPresentation(ui, request)`. On hosted Pi, this helper invokes `ui.withPromptPresentation(presentation, callback)` and the callback calls the ordinary `ui.select(title, options)`. On terminal Pi, it calls ordinary `ui.select` with title plus readable body text. This is explicit platform adaptation, not support for old server versions.
3. `createWebUiContext` stores presentation using a per-UI-context `AsyncLocalStorage` scope, then its normal select/editor implementation forwards it to `UiPromptRegistry.ask`. The scope is bound to the awaited callback; parallel/nested dialogs cannot steal global “next prompt” metadata. Request content is copied when asked; the registry does not retain callbacks or scopes.
4. The registry allocates its normal prompt ID. Publisher sends it through existing `prompt.list.changed` and snapshot paths. Pi Chat displays a formatted body and plain-text answer choices. For an explicit select, clicks select without settling; Continue submits the selected original option string.
5. Minimize changes only browser presentation state. After the modal exit, release focus containment and scroll locking, preserve the draft, and show “Question pending” plus Reopen above the composer. Reopen restores the same request and draft. No WebSocket request is sent in either direction.
6. Continue answers the select through existing `prompt.answer`. The helper returns the selected string; `quiz` maps it back to its stable option ID. It then calls `editWithPresentation`, using the existing editor UI with selected-answer context and the reasoning prompt. Editor Submit, including an empty string, completes the quiz call. Cancellation at either stage returns cancelled status, not a partially submitted quiz answer.
7. The agent evaluates answer and reasoning, writes feedback to the transcript, and automatically asks a suitably different next question until understanding is demonstrated or a checkpoint is appropriate. The learner can minimize that next prompt to read the feedback. The tool itself does not grade or loop.

**Pending-state reconciliation**
- Reconcile drafts against SDK prompt IDs, not JavaScript object identity. Same-ID snapshots must not reset text, selection, filtering, or minimized state. Remove drafts only after authoritative removal, session disposal/replacement, or server-instance replacement. A transient disconnect is not evidence of removal; disable answering until control/connectivity returns.
- Preserve the current stack rule: only the top prompt can be answered. A new prompt opens normally; minimizing one request does not silently minimize its successor. Underlying prompts retain their own drafts.
- Answer/cancel disables duplicate submission while settlement is pending. On failure with the same request still live, retain the draft and allow retry. Expiry/abort/removal clears stale controls even during a minimize/exit transition. Never send a second response from an exit callback.
- Keep existing immediate-menu handover behavior for literal menus. Do not apply its “same menu” heuristic to explicit question drafts. Minimize has its own transition reason and must not be delayed by the 400 ms answered-menu handover timer.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Pi extension → native Pi UI | Standard select/editor calls → the same calls, optionally reached through SDK presentation helpers | Native Pi signatures unchanged; `custom()` remains unused. Terminal titles include body text; browser-level Markdown layout is not promised in the terminal |
| SDK helper → hosted UI context | No formatting capability → proposed `withPromptPresentation(presentation, callback)` in-process host capability | New pi-server-specific API, **not** an upstream Pi API. Pi's inspected runner copies extra UI members and wraps select/editor, so this scope can encompass ordinary calls; verify against both installed and server-pinned Pi versions |
| Host → SDK wire/Chat projection | `title`, kind-specific strings/options → retain these and add optional `body: {format: "plain" | "markdown", text: string}` and optional `submitLabel` / `cancelLabel` | Body absence means no separately supplied content, not legacy negotiation. Title, options, placeholder and prefill remain literal. No encoded JSON or tool-name detection |
| Select prompt → clients | Selecting an option normally settles immediately → required select-only `submission: "immediate" | "explicit"` | Deliberate coordinated contract change. Standard server selects emit immediate; presented quiz selects emit explicit. Other kinds do not accept this field. No missing-field fallback/default is proposed |
| Browser → server | Existing `prompt.answer` with string/boolean value or cancelled status → unchanged | Select returns the original exact option string; renderer labels never replace identity. Editor returns text including an empty string. Minimize is not a result |
| Server → clients | Existing prompt-list events, snapshots, sequence and runtime IDs → unchanged envelopes containing extended prompt data | Update both SDK schemas: changing models.ts alone would let v2 validation strip the fields, and changing v2.ts alone would let Chat's `uiPromptSchema` projection strip them |
| SDK → package consumers | Current pinned published packages → verified updated SDK/server packages and matching Chat lockfile | No automatic publication/push/live restart. Coordinate consumers; do not claim mixed-version support. Import matching Swift contract artifacts and verify decoding separately |

- Proposed presentation types cover title/body, labels, and select submission mode; helpers expose no arbitrary React props or executable browser content. `selectWithPresentation` / `editWithPresentation` return `Promise<string | undefined>` like the native methods. Helpers accept a small structural UI interface, have no runtime dependency on Pi or pi-server, and are exported from a dedicated SDK subpath rather than loading a server inside an extension.
- Hosted formatted requests require the new capability; an RPC context without it reports unsupported formatted UI explicitly. Terminal mode deliberately uses native select/editor presentation. Do not add an extra editor argument: Pi's editor signature and runner forwarding accept only title/prefill. The call-scoped capability solves that boundary without patching Pi.
- `body.text` is capped at 32,768 UTF-16 code units, short button overrides at 64. Validate before asking; keep existing transport frame limits. Native callers without presentation keep current literal multiline-title rendering. Presented prompts use the supplied short title and body; do not split and duplicate the body from the title.
- The proposed quiz input contains question ID, title, body text, and option `{id, label}` entries. It appends a distinct “I don't know” choice and validates uniqueness, including the reserved label. Output distinguishes submitted, cancelled and unavailable UI; submitted output includes original question/options, selected option ID or explicit unknown response, and verbatim reasoning in content and structured details. Invalid input is a tool error. Registry timeout/disconnect already maps to cancelled; do not assert it was a deliberate learner cancellation or a wrong answer.

## Decisions & Trade-offs
- **Minimize is local.** No minimize/reopen/draft-save endpoint, SDK persistence, or server paused state. Existing expiry remains **five minutes**, and losing the controlling browser retains the existing **60-second disconnect grace**. Minimizing neither extends nor pauses either timer; a draft can expire while reading. Session shutdown/abort continues to cancel pending requests.
- **Generic prompt improvements, not a custom quiz component.** Explicit selection plus generic button-label overrides reproduce the approved radio/Continue and reasoning/Submit interaction without changing other menus. Plain choices avoid changing answer-string semantics. No stage badge, draft-saved label, or minimize/cancel explanatory footer sentence.
- **Small host extension rather than upstream changes.** A scoped context capability is needed because standard Pi dialog methods cannot carry an explicit body for both select and editor. It reuses the existing registry and native UI lifecycle rather than creating an event-bus request protocol or shadowing Pi's functions globally. `AsyncLocalStorage` is a Node built-in; no new runtime library is required.
- **Focus and keyboard:** disable modal focus effects while minimized/exiting; restore focus only after exit using the existing focus-return helper, falling back to the pending control when the composer is disabled. Pending work is not a visible overlay. Escape in the open modal still cancels; Escape while minimized must not accidentally cancel or globally abort the blocked question. Explicit Stop remains the way to abort. Update prompt-related keyboard guards deliberately, not just the Modal opened prop.
- **Composer:** disable message submission/command completion while a prompt is pending, matching the reviewed mockup. Do not implement a new steering scheduler. Reading, text selection, navigation, reopening and explicit Stop remain available. This is a scoped behavioral change from today's composer, which only suppresses some focus/completion while prompts exist.
- Use existing runtime-theme tokens and Markdown pipeline, bound scrolling for long code/math, disable prompt images, preserve safe external links and raw-HTML rejection. Do not import React Grab or fake mockup state into production.
- Local source manifests are not a reliable deployed-version contract: Chat currently pins SDK 0.1.1/server 0.1.2 while the server checkout manifest still contains a temporary SDK archive. Implementation must inspect/reconcile the actual dependency graph, preserve unrelated work, and verify packed consumers; editing node_modules is not an implementation strategy.

## Verification
- **SDK:** contract cases for all prompt kinds, plain/Markdown/absent body, explicit/immediate selects, bounds, rejected mismatched fields and unchanged answer results. Verify both live-event and snapshot paths retain content through SDK reduction and Chat projection. Regenerate JSON Schemas, shared valid/malformed fixtures, package exports and Swift artifacts; do not hand-edit generated schemas.
- **Server:** helper scope and runner tests against actual pinned Pi; concurrent, nested and rejected callbacks cannot leak metadata. Plain dialogs remain literal/immediate. Registry identity, exact-once settlement, five-minute timeout, disconnect grace and cancellation remain covered with fake clocks. A real extension must show formatted select followed by editor through the hosted SDK, not only the fake runtime.
- **Chat:** extend existing prompt DOM tests for explicit selection, existing immediate menus, Markdown/code/math safety, empty reasoning and draft retention across snapshots/tab switches. Cover focus trap removal, restore after exit, keyboard handling while minimized, nested prompts, double submit, expiry/abort during transitions, failed responses, reconnect and obsolete draft cleanup.
- **Acceptance:** isolated real-server/browser scenario selects an answer, minimizes, reads/scrolls feedback, reopens, enters reasoning, minimizes/reopens, submits once, and receives the next check. Verify narrow layout, Unicode/code/math, ordinary extension menus, and terminal native registration/interaction. Planned production browser verification is separate from the already user-reviewed mockup.
- Run typechecks, focused/full tests and package builds in each changed repository, contract drift/export checks, and the independently owned Swift decoding/integration checks. No production checks or implementation have run as part of this design request.

## Open Questions
None. The presentation capability and coordinated contract change are proposals requiring explicit technical-design approval before production implementation.

[mockup]: ../../../git/pi-chat/mockups/quiz-prompts/DESIGN.md
[sdk-wire]: ../../../../../Documents/A_Personal/40%20Projekte/47%20Agents/Pi%20Agent/pi-sdk-typescript/src/protocol/v2.ts
[sdk-models]: ../../../../../Documents/A_Personal/40%20Projekte/47%20Agents/Pi%20Agent/pi-sdk-typescript/src/protocol/models.ts
[server-ui]: ../../../../../Documents/A_Personal/40%20Projekte/47%20Agents/Pi%20Agent/pi-server/src/runtime/pi/web-ui-context.ts
[registry]: ../../../../../Documents/A_Personal/40%20Projekte/47%20Agents/Pi%20Agent/pi-server/src/extensions/ui/ui-prompt-registry.ts
[publisher]: ../../../../../Documents/A_Personal/40%20Projekte/47%20Agents/Pi%20Agent/pi-server/src/transport/server-publisher.ts
[controller]: ../../../git/pi-chat/src/web/app/AppControllerContext.tsx
[modal]: ../../../git/pi-chat/src/web/extensions/prompts/PromptModal.tsx
[composer]: ../../../git/pi-chat/src/web/chat/composer/ComposerView.tsx
[keyboard]: ../../../git/pi-chat/src/web/app/keyboard/GlobalKeyboardController.tsx
[markdown]: ../../../git/pi-chat/src/web/chat/markdown/Markdown.tsx
[swift-import]: ../../../../../Documents/A_Personal/40%20Projekte/47%20Agents/Pi%20Agent/pi-sdk-swift/scripts/protocol-artifacts.py
