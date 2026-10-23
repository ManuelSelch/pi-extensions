import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface JobStatus {
	name: string;
	status: string;
	conclusion?: string;
	url?: string;
}
export interface WorkflowStatus extends JobStatus {
	updatedAt?: string;
	jobs?: JobStatus[];
	jobsError?: string;
}
export interface GitHubStatus {
	repository: string;
	branch: string;
	checkedAt: string;
	workflows: WorkflowStatus[];
	error?: string;
}
type Execute = (file: string, args: string[], cwd: string, signal: AbortSignal) => Promise<string>;
const exec = promisify(execFile);
const execute: Execute = async (file, args, cwd, signal) => (await exec(file, args, {
	cwd, signal, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
	env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
})).stdout;

/** github.com only; never send credentials to an arbitrary Git remote host. */
function repository(remotes: string): string | undefined {
	const entries = remotes.split("\n").map(line => line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)).filter(match => match !== null);
	entries.sort((a, b) => Number(b[1] === "origin") - Number(a[1] === "origin"));
	for (const entry of entries) {
		const match = entry[2].match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)\/?$/i);
		if (match) return match[1].replace(/\.git$/, "");
	}
	return undefined;
}

/** Session-owned remote cache, independent of configuration, approvals and local source freshness. */
export class GitHubActions {
	private stopped = false;
	private readonly lifetime = new AbortController();
	private controller = new AbortController();
	private key = "";
	private cached?: GitHubStatus;
	private expires = 0;
	private pending?: Promise<GitHubStatus | undefined>;
	constructor(private readonly root: string, private readonly run: Execute = execute, private readonly now = Date.now) {}
	stop() { this.stopped = true; this.lifetime.abort(); this.controller.abort(); }
	async read(): Promise<GitHubStatus | undefined> {
		if (this.stopped) return undefined;
		let repo: string | undefined, branch: string;
		try {
			const [remotes, currentBranch] = await Promise.all([
				this.run("git", ["remote", "-v"], this.root, this.lifetime.signal),
				this.run("git", ["branch", "--show-current"], this.root, this.lifetime.signal),
			]);
			repo = repository(remotes);
			branch = currentBranch.trim();
		} catch { return undefined; }
		if (this.stopped) return undefined;
		const key = JSON.stringify([repo, branch]);
		if (key !== this.key) {
			this.controller.abort();
			this.controller = new AbortController();
			this.key = key;
			this.cached = undefined;
			this.expires = 0;
			this.pending = undefined;
		}
		if (!repo || !branch) return undefined;
		if (this.pending) return this.pending;
		if (this.now() < this.expires) return this.cached;
		const controller = this.controller;
		const deadline = setTimeout(() => controller.abort(), 15000);
		deadline.unref();
		const request = this.fetch(repo, branch, controller).then(status => {
			if (this.stopped || this.key !== key) return undefined;
			this.cached = status;
			this.expires = this.now() + 60000;
			return status;
		}).finally(() => {
			clearTimeout(deadline);
			if (this.pending === request) {
				this.pending = undefined;
				// A timed-out request must not leave future refreshes permanently aborted.
				if (!this.stopped) this.controller = new AbortController();
			}
		});
		this.pending = request;
		return request;
	}
	private async fetch(repo: string, branch: string, controller: AbortController): Promise<GitHubStatus> {
		const signal = controller.signal;
		const status: GitHubStatus = { repository: repo, branch, checkedAt: new Date(this.now()).toISOString(), workflows: [] };
		const api = async (endpoint: string, paginate = false) => JSON.parse(await this.run("gh", [
			"api", "--hostname", "github.com", endpoint, ...(paginate ? ["--paginate", "--slurp"] : []),
		], this.root, signal));
		try {
			const pages = await api(`repos/${repo}/actions/workflows?per_page=100`, true);
			const workflows = pages.flatMap((page: { workflows: { id: number; name: string }[] }) => page.workflows);
			// Four bounded workers avoid starting a process for every workflow at once.
			let index = 0;
			const results: WorkflowStatus[] = new Array(workflows.length);
			const workers = await Promise.allSettled(Array.from({ length: Math.min(4, workflows.length) }, async () => {
				try {
					while (index < workflows.length && !signal.aborted) {
						const position = index++, workflow = workflows[position];
						const data = await api(`repos/${repo}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
						const run = data.workflow_runs[0];
						results[position] = run ? {
							name: workflow.name, status: run.status, conclusion: run.conclusion ?? undefined,
							updatedAt: run.updated_at ?? run.created_at, url: run.html_url,
						} : { name: workflow.name, status: "never" };
						if (run) {
							try {
								if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt)) throw new Error("Missing run identity");
								const jobPages = await api(`repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, true);
								results[position].jobs = jobPages.flatMap((page: { jobs: { name: string; status: string; conclusion: string | null; html_url: string }[] }) =>
									page.jobs.map(job => ({ name: job.name, status: job.status, conclusion: job.conclusion ?? undefined, url: job.html_url })));
							} catch {
								results[position].jobsError = "Jobs unavailable: check connection and repository access.";
							}
						}
					}
				} catch (error) { controller.abort(); throw error; }
			}));
			const failure = workers.find(worker => worker.status === "rejected");
			if (failure?.status === "rejected") throw failure.reason;
			if (signal.aborted) throw new Error("GitHub request cancelled or timed out");
			status.workflows = results;
		} catch (error) {
			controller.abort();
			status.error = (error as NodeJS.ErrnoException).code === "ENOENT"
				? "GitHub Actions unavailable: install gh and run gh auth login."
				: "GitHub Actions unavailable: check connection, repository access and gh auth login.";
		}
		return status;
	}
}
