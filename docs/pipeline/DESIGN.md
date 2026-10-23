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
- No commit matching, stale-code warnings, persistent remote cache or job-detail expansion.
- Use bounded CLI timeouts and output. Remote errors never suppress local results. For a detected GitHub repository, report missing `gh`, authentication or fetch failures concisely; never prompt automatically or display cached results as a successful fresh fetch.
- Stop session refreshes on shutdown/reload and prevent late remote responses from restoring the widget.

## Verification
- Deterministic tests with a fake CLI boundary cover remote detection, branch selection, latest-per-workflow selection, status mapping, no runs, errors, timeout and cache deduplication.
- Cover remote-only widget visibility, local/remote independence, narrow rendering, branch switches and shutdown cleanup.
- Run existing pipeline tests, full extension tests, typecheck and Pi loader smoke test. Document prerequisites and refresh behavior in the pipeline README.

## Open Questions
None.
