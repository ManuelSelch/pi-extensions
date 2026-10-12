# Worktree-aware status mockup

- Goal: Make unmerged worktree branches and unpushed primary-branch commits hard to overlook.
- Scope: A static, compact representation of Pi's existing footer status widget with a current-checkout row, a primary-branch push row, and one row per linked worktree.
- Revision: 3
- Decisions: Match the existing plain text/TUI widget style: colored inline status text, no message bubble, Markdown layout, buttons, or interactive controls. Row one explicitly identifies the current checkout. Row two explicitly names the primary branch and shows its push state plus worktree branches not merged into it. Worktree summary is intended to remain visible from any checkout when linked worktrees exist.
- Simulated: Repository name, branch, counts, and colors are illustrative. Here Pi is in `feature/search`, while `main` is the primary worktree branch; `feature/search` has three commits not merged into `main`, and `main` has two commits to push. No live Git state or actions.
- Outstanding: How to keep the widget compact when a repository has many linked worktrees; widget width/truncation in narrow terminals.
- Review status: in review.
