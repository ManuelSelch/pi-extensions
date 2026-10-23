# Projects Browse Native Menus — Requirements

## Goal
Browse registered projects, their member repositories and local/GitHub pipeline status in Pi terminal and Pi Chat using existing native select dialogs. The approved native-select mockup revision 2 supersedes the earlier custom-popup plan and removes the populated Projects menu subtitle.

## Requirements
- **R1** — `/projects browse` lists registered projects and their member repositories, including empty projects but excluding unlinked retained repository records. Shared repositories reuse completed reads until refresh. Display names, not checkout paths or run URLs.
- **R2** — Use sequential Projects → repositories → detail menus, with project repository counts and numbered labels to disambiguate duplicate names. Do not compute project-level pass/fail. Custom trees and expand/collapse rows are removed from scope.
- **R3** — Show separate compact local/GitHub summaries and full preparation/suite/workflow/job details, preserving stale, never-run, unconfigured, unavailable and error states. Hide empty GitHub workflow sections. Only local pipelines and GitHub Actions are supported.
- **R4** — Use host-native selection and filtering where available. Cross-host search and selection preservation are not guaranteed; custom search is removed from scope.
- **R5** — Offer Back, Refresh and Close as appropriate. Escape/cancel returns one level, closing at Projects. Use native keyboard/pointer/focus behavior without adding overview messages to model context. The populated Projects menu has no explanatory subtitle.
- **R6** — Read a completed status snapshot before opening the selected project's repository menu. Refresh rereads the catalogue and relevant status before reopening the menu; preserve navigation where the project/repository still exists. No progressive updates or custom refresh timestamp/progress UI. Existing remote cache rules remain in force.
- **R7** — Reuse the public pipeline reader at registered default checkouts, deduplicate identities and bound concurrency to four. One missing/invalid repository must not hide other results or appear successful.
- **R8** — Keep browsing read-only: no test execution, dependency installation, catalogue changes, discovery, Git changes, session launching or polling. Stop browser-owned readers/selects on replacement/shutdown and discard late results without affecting text reports.
- **R9** — Use plain strings and native host presentation, sanitize terminal control characters and retain text/symbol status cues. Native host wrapping, theme and large-menu/report limits apply; custom responsive layout and viewport guarantees are removed from scope.
- **R10** — Preserve bare `/projects`, list/show/status and all management commands. Use the same `ctx.ui.select` flow in terminal and Pi Chat; unsupported modes get text-command guidance. No Pi Chat/server/SDK production changes.
- **R11** — Document controls, default-checkout scope, caching and native UI limitations. Verify behavior through pure formatter tests and driver-based command integration tests, plus full suite/typecheck/loader checks. Do not claim host UI walkthroughs not performed.

## Assumptions
- Pi Chat's existing native prompt forwarding and host-owned focus restoration remain available; no custom UI adapter is needed.
- Large menus/details retain existing host limitations. Pi Studio is out of scope.

## Implementation Plan
### S1 — Approve Interaction Preview
Description: Completed: native-select revision 2 approved for both hosts, with the populated Projects subtitle removed. This replaces the custom-popup preview direction.

### S2 — Read Completed Status Snapshots
Description: Expose structured completed reads from the existing status coordinator without changing text reports. Verify deduplication, concurrency, errors and lifecycle suppression. Replaces the earlier incremental-streaming slice; implements R3 and R6–R8.

### S3 — Build Native Project Menus
Description: Add pure title/option builders and App navigation, using numbered project/repository labels, compact status summaries and existing detail formatting. Verify empty/duplicate/error states and Back/Refresh/Close behavior. Replaces the custom searchable tree; implements R1–R5 and R9.

### S4 — Connect Browse Command and Refresh
Description: Wire `/projects browse` to native selects, completed snapshots, catalogue rereads and lifecycle cancellation. Verify exact Projects title, management/text-command preservation and unsupported-mode guidance. Implements R6–R10.

### S6 — Reuse Pi Chat Native Dialogs
Description: Use the same select contract already forwarded by Pi Chat. No custom adapter or protocol implementation remains in this slice. Cover the serialized title/options contract through the command driver; document that native host rendering/focus is reused, not independently changed. Implements Pi Chat support in R10.

### S5 — Verify and Document Native Menus
Description: After S2–S4, complete focused/full tests, typecheck and loader checks; document the approved native controls and limitations. Implements R11.

## Open Questions
- **Q1 — Resolved:** Use `/projects browse`; preserve bare `/projects` as the text overview.
- **Q2 — Resolved:** Include only local pipeline and GitHub Actions status.
- **Q3 — Resolved:** Support terminal Pi and Pi Chat through existing native select dialogs; no custom web components.
- **Q4 — Resolved:** Include only repositories belonging to registered projects.
