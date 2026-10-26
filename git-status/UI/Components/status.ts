import type { GitStatus, RepositoryStatus, BranchStatus } from "../../Domain/status.ts";

export function formatGitStatus(status: GitStatus, includeDivergence = true): string {
	const parts = [status.branch];
	if (status.changed === 0) {
		parts.push("✓");
	} else {
		if (status.staged > 0) parts.push(`+${status.staged}`);
		if (status.modified > 0) parts.push(`~${status.modified}`);
		if (status.untracked > 0) parts.push(`?${status.untracked}`);
	}
	if (includeDivergence && status.ahead > 0) parts.push(`↑${status.ahead}`);
	if (includeDivergence && status.behind > 0) parts.push(`↓${status.behind}`);
	return parts.join("  ");
}

export function formatRepositoryLabel(repoName: string, branch: string, worktreeName?: string): string {
	if (!worktreeName) return repoName;

	// Worktree directories are commonly named after the branch with slashes
	// replaced by hyphens (for example fix-exit-worktree for fix/exit-worktree).
	// Showing both would repeat the same identity in the widget.
	const branchDirectoryName = branch.replaceAll("/", "-");
	return worktreeName === branch || worktreeName === branchDirectoryName
		? repoName
		: `${repoName}/${worktreeName}`;
}


export interface StatusRow {
	text: string;
	label?: string;
	color: "accent" | "success" | "warning" | "muted";
}

function formatBranch(status: BranchStatus): StatusRow {
	if (status.kind === "feature") {
		const text = status.unmerged === undefined ? "merge unknown"
			: status.unmerged === 0 ? "✓" : `●${status.unmerged}`;
		return { text: `${status.branch}  ${text}`, label: status.branch, color: status.unmerged === 0 ? "muted" : "warning" };
	}
	let detail: string;
	let color: StatusRow["color"] = "warning";
	if (status.upstream === false) detail = "no upstream";
	else if (status.ahead === undefined || status.behind === undefined) detail = "upstream unknown";
	else {
		const parts: string[] = [];
		if (status.ahead > 0) parts.push(`↑${status.ahead}`);
		if (status.behind > 0) parts.push(`↓${status.behind}`);
		detail = parts.join("  ") || "✓";
		if (!parts.length) color = "success";
	}
	return { text: `${status.branch}  ${detail}`, label: status.branch, color };
}

export function formatRepositoryStatus(snapshot: RepositoryStatus): StatusRow[] {
	const label = formatRepositoryLabel(snapshot.repoName, snapshot.status.branch, snapshot.worktreeName);
	const rows: StatusRow[] = [{
		text: `${label} · ${formatGitStatus(snapshot.status, false)}`,
		label,
		color: snapshot.status.changed === 0 ? "success" : "warning",
	}];
	if (snapshot.primaryUnavailable) rows.push({ text: "primary branch unavailable", color: "warning" });
	let merged = 0;
	for (const branch of snapshot.branches) {
		if (branch.kind === "feature" && branch.unmerged === 0 && branch.branch !== snapshot.status.branch) {
			merged++;
		} else {
			rows.push(formatBranch(branch));
		}
	}
	if (merged > 0) rows.push({ text: `✓ ${merged} ${merged === 1 ? "branch" : "branches"}`, color: "muted" });
	return rows;
}
