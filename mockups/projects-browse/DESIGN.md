# Projects Browse — Interaction Preview

## Goal and scope
- Revision: **1**. Review status: **approved**. User approved both presented interface previews with “approved. implement it”. Approval covers this revision’s layout and interactions; production technical design remains a separate approval checkpoint.
- Explore `/projects browse` in Pi terminal and Pi Chat with the same registered-project hierarchy and local/GitHub pipeline information.
- Isolated HTML/CSS/JavaScript with deterministic fixtures only. No production source, backend, real catalogue, credentials, API calls or persistence.

## Layout and interactions
- Compact centered popup over the current conversation; title/counts, search/refresh, project/repository rows, refresh timestamp and keyboard hints.
- Project headings expand/collapse. Repository rows show separate local and GitHub indicators rather than an invented combined verdict. Shared repository fixture appears under two projects; counts show unique repositories.
- Repository details replace the overview in place, with local preparation/suites and nested GitHub workflow/jobs. Back restores the overview. No checkout paths or run URLs.
- Search matches project/repository names and retains project context; searching overrides collapsed state temporarily. Empty projects remain visible.
- Arrow keys and page keys navigate. Enter expands or opens details. `/` focuses search, `r` refreshes outside text input, Escape clears search, then leaves details, then closes. Explicit close always closes.
- Pi Chat includes pointer controls, a focus boundary and simulated composer-focus return. Native implementation should use Mantine and the existing composer-focus helper.
- Narrow layouts retain compact status columns and bounded vertical scrolling. Terminal presentation uses monospace text and square borders. Browser approximation does not validate native terminal sizing, input protocols or focus behavior.
- Refresh uses deterministic staggered fake completions and guards obsolete updates on close. No animations or remote requests. Refresh reports the existing GitHub cache limit, not a promise to bypass it.

## Review URLs and states
- `/projects-browse/?view=chat` — populated Pi Chat preview.
- `/projects-browse/?view=terminal` — terminal-style approximation.
- Either view supports `state=populated`, `state=loading`, `state=error`, `state=empty`.
- Populated fixtures also include stale results, running/queued pipelines, missing local config, no GitHub runs and an authentication error. The error state adds an unavailable checkout.
- Preview state resets on reload. Status text and controls are design material, not a production transport contract.

## Integration investigation
- Read Pi Chat `docs/extension-api.md`, `docs/architecture.md`, `src/web/extensions/Slot.tsx` and `src/web/extensions/prompts/PromptModal.tsx`.
- Current documented registry supports buttons, badges, actions and extension-owned snapshot state. This is newer than the older memory entry; current repository documentation takes precedence.
- The existing web prompt component handles native select/input/editor/confirm prompts and already implements composer-focus return. It does not expose a structured, progressively updating project-browser dialog renderer.
- A terminal `ctx.ui.custom()` overlay cannot simply be forwarded as this web dialog. Plan for separate presentation adapters with shared server-owned status values.
- Server/transport contracts live in independent `pi-server` and `pi-sdk` artifacts, not Pi Chat source. The inspected Chat checkout lacks its installed pi-server dependency; do not claim current server runtime APIs were verified.
- Before production design approval, inspect the matching server/SDK public contracts to choose the smallest request-scoped structured browse channel. Do not put popup-open state or repository status into global extension state if it would broadcast to unrelated clients. Any required server/SDK changes need explicit cross-repository design scope and verification.

## Approval and limitations
- Revision 1 approved for both views; user requested implementation. Preserve these sources as the approved visual reference and complete the technical-design approval checkpoint before production changes.
- Browser serving and syntax checks are not visual/interaction verification. User-led review; no automated browser walkthrough or screenshots requested.
- Still to establish in technical design: exact Pi Chat command-to-dialog transport and per-client refresh/cancellation mechanism. These are engineering investigation items, not changes to the approved feature requirements.
