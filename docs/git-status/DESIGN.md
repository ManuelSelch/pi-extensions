# Worktree-aware Git status — Design

## Overview
Extend the existing widget with branch-summary rows matching the [approved mockup](../../mockups/worktree-status/DESIGN.md). Keep the checkout/file-status line separate from merge and push information.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| git-status | index.ts | Changed | Extension wiring, refresh coordination and compatibility exports |
| git-status | Domain/status.ts (proposed) | New | Plain snapshots, parsing and deterministic branch ordering |
| git-status | Infra/git.ts (proposed) | New | Read checkout, worktree and ancestry information using Git |
| git-status | UI/Components/status.ts (proposed) | New | Pure text rows and semantic color roles |

Refresh state remains session-local in the entry point. No dependency or cross-extension API changes.

## Runtime flow
1. Session startup or completed write/edit/bash triggers the existing coalesced refresh.
2. Git adapter reads current status and `git worktree list --porcelain -z`; the first worktree identifies the primary checkout and its checked-out branch (not hardcoded main).
3. Adapter compares each distinct linked-worktree branch, plus the current branch even in an ordinary checkout, against the primary branch. Read primary upstream divergence separately.
4. Render checkout summary, then primary branch, current branch if different, then remaining worktree branches alphabetically. Publish through the existing widget key.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Git adapter → widget | Current checkout only → checkout plus branch summaries | Internal extension change |
| Widget → Pi UI | One string row → multiple string rows | Same setWidget API/key |

Keep existing parsing/formatting exports available. Primary row shows push/behind counts, `up to date`, or `no upstream`. Feature rows show `+N unmerged` or `merged`; no current/primary/worktree labels or target suffix.

## Decisions & Trade-offs
- Count commits reachable from branch but not primary using Git revision traversal. This is ancestry-based: squash/rebase merges may still appear unmerged.
- Read local refs only; no fetch, mutation, or network access. Existing upstream counts remain distinct from merge counts.
- Failed comparisons display `merge unknown`, never `merged`. Detached/unborn primary disables comparison and shows unavailable state; detached current keeps its checkout summary without inventing a branch.
- Preserve checkout summary if supplementary reads fail. Missing/non-Git checkout clears the widget as before.
- Keep existing refresh triggers; external changes appear on the next refresh. No polling or user-bash interception in this scope.
- No duplicate primary/current branch rows. Full summary remains visible from any checkout, even primary.

## Verification
Planned TDD: pure ordering/format tests, including current=primary and clean-but-unmerged; temporary-repository integration tests through a test driver for linked worktrees, ordinary feature checkout, merge completion, missing upstream and unavailable ancestry. Verify refresh publication and preservation on supplementary failures. Run focused tests, repository tests and typecheck.

## Open Questions
None.
