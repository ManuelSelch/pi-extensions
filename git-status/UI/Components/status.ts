import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitStatus, RepositoryStatus, BranchStatus } from "../../Domain/status.ts";

function worktreeLabel(branch: string): string {
	for (const prefix of ["feature/", "feat/", "fix/", "bugfix/"]) {
		if (branch.startsWith(prefix) && branch.length > prefix.length) return branch.slice(prefix.length);
	}
	return branch;
}

function formatFileStatus(status: GitStatus): string[] {
	if (status.changed === 0) return ["✓"];
	const parts: string[] = [];
	if (status.staged > 0) parts.push(`+${status.staged}`);
	if (status.modified > 0) parts.push(`~${status.modified}`);
	if (status.untracked > 0) parts.push(`?${status.untracked}`);
	return parts;
}

export function formatGitStatus(status: GitStatus, includeDivergence = true): string {
	const parts = [worktreeLabel(status.branch), ...formatFileStatus(status)];
	if (includeDivergence && status.ahead > 0) parts.push(`↑${status.ahead}`);
	if (includeDivergence && status.behind > 0) parts.push(`↓${status.behind}`);
	return parts.join("  ");
}

export function formatRepositoryLabel(repoName: string, branch: string, worktreeName?: string): string {
	if (!worktreeName) return repoName;
	const branchDirectoryName = branch.replaceAll("/", "-");
	return worktreeName === branch || worktreeName === branchDirectoryName ? repoName : `${repoName}/${worktreeName}`;
}

type Color = "accent" | "success" | "warning" | "muted";
type Detail = { kind: "text"; value: string } | { kind: "count"; value: number };
export interface StatusRow {
	name: string;
	detail?: Detail;
	color: Color;
	accent?: boolean;
	branch?: boolean;
	current?: boolean;
}

function ticketLabel(name: string): { text: string; descriptionStart: number } {
	const first = name.indexOf("-");
	const second = name.indexOf("-", first + 1);
	if (first <= 0 || second <= first + 1 || second === name.length - 1) return { text: name, descriptionStart: 0 };
	const project = name.slice(0, first);
	const number = name.slice(first + 1, second);
	const isWord = (char: string) => (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || (char >= "0" && char <= "9") || char === "_";
	if (![...project].every(isWord) || ![...number].every(char => char >= "0" && char <= "9")) return { text: name, descriptionStart: 0 };
	const ticket = name.slice(0, second);
	return { text: `${ticket}  ${name.slice(second + 1)}`, descriptionStart: ticket.length + 2 };
}

function fitName(name: string, width: number, descriptionStart: number): string {
	if (visibleWidth(name) <= width) return name;
	let fitted = stripTerminalSequences(truncateToWidth(name, width, "…"));
	const boundary = fitted.lastIndexOf("-");
	if (fitted.endsWith("…") && boundary > descriptionStart && boundary >= fitted.length - 8) return `${fitted.slice(0, boundary)}…`;
	if (fitted.endsWith("…")) {
		let end = fitted.length - 1;
		while (end > 0 && "-/ \t".includes(fitted[end - 1])) end--;
		fitted = `${fitted.slice(0, end)}…`;
	}
	return fitted;
}

function renderRow(row: StatusRow, width: number, countWidth: number, theme: { fg(color: Color, text: string): string }): string {
	const formatted = row.branch ? ticketLabel(row.name) : { text: row.name, descriptionStart: 0 };
	const prefix = row.current ? "* " : "";
	const detail = row.detail?.kind === "count" ? `  ●${String(row.detail.value).padStart(countWidth)}`
		: row.detail ? `  ${row.detail.value}` : "";
	const name = prefix + fitName(formatted.text, Math.max(0, width - visibleWidth(detail) - visibleWidth(prefix)), formatted.descriptionStart);
	const padding = row.detail?.kind === "count" ? " ".repeat(Math.max(0, width - visibleWidth(name) - visibleWidth(detail))) : "";
	const suffix = stripTerminalSequences(truncateToWidth(padding + detail, Math.max(0, width - visibleWidth(name)), ""));
	const visibleName = stripTerminalSequences(truncateToWidth(name, width, ""));
	return theme.fg(row.accent ? "accent" : row.color, visibleName) + theme.fg(row.color, suffix);
}

export function renderStatusRows(rows: StatusRow[], width: number, theme: { fg(color: Color, text: string): string }): string[] {
	const countWidth = Math.max(0, ...rows.map(row => row.detail?.kind === "count" ? String(row.detail.value).length : 0));
	return rows.map(row => renderRow(row, width, countWidth, theme));
}

function formatBranch(status: BranchStatus, current: boolean): StatusRow {
	const name = worktreeLabel(status.branch);
	if (status.kind === "feature") {
		const detail: Detail = status.unmerged === undefined ? { kind: "text", value: "merge unknown" }
			: status.unmerged === 0 ? { kind: "text", value: "✓" } : { kind: "count", value: status.unmerged };
		return { name, detail, color: status.unmerged === 0 ? "muted" : "warning", accent: true, branch: true, current };
	}
	let detail: string;
	let color: Color = "warning";
	if (status.upstream === false) detail = "no upstream";
	else if (status.ahead === undefined || status.behind === undefined) detail = "upstream unknown";
	else {
		const parts: string[] = [];
		if (status.ahead > 0) parts.push(`↑${status.ahead}`);
		if (status.behind > 0) parts.push(`↓${status.behind}`);
		detail = parts.join("  ") || "✓";
		if (!parts.length) color = "success";
	}
	return { name, detail: { kind: "text", value: detail }, color, accent: true, branch: true, current };
}

export function formatRepositoryStatus(snapshot: RepositoryStatus): StatusRow[] {
	const name = formatRepositoryLabel(snapshot.repoName, snapshot.status.branch, snapshot.worktreeName);
	const rows: StatusRow[] = [{ name, detail: { kind: "text", value: formatFileStatus(snapshot.status).join("  ") }, accent: true,
		color: snapshot.status.changed === 0 ? "success" : "warning" }];
	if (snapshot.primaryUnavailable) rows.push({ name: "primary branch unavailable", color: "warning" });
	if (snapshot.status.branch === "detached") rows.push({ name: "detached HEAD", color: "warning", current: true });
	let merged = 0;
	for (const branch of snapshot.branches) {
		const current = branch.branch === snapshot.status.branch;
		if (branch.kind === "feature" && branch.unmerged === 0 && !current) merged++;
		else rows.push(formatBranch(branch, current));
	}
	if (merged > 0) rows.push({ name: `✓ ${merged} ${merged === 1 ? "branch" : "branches"}`, color: "muted" });
	return rows;
}
