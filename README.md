# Pi extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono), loaded
from `~/.pi/agent/extensions`. This directory *is* the repo — Pi loads every `*.ts` here
directly, so there is no build step.

| File | Commands / behaviour |
|---|---|
| `claude-auth.ts` | `/claude-login` — refreshes the Claude Code OAuth token doppelclaude depends on; also refreshes proactively before a doppelclaude turn. |
| `codex-accounts.ts` | `/codex-accounts`, `/codex-account-add`, `/codex-account-remove` — registers extra `openai-codex-<id>` providers so several ChatGPT subscriptions can be logged in at once (`~/.pi/agent/codex-accounts.json`). |
| `manual-updates.ts` | `/update` — runs `pi update --all` and restarts the current session. |
| `model-filter.ts` | `/models-filter`, `/models-add`, `/models-remove` — edits the `enabledModels` filter in `settings.json`, including models whose provider is not logged in yet. |
| `minimal-tui.ts` | No command. Suppresses the startup package banner and hides footer token/cost stats. |
| `pdf.ts` | `/pdf <file.pdf>` — converts to `.txt` via `pdftotext`. |
| `readonly-mode.ts` | `/readonly` — blocks `write`/`edit` and destructive bash. |
| `session-cleanup.ts` | `/session-cleanup-now`, `/session-cleanup-dry` — trashes old *unnamed* sessions (`PI_SESSION_CLEANUP_DAYS`, default 3). |
| `thinking-toggle.ts` | `/thinking-toggle` — switches between `minimal` and `high`. |

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
