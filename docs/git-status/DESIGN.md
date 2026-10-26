# Compact Git status — Design

## Overview
Apply the text layout reviewed in chat to the existing Git widget. This is a formatting-only change: preserve Git collection, ordering, refresh behavior and semantic colors.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| git-status | [status formatter](../../git-status/UI/Components/status.ts) | Changed | Compact checkout and branch rows |
| git-status | [entry point](../../git-status/index.ts) | Reused | Session-local refresh state and themed widget publication |
| git-status | [Git adapter](../../git-status/Infra/git.ts) | Reused | Collect status and ancestry counts |

## Runtime flow
1. Existing startup/tool refresh reads a repository snapshot.
2. Formatter produces compact rows, preserving branch ordering and merged-branch collapsing.
3. Entry point publishes the existing themed string rows; missing repositories still clear the widget.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Formatter → widget | Verbose text → compact symbols | Same row structure; visible strings change |
| Exported formatGitStatus → callers | Labeled file totals → symbolic categories | Signature unchanged; formatted output changes |

- Header: `pi-chat · feat/theme  ~1`; omit redundant changed total. File counters are `+N` staged, `~N` modified and `?N` untracked; clean checkout uses `✓`.
- Primary divergence uses `↑N` / `↓N`, without prose; synchronized primary uses `✓`.
- Feature rows use `●N` for unmerged commits and `✓` for merged current branch.
- Collapsed merged branches use `✓ N branch/branches`.
- Keep explicit unavailable/unknown/no-upstream messages.

## Decisions & Trade-offs
- Follow the user-approved text preview: full branch names, two spaces before counters, no column padding or truncation.
- Use the selected plain circle `●`, not plus or a special branch glyph, for unmerged commits.
- Reuse existing color roles and repository/worktree naming. No dependencies, schema changes or Git mutations.
- Symbols reduce text but require familiarity; retain prose for exceptional states where an icon would be ambiguous.

## Verification
Planned: update formatter assertions and temporary-repository integration expectations; cover clean, mixed file categories, divergence, merged collapse, unknown states and long branch names without padding. Run Git-status tests, repository tests and typecheck. No checks have run yet.

## Open Questions
None.
