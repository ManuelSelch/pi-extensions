# Projects — Native Select Preview

## Scope and review
- Revision **2**, **approved**. User approved the native-select design with “approved. but remove the Choose a registered project. label”. Revision 2 applies that exact requested removal; populated Projects menus have no explanatory subtitle.
- This approved native-select alternative replaces the custom-browser direction. Production files and existing requirements/technical design have not yet been reconciled with this simpler scope.
- Goal: demonstrate the same `ctx.ui.select(title, string[])` menu flow in terminal Pi and Pi Chat. No `ui.custom()`, special web component, protocol changes or global extension state.

## Interaction
- Projects menu → repository menu with inline local/GitHub status → detail menu with multiline pipeline text in the title.
- Empty projects are selectable and show an explanatory title with Back, Refresh and Close.
- Refresh is a normal menu option; the select resolves, simulated reading completes, then a new select opens with a completed snapshot. No progressive menu mutation.
- Back and cancellation/Escape return one level; cancelling at Projects closes. Close explicitly exits from any menu.
- All option labels are plain strings; status symbols are not independently colored. Numbers disambiguate matching display names.
- Pi Chat uses existing Cancel/OK buttons and pointer selection. Terminal uses arrow keys, Enter, Escape and j/k. Terminal clicks are preview convenience, not a promised native interaction.
- No custom tree, toolbar, guaranteed search or background polling. Fixture menus remain below Pi Chat's existing >8-option search threshold; larger catalogues may get host-provided filtering but it is not part of this preview.

## Presentation and responsiveness
- Terminal selector replaces the editor beneath the conversation, with native-style horizontal borders, accent-colored title and selected-option arrow. This is not a centered popup.
- Pi Chat presents the title/body/options in its existing prompt modal, with standard action buttons. Monospace detail body approximates current preformatted-title handling.
- Titles/options wrap on narrow previews. The HTML viewport scrolls for usability; this does not prove native Pi terminal overflow behavior. Real implementation may need bounded menu pagination for large catalogues.
- No animations. The 800 ms refresh delay is fake. Host prompt handover timing is not simulated.

## Source observations
- Inspected installed Pi `extension-selector.js` and `interactive-mode.js`: native select replaces editor content, renders title and options, and returns an option string or undefined.
- Inspected current Pi Chat `PromptModal.tsx`: splits multiline titles into heading/body, offers select choices and Cancel/OK, supports keyboard navigation and existing composer-focus return.
- These are source-based approximations, not screenshots or runtime verification of either host. Exact colors depend on host theme/version.

## URLs, fixtures and limitations
- `/projects-select/?view=terminal` and `/projects-select/?view=chat`.
- Both support `state=populated`, `state=empty`, `state=error` (Pi Chat checkout unreadable).
- Fixtures cover passed, failed, stale (previously passed), running, queued, unconfigured local pipeline and no GitHub runs. All data is simulated; no APIs, credentials or persistence.
- User-led review. Only serving and JavaScript syntax are checked by the agent; no browser automation requested.
- Approval covers both interface approximations and the native menu flow, with the requested label removed. Approved mockup sources are preserved; no production code changed.
