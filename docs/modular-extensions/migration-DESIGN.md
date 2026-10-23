# Modular Extension Migration — Next Batch Design

## Proposed Design
- Resume with migration-safe tooling (S1), then the `pi-open` and `projects` pilots (S3). The native settings manager prerequisite (S2) is already implemented; retain its separate design and tests.
- Add a repository test runner under `scripts/` that recursively finds `*.test.cjs` inside module-local `tests/` directories and the transitional root `tests/`. Sort the inventory, ignore dependencies and non-test helpers, and invoke Node's test runner without shell glob expansion. Support focused execution by module name.
- Record the current 23 test-file inventory as a migration regression check. Compare discovered files with the inventory so both missing suites and accidentally unregistered new suites are visible. Preserve existing assertions.
- Extend TypeScript coverage to nested active production files while excluding dependencies, tests, mockups, and external loaders. The existing `.ts.disabled` files remain untouched. Surface newly covered errors and fix only compatibility/type issues needed for this coverage.
- Move `pi-open.ts` to `pi-open/index.ts`, its tests to `pi-open/tests/`, and its example JSON into the module. Move `projects.ts` to `projects/index.ts`, retaining `projects/src/` and `projects/tests/`. Update relative paths, loader fixtures, and affected documentation. Remove the old root entries; add no compatibility shims.

## Decisions & Trade-offs
- Keep shared package tooling and the no-build workflow. Use native immediate-folder discovery, not a custom runtime loader or new dependencies.
- Preserve runtime configuration locations and all extension behavior. Existing simple code stays simple; projects retains its layers.
- Defer pipeline and remaining extensions to subsequent verified batches. Do not relocate disabled modules or edit personal settings in this batch.
- Keep transitional legacy test discovery until the remaining suites move. The recorded inventory starts from the actual merged branch, not the older requirements count of 18.

## Verification
- Baseline: 183 tests pass across 23 test files; current root-only typecheck passes.
- Test recursive discovery, focused selection, helper exclusion, and inventory mismatch failures before introducing the runner.
- Run focused pilot suites, the complete suite, and expanded typecheck.
- Verify normal Pi resource resolution and actual registration in isolated temporary directories: each pilot loads once; nested source/tests do not become entry points. Never read or write personal settings for these checks.
- Review moves for behavior changes and duplicate root/folder entries before committing.

## Open Questions
None.
