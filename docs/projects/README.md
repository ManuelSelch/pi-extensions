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
| `/projects status [project]` | Show local pipeline and available GitHub Actions status; omit project for all collections |
| `/projects browse` | Browse projects, repository status and pipeline details through native select menus |
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

Omitting a project for `add` opens the native project picker; for `remove`, the picker contains only current memberships. Cancellation changes nothing. Unknown projects are not created implicitly. Deletion requires an interactive confirmation. Native dialogs can be forwarded by clients that support Pi extension UI, including Pi Chat. Browsing reuses these existing dialogs; it adds no custom terminal overlay or Pi Chat component.

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

## Pipeline status

`/projects status [project]` reads each repository's registered default checkout through the public pipeline API. Reports include local preparation and named suites (including never-run and stale results), plus available GitHub workflow and job names and outcomes. Checkout paths and run/job URLs are omitted to keep the report compact. Empty GitHub workflow sections are hidden; GitHub errors remain visible. Status rows use pipeline symbols: ✓ passed, ✗ failed, ⚠ stale (with the previous outcome), plus running/queued/cancelled indicators. Unconfigured local pipelines, absent remote data and errors are explicit; one failed repository does not hide the others.

This is an on-demand, read-only report: it never executes tests, installs dependencies or requests approvals. Shared repositories are read once per report, with up to four reads in parallel. Remote data uses the pipeline API's session cache (60 seconds) and current branch; it is not matched against local commits. GitHub requires installed/authenticated `gh`. GitLab is not supported by the API today.

Status is worktree-specific: it reads the registered checkout, not every linked worktree or the current session checkout. Use `/projects show <project>` to see checkout paths. Missing/moved paths are reported without automatically repairing catalogue entries. Readers stop on session replacement/shutdown; obsolete in-flight reports are discarded.

## Native project browser

Run `/projects browse` for **Projects → repositories → pipeline details**. The populated Projects menu is simply titled **Projects**, with no explanatory subtitle. Project rows show repository counts. Each project's repository menu shows an aligned **Repository │ Local │ GitHub** table in its title/body, with icon-only status cells; selectable options below contain only numbered repository names. Numbers disambiguate duplicate display names. Only repositories belonging to registered projects appear; retained unlinked repository records are excluded.

- Select a project to read its repositories' completed status snapshot, then select a repository for preparation, suite, workflow and job details. Shared repositories reuse their completed snapshot until refresh. Reads are bounded to four concurrent repositories.
- **Back** or **Escape/Cancel** returns one level; cancelling at Projects closes. **Close** exits from any menu. Use the host's native arrows/Enter controls; Pi Chat also provides its existing pointer and Cancel/OK controls.
- **Refresh catalogue** rereads the project catalogue. **Refresh status** rereads the catalogue and the selected project's repository status, retaining details if the membership still exists. Removed projects return to Projects; removed repositories return to their project. Refresh does not run tests and does not bypass the pipeline API's 60-second GitHub cache.
- Status reads finish before the next menu opens: there are no progressive live updates or background polls. Separate local/GitHub cells use **✓** passed, **✗** failed, **⚠** stale, **›** running, **○** never/queued, **■** cancelled, **⌛** timed out, **—** unconfigured/empty/no data, **!** unavailable/error, and **?** other/unknown states. Explanations and detailed mixed outcomes remain available after selecting a repository. No aggregate project pass/fail is computed.
- Native terminal Pi replaces the editor with a selector; Pi Chat renders its existing prompt modal. Box-drawing separators activate Pi Chat's existing preformatted title rendering; columns are padded by visible terminal width rather than literal tabs. No Pi Chat changes are needed. Theme, keyboard bindings, wrapping, optional filtering and focus restoration belong to the host. Large menus/reports retain native host limits; this is not a custom searchable tree or responsive dashboard.
- Browsing is read-only, does not add the overview to model context, and stops its own readers/selects on close, replacement or shutdown. Existing text-report readers are independent. Non-interactive modes should use `/projects list` or `/projects status`.

## MVP limits

No custom searchable overview, session launching, worktree picker, live Git status or background polling. Status covers local pipelines and GitHub Actions only. Missing/moved checkout paths are not automatically repaired.
