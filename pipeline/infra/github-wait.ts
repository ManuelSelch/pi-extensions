import { execute, repository, errorKind, errorMessages } from "../github.ts";

import { successfulConclusion, type WaitTarget, type WaitRun, type WaitJob } from "../domain/wait.ts";

/** Uncached exact-commit queries, separate from the branch-status monitor. */
export class GitHubWaitReader {
	constructor(private readonly cwd: string, private readonly run = execute) {}
	async resolve(ref: string, signal: AbortSignal): Promise<WaitTarget> {
		const remotes = await this.run("git", ["remote", "-v"], this.cwd, signal);
		const repo = repository(remotes);
		if (!repo) throw new Error("A github.com Git remote is required.");
		const commit = (await this.run("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], this.cwd, signal)).trim();
		if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Cannot resolve the requested commit.");
		return { repository: repo, commit };
	}
	private async api(endpoint: string, signal: AbortSignal): Promise<unknown[]> {
		const pages = JSON.parse(await this.run("gh", ["api", "--hostname", "github.com", endpoint, "--paginate", "--slurp"], this.cwd, signal));
		if (!Array.isArray(pages)) throw new Error("Invalid GitHub response");
		return pages;
	}
	async read(target: WaitTarget, signal: AbortSignal): Promise<WaitRun[]> {
		const pages = await this.api(`repos/${target.repository}/actions/runs?head_sha=${target.commit}&per_page=100`, signal);
		const runs = new Map<number, WaitRun>();
		for (const page of pages) {
			const { workflow_runs: items, total_count: total } = page as { workflow_runs?: unknown[]; total_count?: number };
			if (!Array.isArray(items)) throw new Error("Invalid GitHub runs");
			// GitHub caps filtered searches at 1000 runs; a partial set cannot prove success.
			if (total !== undefined && total > 1000) throw new Error("GitHub run search limit exceeded");
			for (const item of items) {
				const run = item as { id: number; run_attempt: number; head_sha: string; name: string; status: string; conclusion: string | null; html_url: string };
				// Verify the response too; never trust a successful run for another commit.
				if (run.head_sha !== target.commit) continue;
				if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || typeof run.status !== "string") throw new Error("Invalid GitHub run identity");
				if ((runs.get(run.id)?.attempt ?? 0) > run.run_attempt) continue;
				runs.set(run.id, { id: run.id, attempt: run.run_attempt, name: run.name, status: run.status, conclusion: run.conclusion ?? null, url: run.html_url });
			}
		}
		return [...runs.values()].sort((a, b) => a.id - b.id);
	}
	async failedJobs(target: WaitTarget, run: WaitRun, signal: AbortSignal): Promise<WaitJob[]> {
		const pages = await this.api(`repos/${target.repository}/actions/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100`, signal);
		return pages.flatMap(page => {
			const jobs = (page as { jobs?: { name: string; conclusion: string | null; html_url: string }[] }).jobs;
			if (!Array.isArray(jobs)) throw new Error("Invalid GitHub jobs");
			return jobs.filter(job => !successfulConclusion(job.conclusion)).map(job => ({ name: job.name, conclusion: job.conclusion, url: job.html_url }));
		});
	}
}

export const waitError = (error: unknown) => `GitHub Actions unavailable: ${errorMessages[errorKind(error)]}`;
