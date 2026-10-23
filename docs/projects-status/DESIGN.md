# Projects Browse Native Menus — Design

## Proposed Design
- Use the native `ctx.ui.select(title, options)` approach presented in chat and approved in `mockups/projects-select/DESIGN.md` revision 2. No `ui.custom()`, new Pi Chat component or server/SDK channel. The approved removal of the Projects subtitle applies to production.
- `/projects browse` opens Projects → repositories → repository details. Menu options implement Back, Refresh and Close. Cancelling returns one level and closes at Projects. Existing bare/list/show/status commands remain unchanged.
- Keep catalogue/status coordination in projects App; pure menu builders in UI/Components produce titles and string labels; a thin UI/Container runs native selects and dispatches selected actions. Use numbered repository/project labels to disambiguate duplicate names.
- Apply the subsequently approved table presentation: the repository menu's multiline title contains a padded Repository │ Local │ GitHub table with icon-only status cells. Select options contain only numbered repository names. Measure padding with the existing Pi TUI visible-width utility; box-drawing separators activate Pi Chat's existing preformatted title rendering without changing Pi Chat. Detailed reports retain their explanations.
- Reuse the existing pipeline adapter and text detail formatter. Expose structured completed reads from `ProjectStatus` without changing its text report contract. Each browser owns a separate status coordinator, caching shared repository results until manual refresh and limiting reads to four.
- Load the selected project's completed snapshot before offering repository choices. Refresh rereads the catalogue and refreshes the selected project's status, returning to the appropriate menu if membership disappeared. Never mutate an open native select or stream intermediate results.
- Stop the browser's reader and cancel its native select on session replacement/shutdown or a superseding browse invocation. Discard late results and release resources on normal close and failures.

## Decisions & Trade-offs
- This replaces the unapproved custom-dialog/cross-repository design with the approved native-menu alternative. Pi Chat already forwards native selects and owns modal layout, keyboard/pointer handling and composer focus. Terminal Pi replaces the editor with its native selector.
- No custom search, expansion tree, viewport, status colors or live polling. Menu titles contain preformatted status tables or multiline detail text; repository choice labels contain only names. Exact rendering, wrapping and optional host filtering depend on the host. Large menus/reports retain native host limitations.
- Repository summaries keep local and GitHub results separate, distinguish stale/never/unconfigured/error data and do not invent project-level success. Default checkout, GitHub cache and provider scope stay unchanged.

## Verification
- TDD for structured status reads, icon-only table cells with aligned columns (including wide/combining Unicode names), native menu labels, details, duplicate names, empty states, refresh, back/cancel/close, per-repository errors and lifecycle suppression.
- Integration scenarios use the existing command driver extended with native-select scripts and assertions. Verify no custom UI calls, no catalogue mutations and unchanged text commands.
- Run focused projects tests, full extension tests, typecheck and actual Pi loader smoke. Host-native UI behavior is reused; do not claim a live Pi Chat/terminal walkthrough unless performed.

## Open Questions
None.
