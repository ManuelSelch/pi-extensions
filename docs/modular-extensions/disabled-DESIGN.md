# Disabled Extension Folder Migration — Design

## Proposed Design
- Move `agentic-flow`, `claude-auth`, `dot-clean`, `pdf`, `session-cleanup`, and `thinking-toggle` from root `.ts.disabled` files to normal `<name>/index.ts` entry points. Leave `projects.ts` and `projects/` unchanged.
- Before exposing the new entries, back up and update the real agent configuration. Add six exact native exclusions, `-extensions/<name>/index.ts`, to the agent's `settings.json`. Preserve all unrelated values and resource entries; validate and reread before writing.
- Add the six current `user:extensions/<name>/index.ts` identities to `extension-manager.json`, with defaults set to false and identities marked seen. Preserve unrelated defaults, packages, policy, and historical entries. This is a one-time authorized configuration update, not runtime migration logic.
- Repair the agentic-flow import from the removed `./todo.ts` path to the existing public `../todo/index.ts` entry. Otherwise preserve disabled implementation behavior.
- Explicitly exclude the six disabled module folders from the active-source TypeScript check, preserving its existing scope. Update README and layout/discovery fixtures for native settings-based disablement.

## Decisions & Trade-offs
- Native exclusions prevent factory execution; manager defaults alone do not. Write and verify exclusions before moving source files.
- Exclusions target the installed agent extension paths, so they remain effective when this worktree is merged into the primary checkout. Do not move or modify the primary checkout automatically.
- Disabled modules become visible to `/extensions` and can subsequently be enabled intentionally. No `.disabled` compatibility code, new loader, or automatic settings migration is introduced.

## Verification
- Extend isolated native discovery tests to find all six folder entries as disabled, load only the existing enabled entries, and verify no disabled commands or factories execute.
- Cover current-format false manager defaults and preservation of unrelated fixture settings. Automated tests use temporary configuration only.
- Verify actual exclusions read-only against the installed Pi resolver after the explicit configuration update; do not load the disabled factories.
- Run focused tooling/manager tests, the complete suite, typecheck, and diff/layout checks before committing repository changes. Keep personal configuration and backups outside Git.

## Open Questions
None.
