# Modular Extension Migration — Design

## Proposed Design
- Migrate every active repository-owned extension except `projects`. Leave both `projects.ts` and the entire `projects/` tree unchanged. Begin with migration-safe tooling, then move extensions in small verified batches. The native settings manager prerequisite is already implemented; retain its separate design and tests.
- Add a repository test runner under `scripts/` that recursively finds `*.test.cjs` inside module-local `tests/` directories and the transitional root `tests/`. Sort the inventory, ignore dependencies and non-test helpers, and invoke Node's test runner without shell glob expansion. Support focused execution by module name.
- Record the current 23 test-file inventory as a migration regression check. Compare discovered files with the inventory so both missing suites and accidentally unregistered new suites are visible. Preserve existing assertions.
- Extend TypeScript coverage to nested active production files while excluding dependencies, tests, mockups, and external loaders. The existing `.ts.disabled` files remain untouched. Surface newly covered errors and fix only compatibility/type issues needed for this coverage.
- Move each in-scope active root entry to `<name>/index.ts` and its tests/helpers into `<name>/tests/`. Keep existing module source organization, updating relative imports and test-loader paths. Move the opener example into `pi-open/`. Remove migrated root entries without compatibility shims. Preserve published pipeline API paths used by projects so projects needs no changes.

## Decisions & Trade-offs
- Keep shared package tooling and the no-build workflow. Use native immediate-folder discovery, not a custom runtime loader or new dependencies.
- Preserve runtime configuration locations and all extension behavior. Existing simple code stays simple; no internal redesign is required.
- Keep all six disabled files untouched and disabled, as requested. Do not edit personal settings or expose those files as discoverable folder entries.
- Remove transitional root test discovery once all root suites have moved. Treat the retained `projects.ts` entry as an explicit layout exception. The recorded inventory starts from the actual merged branch, not the older requirements count of 18.

## Verification
- Baseline: 183 tests pass across 23 test files; current root-only typecheck passes.
- Test recursive discovery, focused selection, helper exclusion, and inventory mismatch failures before introducing the runner.
- Run focused module suites, the complete suite, and expanded typecheck after each batch. Verify all original suites remain present.
- Verify normal Pi resource resolution and actual registration in isolated temporary directories: each migrated extension loads once; nested source/tests do not become entry points. Never read or write personal settings for these checks.
- Review moves for behavior changes and duplicate root/folder entries before committing.

## Open Questions
None.
