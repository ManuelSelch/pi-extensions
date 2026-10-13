# Local pipeline extension

Provides native-confirmed configuration, manual execution, persisted results, a compact test-status widget and opt-in after-agent scheduling.

## Usage

Reload Pi after installing `pipeline.ts`. Ask the agent to inspect your test scripts and call `pipeline_configure`. The tool takes a **complete replacement configuration**: include every suite you want to retain; omitted suites are removed. Nothing is written until you confirm the before/after popup. Saving does not immediately execute tests; approved opt-in suites can run after the agent settles.

```json
{
  "version": 1,
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
- `pipeline_status({})`: inspect configuration and latest outcomes/freshness without execution or a popup.
- `/pipeline` or `/pipeline status`: show a concise outcome/freshness line per suite; no commands, fingerprints or log paths. The agent's `pipeline_status` tool retains detailed data.
- `/pipeline run unit` or `/pipeline run all`: start a background run, keeping commands usable.
- `/pipeline logs unit`: show the last 16 KiB and full log path.
- `/pipeline cancel`: cancel this session's run and pause automation until the next settled agent turn.

Defaults: `cwd: "."`, `timeoutSeconds: 300`, `staleAfterMinutes: 30`, `auto: "manual"`. Set `auto: "after-agent"` only on suites you explicitly want run in the background; integration/e2e are manual unless opted in. Use one-shot commands, never watch mode. Arguments are passed literally, without shell interpolation; put complex workflows in a project script. Working directories must exist and resolve inside the project, including through symlinks.

## Widget and automatic execution

```text
✓ unit 3m ago
✗ integration 12m ago
○ e2e never
```

```text
⚠ unit stale (✓ 3m ago)
⟳ integration running 24s
```

- No config (or no suites) means no widget and no setup reminder. Invalid/unreadable configuration hides the widget; `/pipeline status` exposes the error.
- The widget shows test state only, never approval messages. Previous stale passes are warning-colored, not green current-code results. Cancelled and timed-out runs remain distinct.
- Each suite appears on its own line. Native TUI rendering truncates entries to fit narrow terminal widths. RPC uses text-line widgets for clients such as Pi Chat. Theme changes use the current theme, not cached ANSI colors.
- While a UI session is open, poll source/config/shared results every 5 seconds (1 second while a suite is running), with immediate refreshes after file tools and persisted run-state changes. No recursive file watchers.
- Automation is opt-in per suite. It begins only after an `agent_settled` event, not on startup or reload. Wait for at least **2 seconds of quiet code** and a **60-second per-suite cooldown** after the previous result. Polls keep detecting edits while idle after that settled turn.
- Never rerun an unchanged tested snapshot just because its age expired or it failed/cancelled/timed out. Use a manual run to retry unchanged code. Source/config changes or changes detected during a run make it eligible after cooldown.
- Background runs **only refresh the widget**: no notifications, model messages or confirmation popups. Unapproved external commands stay paused until a manual run/configuration approval through the native popup. Busy worktree locks are retried quietly with a 5-second backoff.
- A new agent turn cancels this session's automatic run and disarms scheduling until that turn settles. Manual runs are not cancelled on new turns. `/pipeline cancel` also disarms scheduling until the next settled turn.
- Automatic selection, approval, source snapshots and persisted results are rechecked under the worktree lock, preventing duplicate execution across sessions. Source changes since the quiet snapshot defer execution.
- Shutdown/reload/session replacement cancels work, waits for cleanup and removes all polling/scheduling timers; late async reads cannot resurrect the widget. Non-UI/print sessions have no widget or automatic scheduler; approved manual tools remain usable.

## Approval and safety

Native confirmation covers the exact commands, directories, timeouts and automation settings. Changes during review are refused and must be reviewed again. External configuration changes require approval before execution. Without a UI channel, unapproved execution/configuration is refused; previously approved manual runs can still execute.

Approval covers configuration, not the contents of every executable, script, dependency or inherited environment variable. Only approve commands in projects you trust. This extension is not a sandbox and does not intercept arbitrary file-edit or bash tools. External configuration edits are checked before spawning, but cannot be made transactionally atomic with external writers.

A per-worktree filesystem lock prevents overlapping runs/configuration reviews across Pi sessions. A second request fails as busy rather than queuing. Cancellation from another Pi session is not supported.

## Results and freshness

State lives under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pipeline/<hash-of-canonical-worktree-path>/`, with private permissions. It contains approval, latest results, per-run logs and a transient lock with owner PID. Full logs are retained; returned output is bounded. Logs can contain secrets printed by tests; retention/pruning is not implemented yet.

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
