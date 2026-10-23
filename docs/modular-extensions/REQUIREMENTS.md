# Modular Extensions — Requirements

## Goal
Give each repository-owned extension one folder containing its entry point, implementation, tests, and test helpers. Remove the global shared `tests/` directory without changing extension behavior or requiring a build step.

## Requirements
- **R1** — Every repository-owned extension lives under a root-level folder named after the extension. Its Pi entry point is `<name>/index.ts`; implementation may live directly there for small extensions or under `<name>/src/` for larger ones. Tests and test-only helpers live under `<name>/tests/`. Do not impose extra architectural layers on simple extensions.
- **R2** — Migrate all 15 active root TypeScript extensions and preserve all six tracked disabled extensions as disabled modules. Preserve existing commands, tools, event handling, configuration/state locations, and runtime behavior except for the path-aware management changes required by R5. Do not activate disabled code or add unrelated features.
- **R3** — Move all 14 test files and the pipeline helper from the global `tests/` into their owning modules. Retain all four existing `projects/tests/` test files and their helpers. The final repository has no global `tests/` folder. Existing source-transpilation mocks, relative imports, real-loader tests, fixtures, and cleanup behavior continue to work.
- **R4** — Pi's normal resource discovery loads each enabled module exactly once and does not load tests, helpers, nested source files, or disabled modules as extensions. Verify the normal resource/package resolution path as well as direct entry-point loading; a successful `-e` smoke test alone is insufficient. Preserve the no-build TypeScript workflow. Entry paths may change from `<name>.ts` to `<name>/index.ts`; do not retain root compatibility shims or provide a manual settings migration (Q1 resolved).
- **R5** — `/extensions` discovers and toggles folder-based modules as well as existing file-based and package extensions. Preserve saved defaults and seen-state identities across this repository's file-to-folder migration, protect the manager itself from disabling, and keep disabled modules discoverable by the manager but not by Pi. Cover these behaviors with module-local regression tests before moving the manager. Do not rewrite real user settings during automated tests.
- **R6** — `npm test` discovers module-local `*.test.cjs` files at any nesting depth, including `projects/tests/Domain/` and `projects/tests/Integration/`, without maintaining a per-extension file list. During migration it also runs remaining legacy tests. Helpers and dependencies are not treated as tests. Preserve the 18 existing test-file inventory and test assertions; add checks that detect skipped suites and restore focused per-module test commands.
- **R7** — `npm run typecheck` covers all active module entry points and production source, including nested files previously outside `tsconfig.json`'s root-only include. Exclude disabled source, dependencies, mockups, and unrelated external loaders. Fix or explicitly surface newly exposed baseline errors rather than narrowing coverage to hide them.
- **R8** — Update the repository README and affected current usage documentation with module paths, focused test commands, and the authoring convention. Keep shared package tooling and feature documents in place; do not silently relocate legacy requirements/design documents. Preserve existing `projects/src/` layering. Move extension-specific examples with their owner where practical and update links; do not change runtime configuration locations.
- **R9** — Finish with the complete test suite, typecheck, isolated discovery/registration checks, and an ownership/layout check passing. Review the final diff for accidental behavior changes and confirm no duplicate old/new entry points remain. Never modify extensions outside this repository or personal Pi configuration automatically.

## Assumptions
- This is a structural refactor, not a conversion into separately published npm packages or a redesign of each extension's internals. One shared package manifest, lockfile, and test/typecheck toolchain remain.
- Installed Pi documentation supports discovery of immediate subdirectories with `index.ts` or `index.js`. Confirm behavior against the actual runtime used for acceptance, because repository SDK dependencies and the installed CLI may differ.
- Proposed disabled layout: `<name>/index.ts.disabled`, with no active `index.ts`, `index.js`, or manifest entry. The extension manager toggles the entry point rather than renaming the folder; validate this approach in S2.
- The active migration inventory is `agent-defaults`, `ask-user`, `calendar`, `context-badge`, `extension-manager`, `git-status`, `manual-updates`, `minimal-tui`, `model-filter`, `pi-open`, `pipeline`, `preview`, `projects`, `readonly-mode`, and `todo`. Disabled modules are `agentic-flow`, `claude-auth`, `dot-clean`, `pdf`, `session-cleanup`, and `thinking-toggle`.
- Documentation mentions some absent extensions such as `workspace`; these are not migration targets. External shims or symlinks not tracked here are outside scope.

## Implementation Plan
### S1 — Establish migration-safe tooling
Description: Implement R6 and prepare R7. Record the existing 18-test-file inventory and baseline test/typecheck results. Add test discovery supporting both legacy and module-local locations at arbitrary depth, plus focused module execution. Extend typechecking to active nested production source without checking disabled code or mockups. Verify that all existing suites still execute and identify any newly exposed baseline issues before moving files.

### S2 — Make extension management folder-aware
Description: Implement R4 and R5 prerequisites with isolated fixtures containing active/disabled files, active/disabled folders, helpers, and packages. Add regression coverage under `extension-manager/tests/` for inventory, toggling, default/seen identity continuity, and self-protection. Verify the disabled-entry convention against Pi discovery and the normal resource resolver. Keep existing file handling operational so later slices can migrate incrementally. Remove legacy entry paths during module migration without compatibility shims, as confirmed in Q1.

### S3 — Pilot self-contained modules
Description: After S1–S2, migrate `pi-open` and `projects` to folder entry points. Move the opener tests and example into its module, preserve the existing projects source/test hierarchy, and update affected paths and links. Verify focused tests, complete suite discovery, typecheck, and actual loader registration without duplicate commands. This proves the convention for both simple and layered extensions.

### S4 — Consolidate pipeline source and tests
Description: After S3, move the pipeline entry point and its three supporting source files into the pipeline module, with its eight test files and helper under `pipeline/tests/`. Repair helper resolution and real-loader integration paths without changing approval, preparation, monitoring, GitHub, or widget behavior. Update pipeline usage commands and verify focused tests, full suite, typecheck, and isolated registration.

### S5 — Migrate remaining extensions
Description: After S4, migrate the remaining active extensions, including the manager, in small verified batches; move each existing test to its owner. Move the six disabled files into disabled module entry points without enabling or rewriting their code. Preserve stored manager identities and state/configuration paths. Run focused tests where present, complete test discovery, active-source typecheck, and discovery/registration checks for each batch; do not require unrelated new behavior tests for previously untested extensions.

### S6 — Enforce the final layout and document it
Description: After S5, implement final R8–R9 checks: remove the now-empty global tests directory, retire transitional legacy test discovery, verify every tracked extension and test has an owner, and detect duplicate entry points or stray root tests. Refresh the README's actual active/disabled inventory and authoring/testing instructions without rewriting historical design decisions. Verify the final test-file inventory, complete suite, typecheck, isolated normal Pi discovery, disabled exclusion, and extension-manager compatibility. Do not add a manual settings migration or edit personal settings; old explicit entry paths need not remain compatible (Q1).

## Open Questions
- **Q1 — Resolved** — Entry paths may change from `extensions/pipeline.ts` to `extensions/pipeline/index.ts`. The repository has only one user; no backward-compatible root shims or manual settings migration are required.
