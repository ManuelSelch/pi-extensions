# Git metadata watcher — Design

## Overview
Git-status watches local Git metadata to refresh after external staging, commits, pushes, merges and branch/worktree changes. Keep the worktree extension independent and retain startup and `write`/`edit`/`bash` refreshes. No polling or working-tree watching: external unstaged edits alone do not trigger refreshes.

Confirmed cause: the [entry point](../../git-status/index.ts) currently refreshes only at startup and after those three tools. Preserve the separate [formatting design](../git-status/DESIGN.md).

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| git-status | [Entry point](../../git-status/index.ts) | Changed | Own session-scoped refresh queue, debounce timers, watcher disposal and widget publication |
| git-status | Proposed `Infra/watch.ts` | New | Maintain selective native directory watchers; report invalidation and errors |
| git-status | [Git adapter](../../git-status/Infra/git.ts) | Changed | Resolve actual/common Git directories and collect snapshots without optional writes |
| git-status | [Formatter](../../git-status/UI/Components/status.ts) | Reused | Preserve rows, colors and ancestry semantics |

All handles and asynchronous state belong to one session generation; nothing starts in the extension factory.

## Runtime flow
1. On session start, discover absolute Git and common Git directories through Git. Do not assume `.git` is a directory: linked worktrees use a file.
2. Install non-recursive directory watchers on those roots, existing ref directories, and the shared worktree-administration directory and its records. Enumerate only these selected metadata subtrees, never object storage, logs or checkout files. Deduplicate paths and do not follow symlink directories.
3. Relevant events invalidate status. Root events cover index, HEAD, packed refs and configuration replacement. Ref events cover local/remote refs; administration events cover worktree membership and HEAD changes, including primary HEAD from a linked checkout. Ignore lock files and unrelated root entries. An absent filename conservatively invalidates.
4. Debounce invalidations for 500 ms, with a 2-second maximum wait during sustained activity. Reconcile directory watchers after invalidation so newly created ref directories/worktree records become watched. Install watchers before reading the resulting snapshot to close initialization races.
5. Serialize snapshot reads; invalidations during a read request one follow-up. Existing tool triggers use the same queue immediately. Publish only changed themed rows for the active session generation. Missing/unreadable repositories retain existing widget clearing.
6. Shutdown, reload or session replacement cancels timers and closes watchers idempotently. Ignore late callbacks and snapshot completions from a disposed generation.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Filesystem → git-status | No observation → proposed metadata invalidation/error callbacks and disposable watcher handle | Internal only; no event contract with worktree |
| Git adapter → watcher | No discovery → proposed absolute Git/common-directory discovery | Snapshot shape and existing exports unchanged |
| Git commands → filesystem | Status can refresh index → adapter uses `git --no-optional-locks` | Read semantics unchanged; prevents refresh feedback loops |
| Git-status → widget consumers | Startup/tool refresh → additional metadata-driven refresh | Widget key, formatting and transport unchanged |

## Decisions & Trade-offs
- Native `node:fs.watch`, no new dependency. Selective non-recursive watches avoid observing `.git/objects`, build output or `node_modules`; callback filtering alone would not eliminate that observation cost.
- Watch directories rather than individual files because Git replaces files atomically. Reconcile directory topology without installing a broad recursive root watch. Resource usage scales with ref directories and worktree records, not repository file/object count.
- Local tracking refs determine ahead/behind counts. Normal pushes update those refs; other people's remote pushes remain unknown until fetch/pull. No network operations are added.
- External unstaged edits and untracked files are deliberately outside automatic observation. They appear after another refresh trigger. Existing startup/tool refresh behavior remains useful when watching fails.
- Watcher failures close affected handles and notify once per session that automatic refresh is degraded. No polling fallback or unbounded retries; reload rebuilds watchers. Native notifications are best effort, particularly on network filesystems.
- Non-repository startup installs no watchers. An existing tool trigger or reload can discover a subsequently initialized repository. Repository relocation and symlink-target monitoring are outside scope.

## Verification
Planned, not run:
- Deterministic tests for debounce/max-wait, serialized reads, follow-up invalidation, unchanged publication, disposal and stale-session suppression; verify no idle polling.
- Watcher tests for target deduplication, root/ref/worktree filters, atomic replacement, missing filenames, directory addition/removal and failures. Assert no watcher or traversal enters objects, logs or working-tree directories.
- Extend the [integration driver](../../git-status/tests/Integration/Support/driver.cjs) with bounded eventual assertions and shutdown before fixture deletion. Exercise external staging, commits, merges, pushes to a local bare remote, primary branch switches, and worktree creation/removal from primary and linked sessions without extension tool callbacks.
- Verify external unstaged edits alone do not refresh, while existing tool triggers still reveal them. Cover paths with spaces, unborn/detached repositories and no self-triggered index-write loop.
- Run focused Git-status tests, repository tests and typecheck. Update the [README](../git-status/README.md) with metadata-only behavior and limitations.

## Open Questions
None.
