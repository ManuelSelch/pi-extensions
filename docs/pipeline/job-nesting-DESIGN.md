# Pipeline Job Nesting — Design

## Proposed Design
- Keep each GitHub workflow as a parent row and render its jobs as visible tree children in `pipeline/widget.ts`: `├─` for intermediate jobs and `└─` for the final job.
- Preserve workflow outcomes and ages, job outcomes, API ordering and existing Local/GitHub section headings.
- Render a workflow's jobs-unavailable warning as its single tree child. Workflows without jobs remain standalone rows.
- Reuse `renderWidget` for terminal and non-terminal widget delivery; the explicit branch characters keep grouping recognizable even if a client collapses leading spaces.

## Decisions & Trade-offs
- Confirmed: the renderer already adds two leading spaces to job rows, but has no visible tree markers. The supplied display does not visibly preserve that indentation; the exact client-side whitespace handling is unconfirmed.
- Use visible tree markers rather than deeper whitespace-only indentation. No remote fetching, status schema, configuration or client changes are needed.
- Retain existing terminal sanitization, colors and width truncation. Extremely narrow views may truncate labels as before.

## Verification
- Add a regression using both Server package and Tests, checking exact parent/child order and the last-child marker for each group.
- Cover single jobs, empty groups, job-fetch warnings, colored output, sanitized names and narrow widths.
- Run focused widget tests, repository tests and typecheck. Leave unrelated existing test edits untouched.

## Open Questions
None.
