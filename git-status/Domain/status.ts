export interface GitStatus {
	branch: string;
	ahead: number;
	behind: number;
	changed: number;
	staged: number;
	modified: number;
	untracked: number;
}

function parseBranch(header: string): string {
	const value = header.slice(3).trim();
	if (value.startsWith("HEAD (")) return "detached";
	if (value.startsWith("No commits yet on ")) return value.slice("No commits yet on ".length);

	const upstreamSeparator = value.indexOf("...");
	return (upstreamSeparator >= 0 ? value.slice(0, upstreamSeparator) : value) || "detached";
}

function parseDivergence(header: string): { ahead: number; behind: number } {
	const ahead = header.match(/ahead (\d+)/)?.[1];
	const behind = header.match(/behind (\d+)/)?.[1];
	return { ahead: ahead ? Number(ahead) : 0, behind: behind ? Number(behind) : 0 };
}

export function parseGitStatus(output: string): GitStatus {
	const lines = output.split(/\r?\n/).filter(Boolean);
	const header = lines.find((line) => line.startsWith("## ")) ?? "## detached";
	const divergence = parseDivergence(header);
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	let changed = 0;

	for (const line of lines) {
		if (line.startsWith("## ") || line.length < 2) continue;
		const index = line[0];
		const worktree = line[1];
		changed++;
		if (index === "?" && worktree === "?") {
			untracked++;
			continue;
		}
		if (index !== " ") staged++;
		if (worktree !== " ") modified++;
	}

	return {
		branch: parseBranch(header),
		...divergence,
		changed,
		staged,
		modified,
		untracked,
	};
}


export interface BranchStatus {
	branch: string;
	kind: "primary" | "feature";
	upstream?: boolean;
	ahead?: number;
	behind?: number;
	unmerged?: number;
}

export interface RepositoryStatus {
	repoName: string;
	worktreeName?: string;
	status: GitStatus;
	branches: BranchStatus[];
	primaryUnavailable?: boolean;
}

export interface Worktree {
	path: string;
	branch?: string;
}

export function parseWorktrees(output: string): Worktree[] {
	const entries: Worktree[] = [];
	let current: Worktree | undefined;
	for (const field of output.split("\0")) {
		if (field.startsWith("worktree ")) {
			current = { path: field.slice(9) };
			entries.push(current);
		} else if (field.startsWith("branch refs/heads/") && current) {
			current.branch = field.slice("branch refs/heads/".length);
		}
	}
	return entries;
}

export function orderBranches(primary: string | undefined, current: string | undefined, branches: string[]): string[] {
	const first = [...new Set([primary, current].filter((branch): branch is string => Boolean(branch)))];
	const rest = [...new Set(branches)].filter(branch => !first.includes(branch)).sort();
	return [...first, ...rest];
}
