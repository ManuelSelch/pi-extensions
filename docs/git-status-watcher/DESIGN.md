# Git status filesystem watcher — Design

## Overview
Keep the Git widget synchronized with changes from terminals, editors, other Pi sessions and the worktree extension. Git-status owns filesystem watching and reuses its snapshot/formatter pipeline; worktree remains independent, with no custom event contract or polling.

Confirmed cause: the [entry point](../../git-status/index.ts) currently refreshes only at session start and after `write`, `edit` and `bash` tools. Preserve the separate [formatting design](../git-status/DESIGN.md).

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| git-status | [Entry point](../../git-status/index.ts) | Changed | Own session context, refresh scheduling, watcher lifetime and widget publication |
| git-status | Proposed `Infra/watch.ts` | New | Resolve watch targets through the Git adapter; manage native directory watchers and report invalidation/errors |
| git-status | [Git adapter](../../git-status/Infra/git.ts) | Changed | Discover checkout root, Git directory and common Git directory; collect snapshots without optional Git writes |
| git-status | [Formatter](../../git-status/UI/Components/status.ts) | Reused | Preserve existing rows, colors and ancestry semantics |

Watchers, timers, dirty state and the in-flight refresh belong to one session generation. Nothing starts in the extension factory.

## Runtime flow
1. At `session_start`, resolve the checkout root, actual Git directory and common Git directory using Git, not assumptions about a `.git` directory. Normalize paths and deduplicate watch roots.
2. Install recursive directory watchers, then request the initial snapshot. Watch the checkout for file creation, deletion and modification; separately watch metadata directories, including shared refs and worktree administration records. Thus changes to the primary checkout's `HEAD` remain visible from a linked worktree.
3. Watcher events signal invalidation, not a computed Git change. Coalesce events with a 500 ms trailing debounce and a 2-second maximum wait. Existing tool triggers request the same refresh immediately.
4. Run only one snapshot read at a time. Events arriving during a read mark it dirty and schedule one follow-up. Render only for the current session generation; reconcile watch targets after refreshes when repository topology changes.
5. Publish the existing themed rows only when their content changes. A missing/unreadable repository retains the existing widget-clearing behavior.
6. On shutdown, reload or session replacement, invalidate the generation, cancel timers and close watchers idempotently. Late callbacks and completed reads cannot publish into a newer session.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Filesystem → git-status | No automatic observation → proposed invalidation callback and disposable watcher handle | Internal only; no public event or worktree changes |
| Git adapter → entry point/watcher | Snapshot reads → snapshot reads plus proposed watch-target discovery | Existing snapshot shape and exports remain unchanged |
| Git execution → filesystem | `git status` may refresh the index → adapter commands use `git --no-optional-locks` | Read semantics unchanged; avoids self-triggered index-write loops |
| Git-status → widget consumers | Startup/tool updates → additional filesystem-driven updates | Same widget key, rows and formatting; no UI redesign |

## Decisions & Trade-offs
- Use native `node:fs.watch` with recursive directory watching, supported by the current Node runtime. No runtime dependency, Git hooks, shell integration or periodic timer is needed. Debounce timers run only after invalidation.
- Watch directories, not individual files: Git commonly replaces metadata atomically. For metadata events, exclude object storage, lock files and transient write artifacts; include index, HEAD, refs, packed refs, configuration and worktree topology/HEAD changes. An absent filename conservatively invalidates the snapshot.
- Working-tree events exclude separately watched Git metadata. Do not invent a partial `.gitignore` parser: ignored build/dependency files may cause redundant reads. Debouncing bounds bursts, but large busy repositories may warrant a dedicated ignore-aware watcher later. Native recursive watching also has resource costs.
- Do not follow external symlink targets or promise reliability on network filesystems. Watcher errors close affected handles and notify once per session that automatic refresh is degraded. Existing startup/tool triggers remain usable; `/reload` rebuilds watchers. No silent polling fallback or indefinite retry loop.
- Outside a Git repository, create no watchers. Later initialization is discovered by an existing tool trigger or reload; continuously discovering new repositories is outside scope.
- Git remains authoritative; filesystem notifications are best-effort hints. Snapshot reads are not atomic across several Git commands. A subsequent invalidation converges to the final state without interpreting terminal commands.

## Verification
Planned, not run:
- Deterministic scheduler tests: debounce/max-wait, event bursts, serialized reads, invalidation during a read, unchanged publication suppression and no idle polling.
- Watcher tests: target deduplication, metadata filtering, absent filenames, startup/errors, idempotent disposal and stale-generation suppression.
- Extend the [integration driver](../../git-status/tests/Integration/Support/driver.cjs) with explicit shutdown and bounded eventual assertions. Run real external file edits, staging, commits, merges, branch switches, worktree addition/removal and upstream-ref changes without invoking extension tool callbacks; verify widget updates from primary and linked checkouts, including paths with spaces.
- Confirm one external change settles without a self-triggered refresh loop; test unborn/detached repositories, non-repository startup and deletion of watched paths. Ensure tests release watchers before deleting fixtures.
- Run focused Git-status tests, the repository suite and typecheck. Update the [README](../git-status/README.md) to describe automatic refresh and its limitations.

## Open Questions
None.
