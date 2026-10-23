# Project Pipeline Status — Design

## Proposed Design
- Add `/projects status [project]` to the existing projects command, including autocomplete. A named project reports its repositories; omitting the name reports all projects. Empty projects and an empty catalogue receive explicit messages.
- Read each repository's registered default checkout through the public `PipelineStatusReader` from `pipeline/api.ts`. Deduplicate reads for repositories shared across projects and limit concurrent reads to four. Do not enumerate or aggregate other worktrees.
- Keep pipeline access in a small projects Infra adapter. App coordinates catalogue selection and reporting; a pure presentation component formats repository names, paths and status rows.
- Show local preparation and named suite outcomes, including stale and never-run states. Show GitHub workflows and jobs when returned, preserving unavailable/error states rather than suggesting success. Include workflow/job links in the detailed report.
- Publish the report through the existing notification mechanism. Own one lazily created reader per session lifecycle; stop it on session replacement/shutdown and suppress late reports from an obsolete lifecycle.

## Decisions & Trade-offs
- Reuse the API's local freshness rules, remote branch selection and 60-second remote cache. No new combined pass/fail policy, polling, dependencies or pipeline configuration.
- Default checkout status is worktree-specific, not repository-wide test coverage. Display its path so this distinction is visible.
- Catch errors per repository so a missing checkout or invalid local configuration cannot hide other repositories. Explicitly reject missing checkout directories before reading; never repair catalogue paths automatically.
- Distinguish unconfigured local pipelines and absent remote data from successful checks. Remote support remains whatever the API provides today: GitHub Actions, not GitLab.
- This is read-only: never execute suites, prepare dependencies, approve commands or mutate catalogue data. Existing list/show behavior remains unchanged.

## Verification
- Test pure rendering for preparation, suite freshness, workflow/job outcomes, absent configuration, remote errors and safe handling of terminal control characters.
- Extend the command integration driver with a fake public API to cover named/all projects, shared-repository deduplication, bounded concurrency, per-repository failures, autocomplete and lifecycle cleanup/late-result suppression.
- Exercise the real API against temporary Git checkouts without remote access, including missing paths and local-only status. Run projects tests, the full extension suite, typecheck and Pi loader smoke before committing.

## Open Questions
None.
