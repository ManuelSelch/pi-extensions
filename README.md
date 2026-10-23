# Pi extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono), loaded
from `~/.pi/agent/extensions`. This directory *is* the repo — Pi loads every `*.ts` here
directly, so there is no build step.

| File | Commands / behaviour |
|---|---|
| `claude-auth.ts` | `/claude-login` — refreshes the Claude Code OAuth token doppelclaude depends on; also refreshes proactively before a doppelclaude turn. |
| `codex-accounts.ts` | `/codex-account list\|add\|remove` — registers extra `openai-codex-<id>` providers so several ChatGPT subscriptions can be logged in at once (`~/.pi/agent/codex-accounts.json`). |
| `manual-updates.ts` | `/update` — runs `pi update --all` and restarts the current session. |
| `model-filter.ts` | `/models-filter`, `/models-add`, `/models-remove` — edits the `enabledModels` filter in `settings.json`, including models whose provider is not logged in yet. |
| `minimal-tui.ts` | No command. Suppresses the startup package banner and hides footer token/cost stats. |
| `pdf.ts` | `/pdf <file.pdf>` — converts to `.txt` via `pdftotext`. |
| `pi-open.ts` | `/open <app>` — opens the current directory using an app configured in `~/.pi/agent/pi-open.json`. |
| `pipeline.ts` | `/pipeline` and `pipeline_configure` / `pipeline_run` / `pipeline_status` — approved test commands, compact status widget, manual/opt-in automatic runs, logs and persisted outcomes. See [pipeline usage](docs/pipeline/README.md). |
| `projects.ts` | `/projects` — virtual project collections, current-repository membership and display names. See [projects usage](docs/projects/README.md). |
| `readonly-mode.ts` | `/readonly` — blocks `write`/`edit` and destructive bash. |
| `workspace.ts` | `/workspace add\|list\|remove` — persistent multi-root folder links with per-run workspace context. See [workspace usage](docs/workspace/README.md). |
| `session-cleanup.ts` | `/session-cleanup-now`, `/session-cleanup-dry` — trashes every old session except the active session (`PI_SESSION_CLEANUP_DAYS`, default 3). |
| `thinking-toggle.ts` | `/thinking-toggle` — switches between `minimal` and `high`. |

## Open the current directory in an app

The `pi-open.ts` extension registers `/open <app>`. It reads the supported app list from `~/.pi/agent/pi-open.json`; app names and launch commands are not built into the extension. Copy [`pi-open.example.json`](pi-open.example.json) to that location and customize it. The JSON `apps` object maps completion/command names to an executable and an `args` array. Use `{cwd}` wherever the current Pi working directory should appear; it is substituted as one argv element, and the process also starts with that directory as its cwd. No shell is used.

The example entries target macOS: Finder and Apple Terminal use the `open` utility; VS Code uses the `code` CLI, which must be installed and available on `PATH`. Add or remove apps in the JSON file; restart Pi (or reload extensions) to ensure completion reflects changes.

## Development

```bash
npm install          # types only; Pi itself loads the .ts files via jiti
npm run typecheck    # tsc --noEmit
```

`node_modules/` exists purely so the editor can resolve
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. Keep the dependency
versions in step with the installed Pi (`pi --version`), otherwise the types describe a
different API than the runtime.

Smoke-test a single extension without loading the others:

```bash
pi --no-extensions -e ./claude-auth.ts --help
```

## Not tracked

- `guardrails.json` — local state of the `pi-guardrails` package (machine paths, onboarding timestamps).
- `pi-chat.ts` — symlink into `~/.pi/agent/git/pi-chat`, which is its own repo.
