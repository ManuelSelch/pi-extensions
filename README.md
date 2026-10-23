# Pi extensions

Personal extensions for the [Pi coding agent](https://pi.dev), loaded from
`~/.pi/agent/extensions`. This directory is the repository. Pi loads TypeScript
entry points directly through jiti; there is no build step.

## Active extensions

| Entry point | Commands / behaviour |
|---|---|
| [agent-defaults/index.ts](agent-defaults/index.ts) | `/defaults` — edit global model, provider, thinking and enabled-model defaults. |
| [ask-user/index.ts](ask-user/index.ts) | `ask_user` — interactive questions and text editing. |
| [calendar/index.ts](calendar/index.ts) | `calendar_list`, `calendar_read` — sync and read configured calendars using vdirsyncer/khal. |
| [context-badge/index.ts](context-badge/index.ts) | Show context-window usage as a status label. |
| [extension-manager/index.ts](extension-manager/index.ts) | `/extensions` — manage local native exclusions and package enablement; save and restore defaults. |
| [git-status/index.ts](git-status/index.ts) | Show repository/worktree Git status. |
| [manual-updates/index.ts](manual-updates/index.ts) | `/update` — run `pi update --all`; restart Pi manually afterward. |
| [minimal-tui/index.ts](minimal-tui/index.ts) | Suppress startup package notifications and hide footer token/cost stats. |
| [model-filter/index.ts](model-filter/index.ts) | `/models-filter`, `/models-add`, `/models-remove` — edit the enabled-model filter. |
| [pi-open/index.ts](pi-open/index.ts) | `/open <app>` — open the current directory in a configured app. |
| [pipeline/index.ts](pipeline/index.ts) | `/pipeline`, `pipeline_configure`, `pipeline_run`, `pipeline_status` — approved local tests and GitHub Actions status. See [usage](docs/pipeline/README.md). |
| [preview/index.ts](preview/index.ts) | `/preview`, `preview_start`, `preview_manage` — managed development previews. |
| [projects.ts](projects.ts) | `/projects` — virtual repository collections and pipeline status. See [usage](docs/projects/README.md). Its existing loader and [projects/](projects/) tree are deliberately unchanged. |
| [readonly-mode/index.ts](readonly-mode/index.ts) | `/readonly` — block write/edit tools and destructive bash. |
| [todo/index.ts](todo/index.ts) | `todo`, `/todos` — session task tracking. |

The six tracked files `agentic-flow.ts.disabled`, `claude-auth.ts.disabled`,
`dot-clean.ts.disabled`, `pdf.ts.disabled`, `session-cleanup.ts.disabled`, and
`thinking-toggle.ts.disabled` remain untouched and disabled. They are not native
entry points and are not listed by `/extensions`. No personal settings are changed
by this refactor. Absent/external extensions such as `workspace` are not part of
this repository's migration.

## Open the current directory in an app

`/open <app>` reads `~/.pi/agent/pi-open.json`. Copy the
[example](pi-open/pi-open.example.json) there and customize it. The JSON `apps`
object maps names to an executable `command` and `args` array. `{cwd}` is
substituted within each argument; the process also starts in that directory. No
shell is used. Configuration locations have not changed.

The example targets macOS: Finder and Apple Terminal use `open`; VS Code uses
`code`, which must be on `PATH`. Reload/restart Pi after changing the app list to
refresh completion.

## Enable or disable extensions

`/extensions` lists local files and immediate folders containing `index.ts` or
`index.js`, with separate user/project identities. Disabling writes an exact
`-path` exclusion into the owning scope's `settings.json`; it never renames files.
For example, in the agent's settings file:

```json
{
  "extensions": ["-extensions/pipeline/index.ts"]
}
```

Paths are relative to the settings directory (the agent directory for user
settings, or the project's `.pi` directory). Enabling removes equivalent exact
exclusions and may add an exact `+path` inclusion to override a broader glob.
Exact exclusions take precedence. Conflicting exclusions in another scope are
reported, not silently rewritten. Unrelated settings are preserved; malformed
settings are not overwritten. Pi's built-in `pi config` is an alternative.

Apply changes with `/reload` or restart. Defaults and seen-state live in
`extension-manager.json` inside Pi's configured agent directory, keyed by current
scope and entry path. Old root paths have no compatibility shims or legacy-key
mapping. Package toggles manage package declarations separately.

The default-for-new policy cannot prevent first-load execution: native exclusions
must already exist before loading when preventing execution matters. The default
`enable` policy respects existing explicit exclusions.

## Development and authoring

```bash
npm ci                         # install shared development dependencies
npm run typecheck              # all active entry points and nested production source
npm test                       # all module-local test suites
npm test -- pipeline           # focused module, at any test nesting depth
npm test -- projects           # existing projects suites, unchanged
npm test -- extension-manager
npm test -- scripts            # tooling and isolated normal Pi discovery checks
```

- Each migrated extension owns `<name>/index.ts`, implementation files, and
  `<name>/tests/`. Small extensions may keep their implementation in `index.ts`;
  larger ones may retain internal source/layer folders. Do not add root shims.
- Pi discovers only immediate folder entry points, not nested source or tests.
  Shared package tooling lives under `scripts/`; there is no global `tests/`.
- The test runner recursively discovers `*.test.cjs` under each module's `tests/`,
  skips dependencies/helpers, and checks the suite identity inventory in
  [scripts/test-inventory.json](scripts/test-inventory.json). Update that inventory
  when intentionally adding/removing suites. Identities are relative to `tests/`
  so relocating a suite with its extension preserves the migration check.
- Typechecking excludes tests, dependencies, mockups, external loaders, and the
  disabled files. Dependencies are shared; extensions are not separate packages.
- Keep SDK/TUI dependency versions compatible with the installed Pi. To check
  native discovery against another installed SDK, set `PI_MIGRATION_SDK_ENTRY`
  to its `dist/index.js` path when running `npm test -- scripts`.

Direct loading is an additional smoke test, not proof of automatic discovery:

```bash
pi --no-extensions -e ./pi-open/index.ts --help
```

`guardrails.json` is ignored local package state. External loaders/symlinks not
tracked here are outside this migration.
