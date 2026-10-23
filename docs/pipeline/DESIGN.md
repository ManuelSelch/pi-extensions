# GitHub Actions Status — Design

## Proposed Design
- Add a small GitHub Actions reader inside the existing pipeline feature. Use Git and the installed, authenticated `gh` CLI; add no dependencies or configuration fields.
- Resolve the repository from its GitHub remote (prefer origin) and read the checked-out branch. Query Actions workflows and their latest run on that branch, independent of local HEAD and uncommitted files. A detached HEAD has no current branch and displays no remote rows.
- Keep remote results in session memory, separate from local results and approval state. Expose a separate `github` section through `pipeline_status`, `/pipeline status`, and the existing widget.
- Render one clearly prefixed `GitHub · <workflow>` row with its latest outcome and age. Include run URLs in detailed tool output. Distinguish queued, running, success, failure, cancelled, skipped and other conclusions without claiming success for unknown values.
- Show remote rows even without a local pipeline configuration. No workflows or a non-GitHub repository means no remote rows. Workflows with no branch run show “never”.
- Reuse the current UI monitor to trigger remote refreshes, throttled to once per 60 seconds and deduplicated while in flight. Branch/repository changes invalidate the cached selection. Explicit status requests reuse the same bounded cache.

## Decisions & Trade-offs
- Read-only integration: never create workflows, run jobs, cancel jobs, request configuration approval or add setup/disable options.
- No commit matching, stale-code warnings or persistent remote cache. Job rows follow the approved extension below; individual step details remain out of scope.
- Use bounded CLI timeouts and output. Remote errors never suppress local results. For a detected GitHub repository, report missing `gh`, authentication or fetch failures concisely; never prompt automatically or display cached results as a successful fresh fetch.
- Stop session refreshes on shutdown/reload and prevent late remote responses from restoring the widget.

## Verification
- Deterministic tests with a fake CLI boundary cover remote detection, branch selection, latest-per-workflow selection, status mapping, no runs, errors, timeout and cache deduplication.
- Cover remote-only widget visibility, local/remote independence, narrow rendering, branch switches and shutdown cleanup.
- Run existing pipeline tests, full extension tests, typecheck and Pi loader smoke test. Document prerequisites and refresh behavior in the pipeline README.

## Job Rows — Approved Extension
- Extend the existing reader to fetch all pages of jobs for the selected run's explicit `run_attempt`, preserving job names and API order, including matrix jobs. Never mix attempts or infer jobs from workflow YAML.
- Add optional job data and a job-fetch error to each workflow. Include direct job URLs in detailed status. If job loading fails, retain the workflow outcome and show an indented jobs-unavailable warning instead of hiding valid workflow/local state.
- Reuse the outcome renderer for indented job rows underneath each workflow. Show passed/failed/running/queued/skipped/cancelled and unknown states explicitly; keep ages on workflow rows only.
- Reuse the existing cache, bounded workers, timeouts and shutdown cancellation. No configuration, dependencies, CI mutations or step expansion.
- Verify pagination, explicit attempt selection, matrix names, empty jobs, partial job-fetch errors, links, rendering, terminal sanitization and existing local/remote regressions.

## Open Questions
None.
