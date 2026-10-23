# Native Extension Exclusions — Design

## Proposed Design
- Scope this change to the custom `/extensions` manager and its regression tests; do not execute the full modular-folder migration yet.
- Discover standalone `.ts`/`.js` files and immediate folders containing `index.ts`/`index.js`. Ignore nested source and tests. Use Pi's configured agent directory rather than hardcoding the home directory.
- Disabling writes an exact `-path` entry into the owning scope's `settings.json` `extensions` array; enabling removes equivalent exact exclusions and uses a native exact inclusion when necessary to override broader filters. Resolve paths relative to the settings file's directory, including existing absolute and tilde forms.
- Preserve unrelated settings and resource entries. Validate configuration before writing; report invalid JSON rather than overwriting it. Do not modify another scope's exclusions silently.
- Keep defaults and seen-state in `extension-manager.json`, using current entry identities without legacy-key mapping. Protect the manager by its actual entry path, not the shared filename `index.ts`. Leave package toggling unchanged.
- Remove `.disabled` support entirely: no discovery, conversion notices, migration code, or compatibility branches. The manager recognizes only normal native entry points and settings exclusions. Converting tracked disabled files during the broader folder refactor is a one-time repository change, not a runtime manager responsibility.

## Decisions & Trade-offs
- Reuse Pi's native resource filtering instead of adding a custom loader, configuration format, or runtime enabled checks. No new dependencies.
- Respect filter precedence: exact exclusions override exact inclusions. If another scope still blocks an entry, report that instead of claiming it is enabled.
- Changes require reload/restart; writing settings cannot undo registration in the running runtime. In particular, the startup default-for-new pass cannot guarantee prevention of first-load execution; document this limitation rather than promising an activation security boundary.
- Do not edit personal settings as part of development or tests. Settings writes happen only when the user invokes manager actions or the existing default-for-new policy runs in the installed extension.

## Verification
- Add module-local regression tests through an isolated manager driver with temporary agent/project directories and mocked UI.
- Verify file and folder discovery, settings-only toggles, equivalent path forms, unrelated-setting preservation, malformed JSON, filter precedence, defaults, scope isolation, and self-protection.
- Verify a disabled fixture is excluded by the real Pi resource resolver before loading; its source remains unchanged.
- Run focused tests, the full repository suite, and typecheck. Add the new module-local tests to the existing test command without migrating unrelated suites.

## Open Questions
None.
