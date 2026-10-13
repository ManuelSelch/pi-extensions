# Local pipeline extension

Slices 1–2 provide configuration with native Pi confirmation, a manual runner, persisted results and three agent tools. No widget or automatic scheduling yet.

## Usage

Reload Pi after installing `pipeline.ts`. Ask the agent to inspect your test scripts and call `pipeline_configure`. The tool takes a **complete replacement configuration**: include every suite you want to retain; omitted suites are removed. Nothing is written until you confirm the before/after popup, and saving never executes tests.

```json
{
  "version": 1,
  "suites": {
    "unit": {
      "command": ["npm", "run", "test:unit"],
      "timeoutSeconds": 120
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

Configuration is stored in `.pi/pipeline.json` at the git worktree root, or Pi's cwd outside git. Starting Pi in a git subdirectory still uses the worktree root. Commit the configuration if you want to share it; approvals and results are never stored in that file.

- `pipeline_configure({config: ...})`: validate and save after approval.
- `pipeline_run({suite: "unit"})`: wait for a suite's results; omit suite or use `all` to run all suites serially. Non-passing results are tool errors carrying outcome/output/log paths. Aborting the tool cancels execution.
- `pipeline_status({})`: inspect configuration and latest outcomes/freshness without execution or a popup.
- `/pipeline` or `/pipeline status`: show details.
- `/pipeline run unit` or `/pipeline run all`: start a background run, keeping commands usable.
- `/pipeline logs unit`: show the last 16 KiB and full log path.
- `/pipeline cancel`: cancel the run owned by the current Pi session.

Defaults: `cwd: "."`, `timeoutSeconds: 300`, `staleAfterMinutes: 30`, `auto: "manual"`. `after-agent` can be saved but is **not scheduled until slice 4**. Use one-shot commands, never watch mode. Arguments are passed literally, without shell interpolation; put complex workflows in a project script. Working directories must exist and resolve inside the project, including through symlinks.

## Approval and safety

Native confirmation covers the exact commands, directories, timeouts and automation settings. Changes during review are refused and must be reviewed again. External configuration changes require approval before execution. Without a UI channel, unapproved execution/configuration is refused; previously approved manual runs can still execute.

Approval covers configuration, not the contents of every executable, script, dependency or inherited environment variable. Only approve commands in projects you trust. This extension is not a sandbox and does not intercept arbitrary file-edit or bash tools. External configuration edits are checked before spawning, but cannot be made transactionally atomic with external writers.

A per-worktree filesystem lock prevents overlapping runs/configuration reviews across Pi sessions. A second request fails as busy rather than queuing. Cancellation from another Pi session is not supported.

## Results and freshness

State lives under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pipeline/<hash-of-canonical-worktree-path>/`, with private permissions. It contains approval, latest results, per-run logs and a transient lock with owner PID. Full logs are retained; returned output is bounded. Logs can contain secrets printed by tests; retention/pruning is not implemented yet.

Each suite result records outcome, start/end time, duration, exit code/signal, configuration and source fingerprints, and log path. Status distinguishes never-run, running, passed, failed, cancelled and timed-out. Any source change makes all completed suites stale. Changes detected between the start and end of a run also keep it stale, even if another run is fresh.

In git projects, source fingerprints use tracked and non-ignored untracked file contents, paths, symlink targets and file modes; deleted tracked files count. Outside git, source files are scanned recursively. Conventional generated directories (`node_modules`, `dist`, `build`, `coverage`, `.next`, `__pycache__`, `.venv`) plus git metadata and `.DS_Store` are excluded. Pipeline config is fingerprinted separately. Changes reverted between fingerprint samples cannot be detected; ignored source and files behind symlinks are not scanned.

Shutdown/reload aborts this session's active runs and waits for cleanup. On macOS/Linux, cancellation and timeout terminate the process group and escalate to SIGKILL; Windows uses `taskkill /T /F` (not yet tested on Windows). Processes that deliberately escape the group/tree cannot be contained.

An abrupt crash can leave a lock and a last result marked running. Inspect the lock's `owner.json`, ensure no test process remains, then remove that cache's `lock` directory manually. The extension never steals a possibly live lock automatically; the next completed run replaces the interrupted result.

## Verification

```sh
node --test tests/pipeline.test.cjs
npm test
npm run typecheck
pi --no-extensions -e ./pipeline.ts --help
```

See [requirements and remaining slices](REQUIREMENTS.md).
