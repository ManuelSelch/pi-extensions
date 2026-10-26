# Git status widget

The checkout line shows only the repository, active branch and uncommitted files—not upstream arrows. `clean` refers only to files, not merge status.

Below it, branch rows appear in this order:
1. Primary checkout's branch, with its upstream push/behind status.
2. Current branch, if different from primary.
3. Other unmerged or unknown linked-worktree branches, alphabetically.
4. A muted `N merged branches` count for other merged branches (omitted when zero).

The current branch always remains individually visible, even when merged; it is excluded from the collapsed count. Each visible branch appears once in the summary. Feature rows display `+N unmerged`, muted `merged`, or `merge unknown`. No primary/worktree/current labels or merge-target suffixes are displayed.

The primary branch is discovered from the first entry of Git's worktree list, not hardcoded to `main`. Switching the primary checkout to another branch changes the comparison target. In a repository with no linked worktrees, the checked-out branch itself is primary.

Merge counts use commit ancestry against the local primary branch. Squash/rebase merges can still appear unmerged; matching file contents do not establish ancestry. Unknown/failed comparisons never count as merged.

Upstream divergence uses local tracking refs; the widget does not fetch or run network operations. `no upstream` differs from `up to date` and `upstream unknown`.

Refresh occurs at session startup, after agent `write`, `edit`, or `bash` tools, and when local Git metadata changes. External staging, commits, merges, normal pushes, branch switches and linked-worktree changes update automatically (500 ms debounce, 2-second maximum wait during bursts). Watchers cover selected Git metadata directories only—not checkout files, objects, logs, `node_modules` or build output. There is no polling or network fetching.

External unstaged edits and untracked files alone do not trigger refreshes; they appear on the next metadata/tool/startup refresh. Remote changes by other people become known only after fetch/pull. Watcher notifications are best effort, especially on network filesystems. A watcher failure warns once per session; tool-triggered refreshes remain available and `/reload` rebuilds watchers. Sessions started outside Git discover later repository initialization on a tool-triggered refresh or reload.

Run `/reload` once to load an updated extension.
