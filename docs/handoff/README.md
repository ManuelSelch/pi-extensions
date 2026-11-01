# Review handoff (MVP)

Run `/handoff review` (no parameters) from an idle session in a Git repository. Requires the `code-reviewer` skill and native editor/confirmation support (terminal Pi or a supporting client such as Pi Chat).

1. The extension drafts repository facts, without reading or summarizing the implementation conversation.
2. Edit the handoff: confirm its review scope, artifact paths and any missing decisions or verification gaps.
3. Confirm creation of `Review: <feature>` in the current working directory/worktree.
4. The extension names the fresh session and submits the edited handoff once via `/skill:code-reviewer`. It copies no history and creates no parent/session links.
5. **Archive the implementation session manually in Pi Chat.** This MVP never archives or deletes sessions and requires no pi-server/pi-sdk changes.

Cancelling the editor or confirmation creates no session. A host extension can also cancel creation. If starting the reviewer throws, the new session receives an error notice and the prompt is restored to its editor for retry. The implementation session remains untouched. Do not rerun the handoff to retry a failed model request; use the new session.

## Scope and limitations

- The draft lists repository root, branch, full head/base SHAs, commits, all tracked/untracked dirty files, changed tests/docs, and matching top-level `plans/<feature>/` and `mockups/<feature>/` artifacts. It does not invent a plan or approval record.
- Base inference uses the merge-base with the default branch for feature branches, or with upstream when on the default branch. Remote refs are local snapshots; no fetch runs. The intended flow is one feature per worktree/branch; inspect the inferred range before confirming, especially for work already committed/pushed on main or a branch containing several features.
- If no base can be inferred, the draft explicitly says so and lists only dirty scope. Verify and complete the scope in the handoff editor before confirming.
- All dirty changes are listed, including unrelated work. Inspect and narrow scope in the editor as necessary. Facts are captured before editing, not a frozen checkout; avoid concurrent repository changes during the review handoff.
- Plans match the branch slug or paths changed in the Git range. Mockups match both the branch slug and inferred feature folder name, or changed paths; matching mockups need not have changed during implementation. Approval lines are keyword matches, **not proof of approval**; the reviewer must inspect the referenced artifacts. Nested/legacy artifact locations and decisions recorded only in conversations need manual additions.
- The session name uses the inferred feature (matching plan folder, branch name, then repository folder), independent of edits to the handoff text. Rename the review session afterward if needed.
- No test results are inferred from changed files. The reviewer checks implementation, scenarios and current docs independently and reports findings only. Handoff does not authorize feature acceptance or plan/mockup cleanup.
- Pi owns prompt expansion, execution and persistence. Pi currently defers writing new session files until an assistant response; this extension does not manufacture an assistant message or write session JSONL itself. A new session before its first response may not survive process exit.

## Ownership and verification

`handoff/app/extension.ts` owns native dialogs/session orchestration; `domain/handoff.ts` formats facts and parses arguments; `infra/git-facts.ts` reads local Git/artifacts without a shell or model call. No server registry, archive metadata or permanent handoff file is involved.

Run `npm test -- handoff`, `npm test -- scripts` (native entry discovery), and `npm run typecheck`. Handoff integration tests use real temporary Git repositories and a fake Pi command/session host; they do not establish live model execution or Pi Chat rendering/persistence.
