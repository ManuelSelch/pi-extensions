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
| [projects/index.ts](projects/index.ts) | `/projects` — virtual repository collections, pipeline status and native `/projects browse` menus. See [usage](docs/projects/README.md). |
| [quiz/index.ts](quiz/index.ts) | `quiz` — one multiple-choice check and written reasoning, using native select/editor dialogs. See [usage](docs/quiz/README.md). |
| [readonly-mode/index.ts](readonly-mode/index.ts) | `/readonly` — block write/edit tools and destructive bash. |
| [todo/index.ts](todo/index.ts) | `todo`, `/todos` — session task tracking. |
| [workflow/index.ts](workflow/index.ts) | `/workflow`, `/workflow global` — select enabled mock/plan/design/commit prompts and native skills. See [usage](docs/workflow/README.md). |

## Disabled extensions

The following modules now have normal folder entry points but remain disabled by
native agent settings: [agentic-flow](agentic-flow/index.ts),
[claude-auth](claude-auth/index.ts), [dot-clean](dot-clean/index.ts),
[pdf](pdf/index.ts), [session-cleanup](session-cleanup/index.ts), and
[thinking-toggle](thinking-toggle/index.ts). `/extensions` lists them as disabled;
their current manager defaults are false. There are no `.disabled` source files.

Disablement is local configuration, not a property of the source folder. Before
installing these modules into another agent directory, merge these exclusions
into that agent's `settings.json` (preserve any existing entries):

```json
{
  "extensions": [
    "-extensions/agentic-flow/index.ts",
    "-extensions/claude-auth/index.ts",
    "-extensions/dot-clean/index.ts",
    "-extensions/pdf/index.ts",
    "-extensions/session-cleanup/index.ts",
    "-extensions/thinking-toggle/index.ts"
  ]
}
```

The authorized one-time migration backs up and updates the user's settings and
manager defaults before exposing these entry points. No runtime settings
migration is added. Existing implementations are preserved; these disabled
modules are excluded from the active-source typecheck and are not certified for
intentional reactivation. Absent/external extensions such as `workspace` remain
outside this repository's migration.

## Open the current directory in an app

`/open <app>` reads `~/.pi/agent/pi-open.json`. Copy the
[example](pi-open/pi-open.example.json) there and customize it. The JSON `apps`
object maps names to an executable `command` and `args` array. `{cwd}` is
substituted within each argument; the process also starts in that directory. The
special `{primaryRepo}` placeholder resolves to the primary worktree root (the
first `git worktree list` entry) and is useful for a `code-primary` app when the
current session is on a feature branch. No shell is used. Configuration
locations have not changed.

The example targets macOS: Finder and Apple Terminal use `open`; VS Code uses
`code`, which must be on `PATH`. The included `code-primary` app opens the main
repo instead of the current worktree branch. Reload/restart Pi after changing the
app list to refresh completion.

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
npm test -- projects           # projects, pipeline status and native browse suites
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
  six explicitly listed disabled module folders in `tsconfig.json`. Review that
  list and compatibility before intentionally reactivating a module. Dependencies
  are shared; extensions are not separate packages.
- Keep SDK/TUI dependency versions compatible with the installed Pi. To check
  native discovery against another installed SDK, set `PI_MIGRATION_SDK_ENTRY`
  to its `dist/index.js` path when running `npm test -- scripts`.

Direct loading is an additional smoke test, not proof of automatic discovery:

```bash
pi --no-extensions -e ./pi-open/index.ts --help
```

`guardrails.json` is ignored local package state. External loaders/symlinks not
tracked here are outside this migration.
