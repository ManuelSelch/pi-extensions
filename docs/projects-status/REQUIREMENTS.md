# Interactive Projects Status Popup — Requirements

## Goal
Provide an interactive overview in Pi’s terminal UI and Pi Chat of all registered projects, their member repositories, and local/GitHub pipeline status without flooding the transcript with a long notification. Extend the existing projects catalogue and read-only status reporting; do not implement a separate catalogue or status provider.

## Requirements
- **R1** — Provide `/projects browse` to open a popup in both Pi’s terminal UI and Pi Chat, listing every catalogue project and its member repositories, including empty projects. Exclude retained repository records with no project membership. A repository shared across projects appears under each membership but is read only once per refresh. Display configured project and repository names, not checkout paths or remote URLs.
- **R2** — Present a compact hierarchical overview with project headings and repository rows. Users can select rows, expand/collapse projects, and open/close repository status details. Project headings show repository counts; do not invent an aggregate project pass/fail verdict.
- **R3** — Show local pipeline preparation and named suite status, including running, failed, passed, stale, never-run and unconfigured states. Expanded repository details show available GitHub workflows and their nested jobs using existing pipeline symbols and semantics. Hide empty GitHub workflow sections but preserve meaningful remote errors and unavailable states. Status scope is limited to local pipelines and GitHub Actions; exclude Git dirty/ahead/behind, session activity and other CI providers.
- **R4** — Support case-insensitive search across project and repository names. Matching a project exposes its repositories; matching a repository retains its project heading. Clearing search restores the full catalogue, and no matches has an explicit state. Preserve selection by stable identity where possible, including project membership for shared repositories.
- **R5** — Support keyboard navigation, page scrolling, expansion, details, manual refresh and dismissal, with visible key hints. Escape clears an active search first, then returns from details, then closes the popup. Closing restores the previous Pi interaction without adding the overview to the conversation. Pi Chat also provides pointer-accessible controls and restores composer focus after the popup closes.
- **R6** — Open the popup before status reads finish. Show per-repository loading, results and failures progressively without blocking input. Refresh rereads the catalogue and status, retaining valid selection and expansion state. Use existing pipeline cache/freshness rules; manual refresh must not promise uncached remote data. Show refresh progress and last completed refresh time.
- **R7** — Reuse the public pipeline reader and registered default checkout semantics. Deduplicate shared repository reads and bound concurrency to four. Missing checkouts, malformed pipeline configurations, authentication failures and unavailable providers must not hide other repositories or appear as successful checks.
- **R8** — Keep the popup read-only: no suite execution, dependency preparation, catalogue mutations, Git changes, filesystem discovery, session launching or background polling. Closing, session replacement, shutdown or a superseding refresh must prevent obsolete results from updating the popup; release popup-owned resources without breaking existing text reports.
- **R9** — Fit available terminal width and height with a bounded viewport, safe truncation of wide/Unicode names, sanitized terminal control characters, and active theme colors plus text/symbol status cues. Retain keyboard access on small terminals and after resize; show a compact fallback when the full layout cannot fit. Pi Chat presents the same information and interaction model in a responsive, accessible web dialog with bounded scrolling and theme-aware status cues.
- **R10** — Preserve bare `/projects`, explicit `/projects list`, `/projects show <project>` and `/projects status [project]` behavior. Route `/projects browse` to the appropriate terminal overlay or Pi Chat web dialog. Other unsupported clients/modes receive clear guidance to use existing text commands, not an attempted custom overlay.
- **R11** — Document the entry command, controls, status meanings, remote cache limits, default-checkout scope and terminal/Pi Chat support. Verify interaction through terminal and browser UI drivers, including search, expansion, details, refresh, dismissal, resize and asynchronous failure/lifecycle cases.

## Assumptions
- Repository details stay within the popup, replacing the overview temporarily if necessary on narrow terminals. Terminal mouse support is not required; Pi Chat uses normal web pointer and keyboard controls.
- Both interfaces can share structured catalogue/status snapshots and interaction semantics, with separate terminal and web presentation adapters. Current memory establishes Pi Chat extension slots/actions but does not establish a custom-dialog contribution API; S1 must inspect current capabilities before selecting an integration mechanism. A terminal custom component alone does not provide a Pi Chat popup.
- Pi Studio is outside this scope.

## Implementation Plan
### S1 — Approve Interaction Preview
Description: Inspect current Pi Chat command, extension and dialog capabilities and identify the supported integration route and any minimal host-side changes required. Produce isolated terminal and Pi Chat web previews using deterministic catalogue/status fixtures, without changing production commands. Demonstrate grouped projects, repository details, search, loading/errors and narrow layouts. Obtain explicit approval of both interactions and layouts before production UI implementation. Covers the UX contract in R1–R6 and R9; Q1–Q4 are resolved.

### S2 — Expose Incremental Status Snapshots
Description: Refactor the existing status coordinator to expose structured per-repository loading/results/errors while preserving its text report API. Reuse the pipeline adapter, bound reads to four, deduplicate memberships and guard refresh generations and lifecycle cleanup. Verify incremental completion, per-repository failures, refresh races and unchanged text reports with deterministic readers. Implements R6–R8; independent of the final visual layout.

### S3 — Build Searchable Project Browser
Description: After S1, build the approved terminal presentation and shared interaction state using fixture snapshots: grouped rows, stable selection, project expansion, search, scrolling, repository details, key hints and responsive rendering. Keep status I/O outside rendering components and state reusable by Pi Chat. Verify behavior with a UI driver, including duplicate names, shared repositories, empty states, Unicode, terminal control characters, resizing and theme invalidation. Implements terminal behavior for R1–R5 and R9.

### S4 — Connect Popup Command and Refresh
Description: After S2 and S3, wire `/projects browse` to the terminal popup and incremental status snapshots, preserving bare `/projects` and existing text subcommands. Implement manual refresh, loading/failure states, catalogue rereads, safe close and lifecycle cleanup, plus unsupported-mode guidance. Establish the client-neutral browse contract used by S6 without attempting terminal overlays in Pi Chat. Verify real command integration, progressive updates, cached remote refresh semantics and rapid close/reopen. Implements terminal behavior for R6–R8 and R10.

### S6 — Add Pi Chat Popup Adapter
Description: After S1, S2 and S4, implement the approved responsive Pi Chat dialog and `/projects browse` routing through the integration route selected in S1. Reuse the structured snapshot and browse contract, adding only the minimal host integration needed. Provide search, expansion, details, refresh, keyboard/pointer access and composer-focus restoration. Keep data access server-side; scope updates to the requesting client and discard results after close, session replacement or refresh supersession. Verify with a browser UI driver and host/extension integration tests. Implements Pi Chat behavior for R1–R10.

### S5 — Verify and Document Popup Workflow
Description: After S4 and S6, complete end-to-end terminal and Pi Chat interaction checks and document the approved controls and limitations in the existing projects README. Run focused projects tests, the full extension test suite, typecheck and Pi loader smoke checks, plus relevant Pi Chat tests/typecheck/build for host changes. Verify regular/fullscreen terminal focus and resizing, web dialog accessibility/responsiveness and composer-focus restoration. Implements R11 and closes cross-cutting regressions from R1–R10.

## Open Questions
- **Q1 — Resolved:** Use `/projects browse`; preserve bare `/projects` as the text overview.
- **Q2 — Resolved:** Include only local pipeline and GitHub Actions status.
- **Q3 — Resolved:** Support both Pi’s terminal UI and Pi Chat. Pi Studio is not requested.
- **Q4 — Resolved:** Include only repositories belonging to registered projects; exclude unlinked retained records.
