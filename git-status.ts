import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const REFRESH_TOOLS = new Set(["write", "edit", "bash"]);

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

export function formatGitStatus(status: GitStatus): string {
	const parts = [status.branch];
	if (status.changed === 0) {
		parts.push("clean");
	} else {
		parts.push(`${status.changed} changed`);
		if (status.staged > 0) parts.push(`+${status.staged} staged`);
		if (status.modified > 0) parts.push(`~${status.modified} modified`);
		if (status.untracked > 0) parts.push(`?${status.untracked} untracked`);
	}
	if (status.ahead > 0) parts.push(`↑${status.ahead}`);
	if (status.behind > 0) parts.push(`↓${status.behind}`);
	return parts.join("  ");
}

async function readGitStatus(cwd: string): Promise<{ repoName: string; status: GitStatus } | undefined> {
	try {
		const rootResult = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
		const repoRoot = rootResult.stdout.trim();
		if (!repoRoot) return undefined;

		const statusResult = await execFileAsync(
			"git",
			["status", "--porcelain=v1", "--branch", "--untracked-files=normal"],
			{ cwd: repoRoot },
		);
		return { repoName: basename(repoRoot), status: parseGitStatus(statusResult.stdout) };
	} catch {
		return undefined;
	}
}

function renderStatus(ctx: ExtensionContext, repoName: string, status: GitStatus): string {
	const theme = ctx.ui.theme;
	const repo = theme.fg("accent", repoName);
	const details = formatGitStatus(status);
	if (status.changed === 0) return `${repo}  ${theme.fg("success", details)}`;
	return `${repo}  ${theme.fg("warning", details)}`;
}

export default function gitStatusExtension(pi: ExtensionAPI): void {
	let refreshInFlight: Promise<void> | undefined;
	let refreshRequested = false;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		if (refreshInFlight) {
			refreshRequested = true;
			return refreshInFlight;
		}

		refreshInFlight = (async () => {
			do {
				refreshRequested = false;
				const result = await readGitStatus(ctx.cwd);
				if (!result) {
					ctx.ui.setWidget("git-status", undefined);
				} else {
					ctx.ui.setWidget("git-status", [renderStatus(ctx, result.repoName, result.status)]);
				}
			} while (refreshRequested);
		})();

		try {
			await refreshInFlight;
		} finally {
			refreshInFlight = undefined;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (REFRESH_TOOLS.has(event.toolName)) await refresh(ctx);
	});
}
