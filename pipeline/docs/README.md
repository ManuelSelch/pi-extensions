# Pipeline extension

Run approved local test suites and inspect their results alongside GitHub Actions. Pi provides a widget and optional after-agent runs; Claude Code provides MCP tools and a status widget.

## Get started

Ask Pi or Claude to inspect the project and configure its pipeline. Configuration is stored in `.pi/pipeline.yaml` at the Git worktree root (or the current directory outside Git). Configuration is a **complete replacement**: retain every suite and `prepare` you want to keep. Changes require approval and do not immediately run tests.

```yaml
prepare:
  command: [npm, ci]
  timeoutSeconds: 300

suites:
  unit:
    command: [npm, run, test:unit]
    timeoutSeconds: 120
    auto: after-agent
  integration:
    command: [npm, run, test:integration]
    timeoutSeconds: 600
    auto: manual
```

`prepare` is optional and runs once successfully per worktree before selected suites. Automatic runs are opt-in and currently Pi-only. See [configuration and safety](configuration.md) for defaults, approval scope, automatic scheduling and preparation limits.

## Tools and Pi commands

- `pipeline_configure`: review and save a complete configuration.
- `pipeline_run`: run a named suite or all suites; non-passing results are errors.
- `pipeline_status`: read local results and GitHub Actions status without running tests.
- `pipeline_wait`: wait for GitHub Actions on an exact commit after a push.
- `/pipeline status`, `/pipeline run [suite|all]`, `/pipeline cancel`: Pi commands for status and background runs.

## Claude Code

```bash
cd ~/.pi/agent/extensions
npm ci
claude plugin marketplace add ~/.pi/agent/extensions
claude plugin install pipeline@pi-extensions --scope user
```

For an existing installation, run `claude plugin update pipeline@pi-extensions` and restart Claude Code. See [Claude Code integration](claude.md) for the local checkout requirement, shared approvals and widget behavior.

## Further details

- [Configuration, preparation, approvals and scheduling](configuration.md)
- [GitHub Actions status and commit-pinned waiting](github.md)
- [Pi widget and automatic execution](automation.md)
- [Claude Code integration](claude.md)
- [TypeScript status API](status-api.md)
- [Requirements and implementation slices](REQUIREMENTS.md)

The shared logic is in `pipeline/core/`, the Pi adapter in `pipeline/pi/`, and the Claude MCP adapter in `pipeline/claude/`. `pipeline/index.ts` is the Pi loader entry point.

## Verification

```sh
npm test -- pipeline
npm test
npm run typecheck
pi --no-extensions -e ./pipeline/index.ts --help
claude plugin test ./pipeline
```
