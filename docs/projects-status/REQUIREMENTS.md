# Interactive Projects Status Popup — Requirements

## Goal
Provide an interactive overview of all registered projects, their repositories, and existing pipeline status without flooding the transcript with a long notification. Extend the existing projects catalogue and read-only status reporting; do not implement a separate catalogue or status provider.

## Requirements
- **R1** — Provide a command-accessible popup listing every catalogue project and its member repositories, including empty projects. A repository shared across projects appears under each membership but is read only once per refresh. Display configured project and repository names, not checkout paths or remote URLs.
- **R2** — Present a compact hierarchical overview with project headings and repository rows. Users can select rows, expand/collapse projects, and open/close repository status details. Project headings show repository counts; do not invent an aggregate project pass/fail verdict.
- **R3** — Show local pipeline preparation and named suite status, including running, failed, passed, stale, never-run and unconfigured states. Expanded repository details show available GitHub workflows and their nested jobs using existing pipeline symbols and semantics. Hide empty GitHub workflow sections but preserve meaningful remote errors and unavailable states.
- **R4** — Support case-insensitive search across project and repository names. Matching a project exposes its repositories; matching a repository retains its project heading. Clearing search restores the full catalogue, and no matches has an explicit state. Preserve selection by stable identity where possible, including project membership for shared repositories.
- **R5** — Support keyboard navigation, page scrolling, expansion, details, manual refresh and dismissal, with visible key hints. Escape clears an active search first, then returns from details, then closes the popup. Closing restores the previous Pi interaction without adding the overview to the conversation.
- **R6** — Open the popup before status reads finish. Show per-repository loading, results and failures progressively without blocking input. Refresh rereads the catalogue and status, retaining valid selection and expansion state. Use existing pipeline cache/freshness rules; manual refresh must not promise uncached remote data. Show refresh progress and last completed refresh time.
- **R7** — Reuse the public pipeline reader and registered default checkout semantics. Deduplicate shared repository reads and bound concurrency to four. Missing checkouts, malformed pipeline configurations, authentication failures and unavailable providers must not hide other repositories or appear as successful checks.
- **R8** — Keep the popup read-only: no suite execution, dependency preparation, catalogue mutations, Git changes, filesystem discovery, session launching or background polling. Closing, session replacement, shutdown or a superseding refresh must prevent obsolete results from updating the popup; release popup-owned resources without breaking existing text reports.
- **R9** — Fit available terminal width and height with a bounded viewport, safe truncation of wide/Unicode names, sanitized terminal control characters, and active theme colors plus text/symbol status cues. Retain keyboard access on small terminals and after resize; show a compact fallback when the full layout cannot fit.
- **R10** — Preserve explicit `/projects list`, `/projects show <project>` and `/projects status [project]` behavior. Offer the popup only where custom terminal UI is supported; unsupported modes receive clear guidance to use existing text commands, not an attempted custom overlay.
- **R11** — Document the entry command, controls, status meanings, remote cache limits, default-checkout scope and terminal-only support. Verify interaction through a UI driver, including search, expansion, details, refresh, dismissal, resize and asynchronous failure/lifecycle cases.

## Assumptions
- This feature targets the existing Pi terminal extension, not a new Pi Chat web popup or Pi Studio screen. Current memory documents the catalogue and pipeline API, but does not establish popup-specific decisions.
- “All projects/repos” means the registered global catalogue and its project memberships, not automatic discovery of folders, unlinked retained repository records or every worktree.
- “Status” initially means the existing local pipeline and GitHub Actions data. Git dirty/ahead/behind, session activity and GitLab status are not included unless explicitly requested.
- Proposed entry point: bare `/projects` opens the popup in supported terminal mode; `/projects list` remains the explicit text overview. This changes the current bare-command behavior and requires confirmation under Q1.
- Repository details stay within the popup, replacing the overview temporarily if necessary on narrow terminals. No mouse support is required for the initial release.

## Implementation Plan
### S1 — Approve Interaction Preview
Description: Resolve Q1–Q4 and produce an isolated preview using deterministic catalogue/status fixtures, without changing production commands. Demonstrate grouped projects, repository details, search, loading/errors and narrow-terminal behavior. Obtain explicit approval of the interaction and layout before production UI implementation. Covers the UX contract in R1–R6 and R9.

### S2 — Expose Incremental Status Snapshots
Description: Refactor the existing status coordinator to expose structured per-repository loading/results/errors while preserving its text report API. Reuse the pipeline adapter, bound reads to four, deduplicate memberships and guard refresh generations and lifecycle cleanup. Verify incremental completion, per-repository failures, refresh races and unchanged text reports with deterministic readers. Implements R6–R8; independent of the final visual layout.

### S3 — Build Searchable Project Browser
Description: After S1, build the approved presentation and interaction state using fixture snapshots: grouped rows, stable selection, project expansion, search, scrolling, repository details, key hints and responsive terminal rendering. Keep status I/O outside rendering components. Verify behavior with a UI driver, including duplicate names, shared repositories, empty states, Unicode, terminal control characters, resizing and theme invalidation. Implements R1–R5 and R9.

### S4 — Connect Popup Command and Refresh
Description: After S2 and S3, wire the approved command entry to the popup and incremental status snapshots. Implement manual refresh, loading/failure states, catalogue rereads, safe close and lifecycle cleanup, plus unsupported-mode guidance. Verify real command integration, progressive updates, cached remote refresh semantics, rapid close/reopen and unchanged explicit text commands. Implements R6–R8 and R10.

### S5 — Verify and Document Popup Workflow
Description: After S4, complete end-to-end terminal interaction checks and document the approved controls and limitations in the existing projects README. Run focused projects tests, the full extension test suite, typecheck and Pi loader smoke checks; manually verify regular/fullscreen terminal focus and resizing. Implements R11 and closes cross-cutting regressions from R1–R10.

## Open Questions
- **Q1** — Should bare `/projects` open the popup, keeping `/projects list` for text, or should the popup use a new `/projects browse` subcommand?
- **Q2** — Is “status” limited to existing local pipeline and GitHub Actions results, or should the scope also include Git dirty/ahead/behind, session activity or another provider?
- **Q3** — Is this popup for Pi’s terminal UI only, or do you also want a Pi Chat/Pi Studio interface?
- **Q4** — Should “all repos” include retained catalogue repositories that currently belong to no project, or only repositories grouped under registered projects?
