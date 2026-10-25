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

Refresh occurs at session startup and after agent `write`, `edit`, or `bash` tools. Changes made outside those triggers appear on the next refresh. Run `/reload` once to load an updated extension.
