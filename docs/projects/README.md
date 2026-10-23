# Projects

A global catalogue of named, virtual collections of Git repositories. Reload Pi once after installing to register `/projects`.

## Commands

| Command | Behavior |
|---|---|
| `/projects` or `/projects list` | List projects and repository counts |
| `/projects create <name>` | Create an empty collection |
| `/projects add [project] [repo-name]` | Attach the current repository; optionally assign its display name |
| `/projects remove [project]` | Unlink the current repository |
| `/projects show <project>` | List repository names and checkout paths |
| `/projects rename <project> <new-name>` | Rename a collection without changing its identity |
| `/projects delete <project>` | Confirm deletion of the collection only |
| `/projects repo-name [name]` | Rename the current repository; omit name to reset its default |

Quote arguments containing spaces. Project names are case-insensitively unique. Repository names may repeat. Subcommands and project names have argument completion; there is no help subcommand.

Example, from a repository session:

```text
/projects create "Pi ecosystem"
/projects add "Pi ecosystem" "Chat UI"
/projects show "Pi ecosystem"
```

Omitting a project for `add` opens the native project picker; for `remove`, the picker contains only current memberships. Cancellation changes nothing. Unknown projects are not created implicitly. Deletion requires an interactive confirmation. Native dialogs can be forwarded by clients that support Pi extension UI; this MVP does not add a custom Pi Chat popup.

## Repository identity

- Git resolves the repository containing the session cwd, including subdirectories.
- Linked worktrees share their canonical Git common-directory identity. Independent clones remain distinct even with the same remote URL.
- The first registered checkout remains the default path. The display name defaults to the primary checkout folder name.
- A repository may belong to several projects. Its display name is shared across all memberships and worktrees.
- Repeated adds do not duplicate membership. Removing membership or deleting a project retains the repository record, including its display name, for later reuse.
- These commands never create project directories, open sessions, change Git configuration, or remove repository files.

## Storage and safety

The catalogue is `projects/config.json` under Pi's agent directory: normally `~/.pi/agent/projects/config.json`, or under `PI_CODING_AGENT_DIR` when set. No repository-local configuration is created. It uses schema version 1 with project IDs/names/membership identities and repository identities/display names/default checkout paths.

Every command rereads configuration. Writes lock the entire read/modify/write operation and use atomic rename. Malformed configuration is never overwritten. A busy lock fails with a retry message; a lock left by a crashed process must only be removed after checking there is no active writer.

Keep custom names single-line and at most 200 characters. Catalogue size is limited to 1 MiB.

## MVP limits

No searchable overview popup, session launching, worktree picker, live Git status, local pipeline aggregation, remote CI or background polling yet. Missing/moved checkout paths are not automatically repaired.
