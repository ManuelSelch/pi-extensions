# GitHub Stale Status — Design

## Overview
Retain the last successful GitHub snapshot when a refresh fails. Replace the normal GitHub heading with `⚠ GitHub · stale 3m · timeout`, preserving cached workflow/job rows below it. No changes to local suite freshness or request deadlines.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| pipeline | [GitHubActions](../../pipeline/github.ts) | Changed | Own session-local last-success data and classify refresh failures |
| pipeline | [renderWidget](../../pipeline/widget.ts) | Changed | Render warning heading and muted cached rows, retaining outcome symbols |
| pipeline | [PipelineStatusReader](../../pipeline/api.ts) | Reused | Expose structured remote status to tools and widget |

## Runtime flow
1. Existing monitor/status request invokes GitHubActions.read().
2. Success replaces the snapshot and records its successful completion time.
3. Failure retains only the same repository/branch's previous successful snapshot, marks it stale and adds a bounded failure reason. Repeated failures preserve the original successful timestamp.
4. renderWidget shows the amber compact warning heading and muted cached rows. With no successful snapshot it shows `⚠ GitHub · unavailable · timeout` and no invented results.
5. The next successful refresh clears the warning. Repository/branch changes and disposal clear retained data as before.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| GitHubActions → public status/tool/widget | Failure returns empty workflows and error → optional stale flag, lastSuccessfulAt ISO timestamp and bounded errorKind alongside error; stale workflows may be retained | Additive fields; error remains present on failures so consumers must not interpret retained outcomes as fresh |

checkedAt remains the current fetch-attempt timestamp. Stale age uses lastSuccessfulAt, never workflow run age. Existing signatures, 60-second cache, worker limits, cancellation and job-only error handling remain unchanged.

## Decisions & Trade-offs
- Keep one session-local snapshot; no persistence, dependencies or extra requests.
- Classify timeout, authentication, access, missing CLI, connection and other failures without exposing raw CLI diagnostics. Unknown failures must not recommend login.
- Dim stale rows using the existing muted theme color; preserve all original status symbols and job nesting.
- Preserve unrelated design documents; document the changed failure behavior in README.

## Verification
- Deterministic reader tests: initial failure, success/failure/repeated failure/recovery, classification, branch invalidation and cancellation.
- Widget tests: exact compact heading, successful-fetch age, warning/muted styling, retained job tree, no-snapshot fallback, local independence and narrow widths.
- Run focused tests, full extension tests and typecheck.

## Open Questions
None.
