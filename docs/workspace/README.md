# Multi-root workspaces

`workspace.ts` adds one `/workspace` command. Use it to link a module's Obsidian notes, locally synced Nextcloud materials, and code repositories without moving files or editing `AGENTS.md`.

## Usage

1. Start Pi / Pi Chat in the folder you want to use as the workspace root.
2. Run `/workspace add` and enter a folder path, label, and optional description.
3. Repeat for other folders. Ask about your notes, script, or code normally.

Commands:

- `/workspace` or `/workspace list`: show numbered links, paths, descriptions, and unavailable folders.
- `/workspace add [folder path]`: optional path argument; otherwise prompts for it. Always prompts for a label and optional description. A blank label defaults to the folder name. Escape cancels without saving.
- `/workspace remove [number]`: choose a link interactively or pass its number from the list. Only removes the link; never deletes the folder or files.

Type `/workspace add ` in the main prompt and use folder autocomplete, just like `/cwd`. Suggestions include directories only, append `/`, preserve relative/absolute/`~/` paths, and hide dot-folders unless the current segment starts with `.`. Relative suggestions follow the current session working directory, including after `/cwd` switches. Autocomplete is on the command argument; the plain folder input dialog does not have path completion.

Paths may be absolute, start with `~/`, or be relative to the workspace root. Paths containing spaces work, including an optional pair of surrounding quotes. The entire argument after `add` is the path, not additional options. Existing directories are required; symlink aliases resolve to their real path and cannot be linked twice.

Descriptions can define aliases and default documents, for example: `Lecture materials; 'the script' means Algorithms.pdf`. These descriptions are supplied to the agent as metadata. There is no separate file attachment or alias parser.

## Persistence and context

Links are saved in `<workspace root>/.pi/workspace.json` (or Pi's configured project-directory name). Each exact working directory has its own workspace; there is no parent-directory search or global registry. New and resumed sessions with the same working directory read the same configuration.

Before each agent run, the extension reads the current configuration and supplies the locations as a dedicated `workspace` system-prompt section on Pi 1.x. The section is replaced when changed, not appended as repeated hidden messages. This also supplies the mapping on the next run after compaction. Older Pi versions without structured sections get a per-run system-prompt append instead. If an earlier extension forces a complete prompt override, the mapping is appended to that override. A later extension can still override the prompt, just as with other Pi extensions.

Configuration changes apply on the next prompt without `/reload`. Run `/reload` once after installing the extension to expose the new command. Configuration is only honored in trusted projects. No linked-folder instructions, contents, or file listings are loaded automatically, and links are not a security sandbox or permission grant.

Unavailable folders remain in the mapping with an explicit status and a warning. Invalid configuration is reported, never overwritten by commands, and supplies a warning instead of stale mappings. A missing or empty configuration injects nothing. Limits: 50 folders, 64 KiB JSON, labels up to 200 characters, descriptions up to 1000 characters. Folder paths in the saved file must be absolute.

Writes use an exclusive lock around the complete read/modify/write operation and an atomic rename. A competing writer gets a retry error rather than losing updates. If a process crashes while writing, verify no writer is running before removing the reported `workspace.json.lock` directory. Temporary files left by a crash can be removed too. No changes are made to `AGENTS.md`.

The configuration contains local paths; keep it out of shared repositories if those paths are private or machine-specific.

## Development

```sh
node --test tests/workspace*.test.cjs
npm run typecheck
pi --no-extensions -e ./workspace.ts --help
```
