import { Type } from "typebox";
import { withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Pipeline, projectRoot, type Confirm, type RunResult, type PipelineStatus, type RunOptions } from "../core/pipeline.ts";
import { PipelineMonitor } from "../core/monitor.ts";
import { renderWidget, renderStatus } from "./widget.ts";
import { PipelineStatusReader } from "../core/api.ts";
import { waitForPipeline, type WaitResult } from "../core/wait.ts";
import { GitHubWaitReader } from "../core/github-wait.ts";

const SuiteSchema = Type.Object({
	command: Type.Array(Type.String(), { minItems: 1, description: "Executable and arguments; no shell or watch mode." }),
	cwd: Type.Optional(Type.String({ description: "Working directory relative to the project root." })),
	timeoutSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400 })),
	auto: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("after-agent")])),
}, { additionalProperties: false });
const PrepareSchema = Type.Object({
	command: Type.Array(Type.String(), { minItems: 1, description: "One-time worktree setup command and arguments, e.g. npm ci." }),
	cwd: Type.Optional(Type.String({ description: "Working directory relative to the project root." })),
	timeoutSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400 })),
}, { additionalProperties: false });
const JobSuiteSchema = Type.Object({
	cwd: Type.Optional(Type.String({ description: "Default working directory for jobs." })),
	timeoutSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400 })),
	auto: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("after-agent")])),
	jobs: Type.Record(Type.String(), SuiteSchema),
}, { additionalProperties: false });
const ConfigSchema = Type.Object({ suites: Type.Record(Type.String(), Type.Union([SuiteSchema, JobSuiteSchema])), prepare: Type.Optional(PrepareSchema) }, { additionalProperties: false });
const selectionSchema = Type.Object({ suite: Type.Optional(Type.String({ description: "Suite name or all (default)." })) });
const confirmation = (ctx: ExtensionContext, signal?: AbortSignal, title = "Approve pipeline execution?"): Confirm | undefined => ctx.hasUI
	? text => ctx.ui.confirm(title, text, { signal })
	: undefined;
const response = (data: unknown, isError = false) => {
	const text = JSON.stringify(data, null, 2);
	return { content: [{ type: "text" as const, text: text.length > 24000 ? `${text.slice(0, 24000)}\n[Truncated; use pipeline_status for details. Full output is in the reported log files.]` : text }], details: data, isError };
};
const failed = (results: RunResult[]) => results.some(result => result.outcome !== "passed");
const summary = (results: RunResult[]) => results.length ? results.map(r => `${r.suite}${r.job ? `/${r.job}` : ""}: ${r.outcome} (${r.durationMs}ms)`).join("\n") : "Pipeline cancelled before execution.";

export default function pipelineExtension(pi: ExtensionAPI): void {
	const active = new Map<string, { controller: AbortController; done: Promise<RunResult[]>; automatic: boolean }>();
	const remoteWaits = new Set<{ controller: AbortController; done: Promise<WaitResult> }>();
	async function stopRemoteWaits() {
		const waits = [...remoteWaits];
		for (const wait of waits) wait.controller.abort();
		await Promise.allSettled(waits.map(wait => wait.done));
	}
	let statusReader = new PipelineStatusReader();
	async function status(p: Pipeline, options: { force?: boolean } = {}): Promise<PipelineStatus> {
		if (shuttingDown) return p.status();
		return statusReader.read(p.root, options);
	}
	let shuttingDown = false;
	let generation = 0;
	let monitor: PipelineMonitor | undefined;
	let monitorRoot: string | undefined;
	let completionPipeline: Pipeline | undefined;
	async function pipeline(ctx: ExtensionContext) { return new Pipeline(await projectRoot(ctx.cwd)); }
	function refreshWidget(root: string) { if (!shuttingDown && monitorRoot === root) void monitor?.refresh(); }
	function showWidget(ctx: ExtensionContext, status: PipelineStatus | undefined) {
		if (!renderWidget(status, { fg: (_color, text) => text }, Number.MAX_SAFE_INTEGER).length) { ctx.ui.setWidget("pipeline", undefined); return; }
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("pipeline", (_tui, theme) => ({ render: width => renderWidget(status, theme, width), invalidate() {} }));
		} else ctx.ui.setWidget("pipeline", renderWidget(status, ctx.ui.theme, Number.MAX_SAFE_INTEGER));
	}
	function start(p: Pipeline, ctx: ExtensionContext, suite: string, signal?: AbortSignal, options: Pick<RunOptions, "automatic" | "expectedSourceFingerprint" | "expectedConfigFingerprint"> = {}): Promise<RunResult[]> {
		if (shuttingDown) throw new Error("Pipeline extension is shutting down");
		if (active.has(p.root)) throw new Error("Pipeline busy in this session");
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		const done = p.run(suite, { ...options, confirm: options.automatic ? undefined : confirmation(ctx, controller.signal), signal: controller.signal, onChange: () => refreshWidget(p.root) }).finally(() => {
			signal?.removeEventListener("abort", abort);
			active.delete(p.root);
			refreshWidget(p.root);
		});
		active.set(p.root, { controller, done, automatic: options.automatic ?? false });
		return done;
	}
	pi.registerTool({
		name: "pipeline_configure", label: "Configure pipeline",
		description: "Create or replace this project's .pi/pipeline.yaml (no version key) after native confirmation. Call pipeline_status first: include every suite and prepare you want to keep — omitted ones are removed. Use prepare for one-time dependency install (prefer npm ci when a package-lock exists).",
		parameters: Type.Object({ config: ConfigSchema }),
		async execute(_id, params, signal, _update, ctx) {
			const p = await pipeline(ctx);
			const confirm = confirmation(ctx, signal, "Approve pipeline changes?");
			const saved = await withFileMutationQueue(p.configPath, () => p.configure(params.config, confirm ? async text => {
				if (signal?.aborted) return false;
				const accepted = await confirm(text);
				return accepted && !signal?.aborted;
			} : undefined));
			refreshWidget(p.root);
			return response({ saved, configPath: p.configPath });
		},
	});
	pi.registerTool({
		name: "pipeline_run", label: "Run pipeline",
		description: "Run the approved local suites serially with timeouts and cancellation; returns outcomes, log paths and errors. Preparation failure or any failed suite is a tool error.",
		parameters: selectionSchema,
		async execute(_id, params, signal, _update, ctx) {
			const results = await start(await pipeline(ctx), ctx, params.suite ?? "all", signal);
			return response(results, failed(results));
		},
	});
	pi.registerTool({
		name: "pipeline_status", label: "Pipeline status",
		description: "Read local pipeline config, suite freshness and latest GitHub Actions runs for the current branch. Read-only; does not execute tests.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) { return response(await status(await pipeline(ctx))); },
	});
	pi.registerTool({
		name: "pipeline_wait", label: "Wait for GitHub Actions",
		description: "Wait for GitHub Actions on a pushed commit (default HEAD) and return outcome, run links and failed jobs. Read-only. No runs, timeout, cancellation or unavailable CI are not success.",
		parameters: Type.Object({
			ref: Type.Optional(Type.String({ minLength: 1, description: "Commit or ref to watch; defaults to HEAD." })),
			timeoutSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400, description: "Overall wait timeout; default 1800 seconds." })),
		}, { additionalProperties: false }),
		async execute(_id, params, signal, update, ctx) {
			if (shuttingDown) throw new Error("Pipeline extension is shutting down");
			const controller = new AbortController();
			const abort = () => controller.abort();
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted) abort();
			const done = waitForPipeline(new GitHubWaitReader(ctx.cwd), { ...params, signal: controller.signal, onUpdate: data => update?.(response(data)) });
			const wait = { controller, done };
			remoteWaits.add(wait);
			try {
				const result = await done;
				return response(result, result.outcome !== "passed");
			} finally {
				remoteWaits.delete(wait);
				signal?.removeEventListener("abort", abort);
			}
		},
	});
	pi.registerCommand("pipeline", {
		description: "Refresh local pipeline and GitHub Actions status; run [suite|all], cancel",
		async getArgumentCompletions(prefix) {
			let names: string[] = [];
			if (completionPipeline && prefix.startsWith("run ")) {
				try { names = Object.keys((await completionPipeline.config())?.suites ?? {}); }
				catch { /* Invalid or absent config must not break command completion. */ }
			}
			const values = ["status", "run all", ...names.filter(name => name !== "all").map(name => `run ${name}`), "cancel"].filter(value => value.startsWith(prefix));
			return values.map(value => ({ value, label: value }));
		},
		async handler(args, ctx) {
			try {
				const p = await pipeline(ctx);
				const [action = "status", suite = "all", ...extra] = args.trim().split(/\s+/).filter(Boolean);
				if (extra.length) throw new Error("Usage: /pipeline [status|run [suite|all]|cancel]");
				if (action === "run") {
					const done = start(p, ctx, suite);
					// Do not block the command loop: /pipeline cancel remains usable.
					void done.then(results => ctx.ui.notify(summary(results), failed(results) ? "warning" : "info"), error => ctx.ui.notify(String(error), "error"));
					ctx.ui.notify("Pipeline requested; use /pipeline status or /pipeline cancel.", "info");
				} else if (action === "cancel") {
					const job = active.get(p.root);
					job?.controller.abort();
					monitor?.agentStarted(); // Pause automatic retries until the next settled agent turn.
					ctx.ui.notify(job ? "Pipeline cancellation requested." : "No pipeline running in this session.", "info");
				} else if (action === "status") {
					const current = await status(p, { force: true });
					refreshWidget(p.root);
					const lines = renderStatus(current, { fg: (_color, text) => text }, Number.MAX_SAFE_INTEGER);
					ctx.ui.notify(lines.join("\n") || (!current.configured ? "No pipeline configuration or GitHub Actions runs." : "No pipeline suites configured."), "info");
				} else throw new Error("Usage: /pipeline [status|run [suite|all]|cancel]");
			} catch (error) { ctx.ui.notify(String(error), "error"); }
		},
	});
	pi.on("session_start", async (_event, ctx) => {
		const currentGeneration = ++generation;
		await stopRemoteWaits();
		statusReader.stop();
		await monitor?.stop();
		if (currentGeneration !== generation) return;
		statusReader = new PipelineStatusReader();
		monitor = undefined;
		monitorRoot = undefined;
		completionPipeline = undefined;
		shuttingDown = false;
		if (!ctx.hasUI) return;
		const p = await pipeline(ctx);
		if (shuttingDown || currentGeneration !== generation) return;
		completionPipeline = p;
		monitorRoot = p.root;
		let local: PipelineStatus | undefined;
		let github: PipelineStatus["github"];
		let remotePending: Promise<void> | undefined;
		let displayed = false;
		const render = () => {
			const combined = local && { ...local, ...(github ? { github } : {}) };
			const visible = renderWidget(combined, { fg: (_color, text) => text }, Number.MAX_SAFE_INTEGER).length > 0;
			if (visible || displayed) showWidget(ctx, combined);
			displayed = visible;
		};
		const updateRemote = () => {
			if (remotePending) return;
			remotePending = statusReader.readRemote(p.root).then(result => {
				if (shuttingDown || currentGeneration !== generation) return;
				github = result;
				render();
			}).catch(() => {
				if (shuttingDown || currentGeneration !== generation) return;
				github = { repository: "", branch: "", checkedAt: new Date().toISOString(), workflows: [], error: "refresh failed", errorKind: "unknown" };
				render();
			}).finally(() => { remotePending = undefined; });
		};
		monitor = new PipelineMonitor(onSnapshot => p.status(onSnapshot), status => {
			local = status;
			render();
			if (status && !shuttingDown && currentGeneration === generation) updateRemote();
		}, undefined, {
			idle: () => !shuttingDown && ctx.isIdle(),
			run: status => start(p, ctx, "all", undefined, { automatic: true, expectedSourceFingerprint: status.sourceFingerprint, expectedConfigFingerprint: status.configFingerprint }),
			cancel: () => { const job = active.get(p.root); if (job?.automatic) job.controller.abort(); },
		});
		// Start remote work independently of local reads and source scanning.
		updateRemote();
		// Status scans and GitHub requests must not hold up opening a session.
		// The monitor owns its pending refresh; stop() still awaits/cancels cleanup.
		void monitor.start().catch(() => { /* Background widget failures stay silent; explicit status exposes errors. */ });
	});
	pi.on("agent_start", async () => { monitor?.agentStarted(); });
	pi.on("agent_settled", async () => { await monitor?.agentSettled(); });
	pi.on("tool_execution_end", async (event) => {
		if (["write", "edit", "bash", "pipeline_configure", "pipeline_run"].includes(event.toolName)) await monitor?.refresh();
	});
	pi.on("session_shutdown", async () => {
		++generation;
		shuttingDown = true;
		const jobs = [...active.values()];
		for (const job of jobs) job.controller.abort();
		statusReader.stop();
		await stopRemoteWaits();
		await monitor?.stop();
		monitor = undefined;
		monitorRoot = undefined;
		completionPipeline = undefined;
		await Promise.allSettled(jobs.map(job => job.done));
	});
}
