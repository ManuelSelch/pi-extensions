# Projects MVP — Design

## Proposed Design
- Add a top-level `projects.ts` loader pointing to `projects/src/App/extension.ts`. Keep catalogue rules in `Domain` and filesystem/Git adapters in `Infra`; mirror these paths under `projects/tests`.
- Register `/projects create <name>`, `add [project] [repo-name]`, `remove [project]`, `list`, `show <project>`, `rename <project> <new-name>`, `delete <project>`, and `repo-name <name>`. Bare `/projects` lists collections for this first increment. There is no help subcommand.
- Parse quoted positional arguments; autocomplete subcommands and project names. Omitted project arguments use a native selection dialog. Confirm collection deletion.
- Store a versioned catalogue at the agent directory's `projects/config.json`, respecting `PI_CODING_AGENT_DIR`. Projects have stable IDs, names and repository memberships; repositories have an identity, display name and default checkout path.
- Resolve the repository from session cwd using Git, including subdirectories. Canonical Git common-directory identity groups linked worktrees. The checkout used on first registration is the default location.

## Decisions & Trade-offs
- Projects are virtual: no project directories, workspace changes or sessions are created by these commands. Membership can span multiple projects.
- Repository names are global catalogue metadata; default to the primary checkout folder name. `repo-name` without a name resets that default. No name flags.
- Use existing Pi notifications and native dialogs, with no custom UI or new dependencies. Searchable overview, session launching, Git/local-check status and remote CI are explicitly deferred, not represented as implemented.
- Validate names and catalogue structure. Reject case-insensitive duplicate project names. Adding existing membership is idempotent. Missing Git repositories and malformed configuration produce errors without overwriting data.
- Lock the complete read/modify/write operation and publish through atomic rename. Never delete repository files.

## Verification
- Drive small red/green tests for parsing, naming, membership and renames.
- Use isolated temporary Git repositories for cwd resolution, linked worktrees, persistence, lock contention and corrupt configuration coverage.
- Exercise command registration, completion, cancellation and deletion confirmation through a small test driver.
- Run focused tests, the existing extension suite, typecheck and a real Pi loader smoke test before committing only this feature's changes.

## Open Questions
None.
