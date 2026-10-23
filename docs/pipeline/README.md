# Pipeline extension

Provides native-confirmed local test configuration, manual execution, persisted results, a compact status widget, opt-in after-agent scheduling and automatic read-only GitHub Actions status.

## Usage

Reload Pi after installing `pipeline.ts`. Ask the agent to inspect project instructions, scripts and lockfiles and call `pipeline_configure`. Configure for a fresh worktree, not just the currently installed checkout: include optional `prepare` when dependencies need installation (for npm projects with a lockfile, usually `npm ci`). Omit it for projects that need no preparation or already handle it in their commands. The tool takes a **complete replacement configuration**: include `prepare` and every suite you want to retain; omitted fields are removed. Nothing is written until you confirm the before/after popup. Saving does not immediately execute tests; approved opt-in suites can run after the agent settles.

```json
{
  "version": 1,
  "prepare": {
    "command": ["npm", "ci"],
    "timeoutSeconds": 300
  },
  "suites": {
    "unit": {
      "command": ["npm", "run", "test:unit"],
      "timeoutSeconds": 120,
      "auto": "after-agent"
    },
    "integration": {
      "command": ["npm", "run", "test:integration"],
      "cwd": ".",
      "timeoutSeconds": 600,
      "staleAfterMinutes": 30,
      "auto": "manual"
    }
  }
}
```

Suite declaration order controls serial execution and widget order; suites are not alphabetically sorted. Use descriptive suite names (JavaScript enumerates integer-only names numerically). Reorder suites via `pipeline_configure` to review and approve the new configuration.

Configuration is stored in `.pi/pipeline.json` at the git worktree root, or Pi's cwd outside git. Starting Pi in a git subdirectory still uses the worktree root. Commit the configuration if you want to share it; approvals and results are never stored in that file.

- `pipeline_configure({config: ...})`: validate and save after approval.
- `pipeline_run({suite: "unit"})`: wait for a suite's results; omit suite or use `all` to run all suites serially. Non-passing results are tool errors carrying outcome/output/log paths. Aborting the tool cancels execution.
- `pipeline_status({})`: inspect local configuration/outcomes/freshness and the latest GitHub Actions runs, including run URLs, without executing tests or showing a popup.
- `/pipeline` or `/pipeline status`: show a concise outcome/freshness line per local suite and outcome/age per GitHub workflow; no commands, fingerprints or log paths. The agent's `pipeline_status` tool retains detailed data.
- `/pipeline run unit` or `/pipeline run all`: start a background run, keeping commands usable.
- `/pipeline cancel`: cancel this session's run and pause automation until the next settled agent turn.

Defaults: `cwd: "."`, `timeoutSeconds: 300`, `staleAfterMinutes: 30`, `auto: "manual"`. Set `auto: "after-agent"` only on suites you explicitly want run in the background; integration/e2e are manual unless opted in. Use one-shot commands, never watch mode. Arguments are passed literally, without shell interpolation; put complex workflows in a project script. Working directories must exist and resolve inside the project, including through symlinks.

## TypeScript status API

Other extensions in this repository can import the public `pipeline/api.ts` module instead of calling slash commands or reading private cache files:

```typescript
import { PipelineStatusReader, type PipelineStatus } from "./pipeline/api.ts";

const reader = new PipelineStatusReader();
try {
  const status: PipelineStatus = await reader.read("/path/to/checkout");
  // status.suites: local outcomes and freshness
  // status.github: optional remote workflows, jobs and errors
} finally {
  reader.stop();
}
```

- Own a reader for your consumer's lifecycle to reuse its per-worktree GitHub cache across requests. Stop it on session replacement/shutdown/reload; create a new reader for the next lifecycle. There is no global singleton or automatic polling.
- `read(cwd)` canonicalizes a checkout or subdirectory to its worktree root. Different worktrees retain separate local results and remote readers. Existing non-Git directories use their own directory as the root; missing paths reject.
- `read` is read-only: it never executes suites/preparation, changes configuration or approvals, registers UI, or creates local result caches. It does use the existing read-only Git/`gh` status queries. No active Pi session in the target repository is needed.
- Local status is recomputed per call; remote requests reuse the existing 60-second cache, in-flight deduplication and branch invalidation. Independent reader instances have independent caches. Local configuration/read errors reject; remote-unavailable errors are returned in `status.github.error`. Non-GitHub or unsupported branch selections omit `github`.
- `stop()` is idempotent, aborts remote requests and releases remote readers. Further reads and in-flight reads that reach their completion after disposal reject with a stopped-reader error. Local filesystem status reads already underway are not cancellable, but their late results are discarded.
- The API re-exports local/remote status types. It does not aggregate outcomes into a combined pass/fail policy. The pipeline tool, slash command and widget use this same API.

## Automatic GitHub Actions status

No setup or pipeline configuration is needed. In a checkout with a `github.com` Git remote, the extension uses the installed `gh` CLI and its existing authentication (`gh auth login`). Prefer `origin` when multiple GitHub remotes exist; HTTPS, SCP-style SSH and `ssh://git@github.com/` URLs are supported. GitHub Enterprise hosts and detached HEAD checkouts are not supported in this minimal version.

```text
## Local
✓ unit 3m ago
## GitHub
✓ Server package passed 32m ago
✗ Tests failed 29m ago
  ✓ build passed
  ✓ unit passed
  ✗ e2e failed
  ○ sonar skipped
› Deploy running 1m ago
```

- Show the latest run **per workflow on the current branch**, even if it tested an older commit. Never compare remote runs to HEAD or local source freshness. Workflows with no runs on the branch show `never`.
- Rows are grouped under one `## Local` and one `## GitHub` heading; empty sections are hidden. Indented job rows show all jobs from that run's exact attempt, including matrix names. `pipeline_status` includes direct job URLs. Job loading uses pagination and the same cache; an individual job-fetch failure shows a jobs-unavailable warning without hiding the workflow outcome. No individual step details are loaded.
- Remote rows also appear when `.pi/pipeline.json` is absent. Non-GitHub projects and repositories with no workflows have no remote rows.
- The initial monitor refresh runs in the background: opening a session does not wait for source scanning or GitHub requests. The widget appears when status is ready; shutdown still cancels pending remote requests.
- While a UI session is open, the existing monitor refreshes remote data at most once per 60 seconds. Branch/repository changes invalidate that cache. Status commands/tools share the same session cache; they do not force a network fetch within its lifetime.
- Missing CLI, authentication/access problems and network failures produce a concise remote-unavailable row, without hiding local results. Failed refreshes replace prior remote success, rather than presenting old cached results as a successful fetch. Requests use a 10-second per-process timeout, 15-second overall remote-fetch deadline and bounded output.
- Data stays in session memory. Shutdown/reload cancels pending requests and clears polling; nothing is written to the project or remote repository. `pipeline_run` remains local-only. No workflow creation, reruns, cancellation, filtering or remote configuration fields are added.

## Optional once-per-worktree preparation

`prepare` accepts an executable/argument array, optional project-relative `cwd` (default `.`), and `timeoutSeconds` (default 300). It has no freshness or automatic-run mode of its own.

- Before the first selected suite, run approved preparation under the same worktree lock. This applies to `all`, a single suite, command runs and automatic runs. Merely configuring or reading status never executes preparation.
- Persist success in the worktree-local cache's `prepare.json`. Once successful, skip it across sessions/reloads and all future runs in that worktree. Shared repository approvals do **not** share preparation success.
- Failure, timeout or cancellation blocks every selected suite and does not mark the worktree prepared. An explicit subsequent run retries preparation. Automatic runs do not repeatedly retry an unchanged failed preparation; changed source/config can make a later automatic attempt eligible after cooldown.
- **No invalidation:** manifest/lockfile edits, a different preparation command, deleted dependencies, or removing/readding `prepare` do not clear prior success. Dependency maintenance afterward is manual. A successful flag is scoped to the cached worktree path, not a Git branch name; reusing the same checkout path reuses its cache.
- Preparation is optional; existing configurations without it behave as before and retain their exact approval fingerprints. Adding/changing it requires native approval, even if preparation already succeeded.
- `pipeline_status` exposes `prepare` separately from suite outcomes; the widget adds a preparation row only when configured. A run that performs preparation includes its result before suite results. Failed preparation is a tool error with bounded output and a full log reference.
- Put installation here, and keep ordinary compilation/build as a suite: editing source should not reinstall dependencies. Preparation is not a general suite dependency graph; ordinary suite failures still do not stop later suites.

## Widget and automatic execution

```text
✓ unit 3m ago
✗ integration 12m ago
○ e2e never
```

```text
⚠ unit stale (✓ 3m ago)
› integration running 24s
```

- No local config (or no suites) means no local rows and no setup reminder; GitHub rows remain independent. With neither local nor remote rows, the widget is hidden. Invalid/unreadable local configuration hides the widget; `/pipeline status` exposes the error.
- The widget shows preparation/test state only, never approval messages. Previous stale passes are warning-colored, not green current-code results. Cancelled and timed-out runs remain distinct.
- Each suite appears on its own line. Native TUI rendering truncates entries to fit narrow terminal widths. RPC uses text-line widgets for clients such as Pi Chat. Theme changes use the current theme, not cached ANSI colors.
- While a UI session is open, poll source/config/shared results every 5 seconds (1 second while a suite is running), with immediate refreshes after file tools and persisted run-state changes. No recursive file watchers.
- Automation is opt-in per suite. It begins only after an `agent_settled` event, not on startup or reload. Wait for at least **2 seconds of quiet code** and a **60-second per-suite cooldown** after the previous result. Polls keep detecting edits while idle after that settled turn.
- Never rerun an unchanged tested snapshot just because its age expired or it failed/cancelled/timed out. Use a manual run to retry unchanged code. Source/config changes or changes detected during a run make it eligible after cooldown.
- Background runs **only refresh the widget**: no notifications, model messages or confirmation popups. Unapproved external commands stay paused until a manual run/configuration approval through the native popup. Busy worktree locks are retried quietly with a 5-second backoff.
- A new agent turn cancels this session's automatic run and disarms scheduling until that turn settles. Manual runs are not cancelled on new turns. `/pipeline cancel` also disarms scheduling until the next settled turn.
- Automatic selection, approval, source snapshots and persisted results are rechecked under the worktree lock, preventing duplicate execution across sessions. Source changes since the quiet snapshot defer execution.
- Shutdown/reload/session replacement cancels work, waits for cleanup and removes all polling/scheduling timers; late async reads cannot resurrect the widget. Non-UI/print sessions have no widget or automatic scheduler; approved manual tools remain usable.

## Approval and safety

Native confirmation covers the exact commands, directories, timeouts and automation settings. In Git repositories, approval applies to identical validated configurations across **all worktrees of that repository**, identified by the canonical Git common directory (`git rev-parse --git-common-dir`). Independent repositories/clones do not share approval, even with the same remote. Outside Git, approval remains scoped to the canonical project directory. The confirmation popup explicitly shows this scope.

Changes during review are refused and must be reviewed again. Configurations without an existing exact approval require confirmation before execution. Multiple approved configurations are retained, so approving a different configuration in another worktree does not invalidate earlier approvals. Without a UI channel, unapproved execution/configuration is refused; previously approved manual runs can still execute.

Legacy `approval.json` records remain valid only in their original worktree; they are not silently promoted to repository-wide trust. To share an existing configuration, approve it once via `pipeline_configure` (even unchanged), or approve a manual run in a worktree without a legacy approval. New worktrees then reuse that approval automatically. Automatic scheduling still requires `auto: "after-agent"` and a settled agent turn.

Approval covers configuration, not the contents of every executable, script, dependency or inherited environment variable. Only approve commands in projects you trust. This extension is not a sandbox and does not intercept arbitrary file-edit or bash tools. External configuration edits are checked before spawning, but cannot be made transactionally atomic with external writers.

A per-worktree filesystem lock prevents overlapping runs/configuration reviews across Pi sessions. A second request fails as busy rather than queuing. Cancellation from another Pi session is not supported.

## Results and freshness

Results, per-run logs and transient locks with owner PID live under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pipeline/<hash-of-canonical-worktree-path>/`, with private permissions. They remain isolated per worktree; a new worktree starts with never-run results and can execute independently of another worktree.

New approvals live under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pipeline/approvals/<scope-hash>/<configuration-fingerprint>.json`. The scope hash includes the scope kind and canonical Git common-directory path (or canonical project-directory path outside Git). Separate atomic records preserve simultaneous approvals from different worktrees. Legacy worktree-local `approval.json` files are still recognized locally.

Full logs are retained; returned output is bounded. Logs can contain secrets printed by tests; retention/pruning is not implemented yet.

Each suite result records outcome, start/end time, duration, exit code/signal, configuration and source fingerprints, and log path. Status distinguishes never-run, running, passed, failed, cancelled and timed-out. Any source change makes all completed suites stale. Changes detected between the start and end of a run also keep it stale, even if another run is fresh.

In git projects, source fingerprints use tracked and non-ignored untracked file contents, paths, symlink targets and file modes; deleted tracked files count. Outside git, source files are scanned recursively. Conventional generated directories (`node_modules`, `dist`, `build`, `coverage`, `.next`, `__pycache__`, `.venv`, `test-results`, `playwright-report`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.turbo`) plus git metadata, `.DS_Store` and the pipeline cache directory (even if placed inside the project) are excluded. Pipeline config is fingerprinted separately. Changes reverted between fingerprint samples cannot be detected; ignored source and files behind symlinks are not scanned.

Shutdown/reload aborts this session's active runs and waits for cleanup. On macOS/Linux, cancellation and timeout terminate the process group and escalate to SIGKILL; Windows uses `taskkill /T /F` (not yet tested on Windows). Processes that deliberately escape the group/tree cannot be contained.

An abrupt crash can leave a lock and a last result marked running. Inspect the lock's `owner.json`, ensure no test process remains, then remove that cache's `lock` directory manually. The extension never steals a possibly live lock automatically; the next completed run replaces the interrupted result.

## Verification

```sh
node --test tests/pipeline*.test.cjs
npm test
npm run typecheck
pi --no-extensions -e ./pipeline.ts --help
```

See [requirements and implementation slices](REQUIREMENTS.md).
