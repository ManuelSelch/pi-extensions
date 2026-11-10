# Pi widget and automatic execution

[Pipeline overview](README.md)

## Widget and automatic execution


```text
✗ Local 1/3 · 3m ago
  ✗ integration 12m ago
  ○ e2e never
```

```text
◐ Local 1/2 · just now
  › integration running 24s
```

- No local config (or no suites) means no local rows and no setup reminder; GitHub rows remain independent. With neither local nor remote rows, the widget is hidden. Invalid/unreadable local configuration hides the widget; `/pipeline status` exposes the error.
- Local status renders as soon as its filesystem and fingerprint scan completes, without waiting for GitHub. The remote section appears or updates independently; a remote failure leaves local results visible. While a remote refresh is pending, its previous session result remains visible. A remote-only widget stays hidden until the first remote response.
- The widget shows the latest preparation/test outcomes, never approval messages. Source edits do not change the displayed outcome. Cancelled and timed-out runs remain distinct.
- Passing suites collapse into `✓ Local 5/5 · 2m ago`; the age is the latest suite result, never preparation. Running, failed, cancelled, timed-out or never-run suites and jobs get detail rows, in declaration order. `/pipeline status` stays fully expanded. Native TUI rendering truncates entries to fit narrow terminal widths. RPC uses text-line widgets for clients such as Pi Chat. Theme changes use the current theme, not cached ANSI colors.
- While a UI session is open, poll source/config/shared results every 5 seconds (1 second while a suite is running), with immediate refreshes after file tools and persisted run-state changes. No recursive file watchers.
- Automation is opt-in per command-only suite or job (using its effective inherited or overridden setting). It begins only after an `agent_settled` event, not on startup or reload. Wait for at least **2 seconds of quiet code** and a **60-second per-command cooldown** after the previous result. Polls keep detecting edits while idle after that settled turn.
- Never rerun an unchanged tested snapshot just because it is old or it failed/cancelled/timed out. Use a manual run to retry unchanged code. Source/config changes or changes detected during a run make it eligible after cooldown.
- Background runs **only refresh the widget**: no notifications, model messages or confirmation popups. Unapproved external commands stay paused until a manual run/configuration approval through the native popup. Busy worktree locks are retried quietly with a 5-second backoff.
- A new agent turn cancels this session's automatic run and disarms scheduling until that turn settles. Manual runs are not cancelled on new turns. `/pipeline cancel` also disarms scheduling until the next settled turn.
- Automatic selection, approval, source snapshots and persisted results are rechecked under the worktree lock, preventing duplicate execution across sessions. Source changes since the quiet snapshot defer execution.
- Shutdown/reload/session replacement cancels work, waits for cleanup and removes all polling/scheduling timers; late async reads cannot resurrect the widget. Non-UI/print sessions have no widget or automatic scheduler; approved manual tools remain usable.
