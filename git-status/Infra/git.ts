import { execFile } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { orderBranches, parseGitStatus, parseWorktrees } from "../Domain/status.ts";
import type { BranchStatus, RepositoryStatus } from "../Domain/status.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | undefined> {
	try {
		const result = await execFileAsync("git", ["--no-optional-locks", ...args], { cwd, timeout: 5000, maxBuffer: 1024 * 1024 });
		return result.stdout;
	} catch {
		return undefined;
	}
}

export async function readGitDirectories(cwd: string): Promise<string[]> {
	const output = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
	return output ? [...new Set(output.trim().split("\n").map(path => resolve(cwd, path)))] : [];
}

function count(value: string | undefined): number | undefined {
	if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function primaryStatus(cwd: string, branch: string): Promise<BranchStatus> {
	const result: BranchStatus = { branch, kind: "primary" };
	const ref = `refs/heads/${branch}`;
	const upstream = await git(cwd, ["for-each-ref", "--format=%(upstream)", ref]);
	if (upstream === undefined) return result;
	result.upstream = Boolean(upstream.trim());
	if (!result.upstream) return result;
	const divergence = await git(cwd, ["rev-list", "--left-right", "--count", `${ref}...${upstream.trim()}`, "--"]);
	const values = divergence?.trim().split(/\s+/);
	result.ahead = count(values?.[0]);
	result.behind = count(values?.[1]);
	return result;
}

export async function readGitStatus(cwd: string): Promise<RepositoryStatus | undefined> {
	const root = (await git(cwd, ["rev-parse", "--show-toplevel"]))?.trim();
	if (!root) return undefined;
	const output = await git(root, ["status", "--porcelain=v1", "--branch", "--untracked-files=normal"]);
	if (output === undefined) return undefined;
	const snapshot: RepositoryStatus = { repoName: basename(root), status: parseGitStatus(output), branches: [] };
	const listing = await git(root, ["worktree", "list", "--porcelain", "-z"]);
	const worktrees = parseWorktrees(listing ?? "");
	const primary = worktrees[0];
	const commonDir = (await git(root, ["rev-parse", "--git-common-dir"]))?.trim();
	const commonRoot = primary?.path ?? (commonDir ? dirname(resolve(root, commonDir)) : root);
	snapshot.repoName = basename(commonRoot);
	snapshot.worktreeName = resolve(commonRoot) === resolve(root) ? undefined : basename(root);

	// An unborn or detached primary cannot provide a meaningful merge target.
	const primaryBranch = primary?.branch;
	const primaryCommit = primaryBranch
		? await git(root, ["rev-parse", "--verify", `refs/heads/${primaryBranch}^{commit}`]) : undefined;
	const current = snapshot.status.branch === "detached" ? undefined : snapshot.status.branch;
	const branches = orderBranches(primaryBranch, current,
		worktrees.flatMap(worktree => worktree.branch ? [worktree.branch] : []));
	snapshot.primaryUnavailable = !primaryCommit;
	for (const branch of branches) {
		if (branch === primaryBranch && primaryCommit) {
			snapshot.branches.push(await primaryStatus(root, branch));
		} else {
			const unmerged = primaryCommit && primaryBranch
				? count(await git(root, ["rev-list", "--count", `refs/heads/${primaryBranch}..refs/heads/${branch}`, "--"]))
				: undefined;
			snapshot.branches.push({ branch, kind: "feature", unmerged });
		}
	}
	return snapshot;
}
