import { setTimeout as delay } from "node:timers/promises";
import { GitHubWaitReader, waitError } from "../infra/github-wait.ts";
import { successfulConclusion, type WaitTarget, type WaitRun } from "../domain/wait.ts";

export interface WaitOptions {
	ref?: string;
	timeoutSeconds?: number;
	signal?: AbortSignal;
	onUpdate?: (result: WaitResult) => void;
}
export interface WaitResult {
	outcome: "waiting" | "passed" | "failed" | "cancelled" | "timed-out" | "not-found" | "unavailable";
	repository?: string;
	commit?: string;
	runs: WaitRun[];
	message?: string;
}
const clock = { now: Date.now, sleep: (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }) };
type Reader = Pick<GitHubWaitReader, "resolve" | "read" | "failedJobs">;

/** Pins identity once; two identical terminal polls allow a discovery grace period. */
export async function waitForPipeline(reader: Reader, options: WaitOptions = {}, timing = clock): Promise<WaitResult> {
	const timeout = options.timeoutSeconds ?? 1800;
	if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400) throw new Error("timeoutSeconds must be greater than 0 and at most 86400.");
	const controller = new AbortController();
	const abort = () => controller.abort();
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) abort();
	const deadline = timing.now() + timeout * 1000;
	let expired = false;
	const timer = setTimeout(() => { expired = true; controller.abort(); }, timeout * 1000);
	timer.unref();
	let target: WaitTarget | undefined;
	let queried = false;
	const seen = new Map<number, WaitRun>();
	const result = (outcome: WaitResult["outcome"], message?: string): WaitResult => ({ ...target, outcome, runs: [...seen.values()], ...(message ? { message } : {}) });
	const interrupted = () => options.signal?.aborted ? result("cancelled") : result(queried && !seen.size ? "not-found" : "timed-out");
	try {
		if (controller.signal.aborted) return interrupted();
		target = await reader.resolve(options.ref ?? "HEAD", controller.signal);
		let terminalSnapshot = "";
		while (!controller.signal.aborted && timing.now() < deadline) {
			const runs = await reader.read(target, controller.signal);
			if (controller.signal.aborted || timing.now() >= deadline) return interrupted();
			queried = true;
			for (const run of runs) seen.set(run.id, run);
			const complete = runs.length > 0 && runs.length === seen.size && runs.every(run => run.status === "completed");
			const snapshot = complete ? JSON.stringify(runs.map(run => [run.id, run.attempt, run.status, run.conclusion]).sort((a, b) => Number(a[0]) - Number(b[0]))) : "";
			if (snapshot && snapshot === terminalSnapshot) {
				for (const run of runs.filter(run => !successfulConclusion(run.conclusion))) {
					try { run.failedJobs = await reader.failedJobs(target, run, controller.signal); }
					catch { run.jobsError = "Failed job details unavailable."; }
				}
				if (controller.signal.aborted || timing.now() >= deadline) return interrupted();
				return result(runs.every(run => successfulConclusion(run.conclusion)) ? "passed" : "failed");
			}
			terminalSnapshot = snapshot;
			options.onUpdate?.(result("waiting"));
			await timing.sleep(Math.min(15000, Math.max(0, deadline - timing.now())), controller.signal);
		}
		return interrupted();
	} catch (error) {
		if (controller.signal.aborted || expired || timing.now() >= deadline) return interrupted();
		return result("unavailable", waitError(error));
	} finally {
		clearTimeout(timer);
		controller.abort();
		options.signal?.removeEventListener("abort", abort);
	}
}
