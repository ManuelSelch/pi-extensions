# GitHub Actions

[Pipeline overview](README.md)

## Wait for GitHub Actions


After the user approves a merge/push and the push finishes, call `pipeline_wait({})`. It resolves local `HEAD` once and watches that exact commit in the detected GitHub repository. If the merge/push was done in another checkout, pass the pushed commit as `ref` (it must resolve locally). The tool never performs or approves the merge/push itself.

- Requires installed/authenticated `gh` and a `github.com` Git remote (same origin-first detection as status). No `.pi/pipeline.yaml`, local suite approval, widget or UI is required. Detached HEAD works for waiting.
- Optional inputs: `ref` defaults to `HEAD`; `timeoutSeconds` defaults to 1800, greater than zero and at most 86400. The deadline includes Git resolution, discovery, polling and failed-job lookups. Individual CLI calls retain the existing 10-second timeout and bounded output.
- Resolves repository and full commit SHA once, then queries paginated runs by `head_sha` every 15 seconds, independently of the branch-status cache. Response SHAs are checked too. All runs returned for that SHA are watched, including multiple events for the same workflow; run IDs and current attempts stay distinct. No branch fallback or cached success is accepted. If GitHub reports more than its 1,000-run filtered-search cap for this SHA, waiting fails as unavailable rather than accepting a partial set.
- Waits for runs to appear until the deadline. All discovered runs must be completed in two consecutive identical polls before returning. Newly appearing runs or changed rerun attempts reset confirmation. Disappearing runs prevent completion rather than becoming an empty success.
- **Discovery limit:** GitHub does not announce that every future run has been created. The extra terminal poll gives a 15-second grace period, not a guarantee about arbitrarily delayed workflow creation, future reruns, or PR synthetic merge commits with a different SHA. Workflows that never trigger for this commit are not expected or inferred from branch history.
- Returns `passed` when all discovered conclusions are `success`, `neutral` or `skipped`; other terminal conclusions (including cancelled, timed out, missing and unknown) return `failed`. It waits for the remaining runs even if one already failed. Run names, IDs, attempts, conclusions and URLs are retained. Failed runs include paginated failed/non-success job names and URLs for their exact attempt; unavailable job details are marked explicitly and never turn a failure into success.
- Other outcomes: `not-found` when successful discovery queries found no runs before the deadline; `timed-out` when runs remain unfinished/unconfirmed or resolution/querying exhausted the deadline; `cancelled` for tool cancellation/session replacement/shutdown; `unavailable` for Git/CLI/API failures. Every non-passing result is a tool error with structured details. No stale snapshot is accepted after a query error; raw CLI diagnostics are not exposed.
- The Pi tool emits progress updates while waiting; the Claude MCP adapter does not. Aborting it or replacing/shutting down/reloading the session aborts pending requests and sleeps, awaits cleanup, and only stops local observation—it never cancels remote CI. `/pipeline cancel` remains specific to local suite runs.
- Implementation: `core/wait.ts` owns the deadline/polling lifecycle, `core/github-wait.ts` owns uncached read-only Git/`gh` access, and `core/wait-types.ts` owns run values and conclusion policy. There is no persistent waiter, background agent continuation, automatic repair, push, merge, rerun or CI configuration change. Existing status/widget branch semantics are unchanged.

## Automatic GitHub Actions status


No setup or pipeline configuration is needed. In a checkout with a `github.com` Git remote, the extension uses the installed `gh` CLI and its existing authentication (`gh auth login`). Prefer `origin` when multiple GitHub remotes exist; HTTPS, SCP-style SSH and `ssh://git@github.com/` URLs are supported. GitHub Enterprise hosts are not supported. Branch-status display does not support detached HEAD checkouts (commit-pinned waiting does).

```text
✓ Local 1/1 · 3m ago
✓ GitHub Server package · 2/2 · 32m ago
✗ GitHub Tests · 2/4 · 29m ago
  ├─ ✗ e2e failed
  └─ ○ sonar skipped
◐ GitHub Deploy · running · 1m ago
```

- Show the latest run **per workflow on the current branch**, selecting the highest `run_number` across paginated run results rather than trusting timestamps or API ordering. Rerunning an older run does not supersede a newer run number; jobs still use the selected run's current attempt. Never compare remote runs to HEAD or local source freshness. Workflows with no runs on the branch show `never`.
- The widget uses one local summary and one summary per GitHub workflow, with passing/total counts (completed/total while a workflow is active). Only non-successful jobs expand beneath their workflow; `/pipeline status` retains all jobs and local suites. Tree-nested job rows (`├─` / `└─`) come from that run's exact attempt, including matrix names. `pipeline_status` includes direct job URLs. Job loading uses pagination and the same cache; an individual job-fetch failure shows a jobs-unavailable warning without hiding the workflow outcome. No individual step details are loaded.
- Remote rows also appear when `.pi/pipeline.yaml` is absent. Non-GitHub projects and repositories with no workflows have no remote rows.
- The initial monitor refresh runs in the background: opening a session does not wait for source scanning or GitHub requests. The widget appears when status is ready; shutdown still cancels pending remote requests.
- While a UI session is open, the existing monitor refreshes remote data at most once per 60 seconds. Branch/repository changes invalidate that cache. `/pipeline status` (including bare `/pipeline`) bypasses the TTL; concurrent requests share any fetch already in progress. The status tool and background monitor continue to use the shared 60-second cache.
- A failed refresh shows `⚠ GitHub · unavailable · <reason>` without retaining previous workflow results. The reason is a bounded category (`timeout`, `auth`, `access`, `gh missing`, `connection`, `refresh failed`) and never raw CLI output. The next successful refresh clears the warning.
- Authentication failures are the only category that suggests `gh auth login`. Local suite rows stay visible in every case. Requests use a 10-second per-process timeout, 15-second overall remote-fetch deadline and bounded output.
- Data stays in session memory. Shutdown/reload cancels pending requests and clears polling; nothing is written to the project or remote repository. `pipeline_run` remains local-only. No workflow creation, reruns, cancellation, filtering or remote configuration fields are added.
