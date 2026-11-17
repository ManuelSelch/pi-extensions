import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitStatus, RepositoryStatus, BranchStatus } from "../../Domain/status.ts";

// Match Pi Chat's display-only worktree label; keep branch identities intact.
function worktreeLabel(branch: string): string {
	return branch.replace(/^(?:feature|feat|fix|bugfix)\/(?=.)/, "");
}

export function formatGitStatus(status: GitStatus, includeDivergence = true): string {
	const parts = [worktreeLabel(status.branch)];
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

export function renderStatusRows(rows: StatusRow[], width: number, theme: { fg(color: StatusRow["color"], text: string): string }): string[] {
	return rows.map(row => {
		const separator = row.text.indexOf("  ");
		let name = separator < 0 ? row.text : row.text.slice(0, separator);
		const detail = separator < 0 ? "" : row.text.slice(separator);
		const checkoutPrefix = row.label && name.startsWith(`${row.label} · `) ? `${row.label} · ` : "";
		const branch = checkoutPrefix ? name.slice(checkoutPrefix.length) : row.label === name ? name : "";
		const ticket = /^(\w+-\d+)-(.+)$/.exec(branch);
		if (ticket) name = `${checkoutPrefix}${ticket[1]}  ${ticket[2]}`;
		const available = Math.max(0, width - visibleWidth(detail));
		if (visibleWidth(name) > available) {
			name = stripTerminalSequences(truncateToWidth(name, available, "…"));
			const boundary = name.lastIndexOf("-");
			const descriptionStart = ticket ? checkoutPrefix.length + ticket[1].length + 2 : 0;
			if (name.endsWith("…") && boundary > descriptionStart && boundary >= name.length - 8) name = `${name.slice(0, boundary)}…`;
			else if (name.endsWith("…")) name = name.replace(/[-/\s]+…$/, "…");
		}
		const suffix = stripTerminalSequences(truncateToWidth(detail, Math.max(0, width - visibleWidth(name)), ""));
		const accentLength = row.label === row.text.slice(0, separator < 0 ? undefined : separator)
			? name.length : row.label && name.startsWith(row.label) ? row.label.length : 0;
		return theme.fg("accent", name.slice(0, accentLength)) + theme.fg(row.color, name.slice(accentLength) + suffix);
	});
}

function formatBranch(status: BranchStatus): StatusRow {
	if (status.kind === "feature") {
		const text = status.unmerged === undefined ? "merge unknown"
			: status.unmerged === 0 ? "✓" : `●${status.unmerged}`;
		const label = worktreeLabel(status.branch);
		return { text: `${label}  ${text}`, label, color: status.unmerged === 0 ? "muted" : "warning" };
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
	const label = worktreeLabel(status.branch);
	return { text: `${label}  ${detail}`, label, color };
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
