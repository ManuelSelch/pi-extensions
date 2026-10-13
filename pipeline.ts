import { Type } from "typebox";
import { withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Pipeline, projectRoot, type Confirm, type RunResult } from "./pipeline/core.ts";

const SuiteSchema = Type.Object({
	command: Type.Array(Type.String(), { minItems: 1, description: "Executable followed by arguments; no shell interpolation or watch mode." }),
	cwd: Type.Optional(Type.String({ description: "Project-relative working directory; defaults to the project root." })),
	timeoutSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 86400 })),
	staleAfterMinutes: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 525600 })),
	auto: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("after-agent")])),
}, { additionalProperties: false });
const ConfigSchema = Type.Object({ version: Type.Literal(1), suites: Type.Record(Type.String(), SuiteSchema) }, { additionalProperties: false });
const selectionSchema = Type.Object({ suite: Type.Optional(Type.String({ description: "Suite name or all (default)." })) });
const confirmation = (ctx: ExtensionContext, signal?: AbortSignal): Confirm | undefined => ctx.hasUI
	? text => ctx.ui.confirm("Approve pipeline changes / execution?", text, { signal })
	: undefined;
const response = (data: unknown, isError = false) => {
	const text = JSON.stringify(data, null, 2);
	return { content: [{ type: "text" as const, text: text.length > 24000 ? `${text.slice(0, 24000)}\n[Truncated; use pipeline_status or /pipeline logs <suite>. Full output is in the reported log files.]` : text }], details: data, isError };
};
const failed = (results: RunResult[]) => results.some(result => result.outcome !== "passed");
const summary = (results: RunResult[]) => results.length ? results.map(r => `${r.suite}: ${r.outcome} (${r.durationMs}ms)\nLog: ${r.logPath}`).join("\n") : "Pipeline cancelled before execution.";

export default function pipelineExtension(pi: ExtensionAPI): void {
	const active = new Map<string, { controller: AbortController; done: Promise<RunResult[]> }>();
	let shuttingDown = false;
	async function pipeline(ctx: ExtensionContext) { return new Pipeline(await projectRoot(ctx.cwd)); }
	function start(p: Pipeline, ctx: ExtensionContext, suite: string, signal?: AbortSignal): Promise<RunResult[]> {
		if (shuttingDown) throw new Error("Pipeline extension is shutting down");
		if (active.has(p.root)) throw new Error("Pipeline busy in this session");
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		const done = p.run(suite, { confirm: confirmation(ctx, controller.signal), signal: controller.signal }).finally(() => {
			signal?.removeEventListener("abort", abort);
			active.delete(p.root);
		});
		active.set(p.root, { controller, done });
		return done;
	}
	pi.registerTool({
		name: "pipeline_configure", label: "Configure pipeline",
		description: "Create or replace this project's .pi/pipeline.json with native user confirmation. Read pipeline_status first when updating: include every suite to retain; omitted suites are removed. Does not run tests. Automatic settings are reserved for future scheduling.",
		parameters: Type.Object({ config: ConfigSchema }),
		async execute(_id, params, signal, _update, ctx) {
			const p = await pipeline(ctx);
			const confirm = confirmation(ctx, signal);
			const saved = await withFileMutationQueue(p.configPath, () => p.configure(params.config, confirm ? async text => {
				if (signal?.aborted) return false;
				const accepted = await confirm(text);
				return accepted && !signal?.aborted;
			} : undefined));
			return response({ saved, configPath: p.configPath });
		},
	});
	pi.registerTool({
		name: "pipeline_run", label: "Run pipeline",
		description: "Run approved local test suites serially, with timeouts and cancellation. External command changes require native user confirmation. Returns outcomes, bounded output and full log paths; failures are tool errors.",
		parameters: selectionSchema,
		async execute(_id, params, signal, _update, ctx) {
			const results = await start(await pipeline(ctx), ctx, params.suite ?? "all", signal);
			return response(results, failed(results));
		},
	});
	pi.registerTool({
		name: "pipeline_status", label: "Pipeline status",
		description: "Read local pipeline configuration and latest suite outcomes/freshness without executing tests or requesting approval.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) { return response(await (await pipeline(ctx)).status()); },
	});
	pi.registerCommand("pipeline", {
		description: "Inspect local pipeline; run [suite|all], logs <suite>, cancel",
		getArgumentCompletions(prefix) {
			const values = ["status", "run all", "logs", "cancel"].filter(value => value.startsWith(prefix));
			return values.map(value => ({ value, label: value }));
		},
		async handler(args, ctx) {
			try {
				const p = await pipeline(ctx);
				const [action = "status", suite = "all", ...extra] = args.trim().split(/\s+/).filter(Boolean);
				if (extra.length) throw new Error("Usage: /pipeline [status|run [suite|all]|logs <suite>|cancel]");
				if (action === "run") {
					const done = start(p, ctx, suite);
					// Do not block the command loop: /pipeline cancel remains usable.
					void done.then(results => ctx.ui.notify(summary(results), failed(results) ? "warning" : "info"), error => ctx.ui.notify(String(error), "error"));
					ctx.ui.notify("Pipeline requested; use /pipeline status or /pipeline cancel.", "info");
				} else if (action === "cancel") {
					const job = active.get(p.root);
					job?.controller.abort();
					ctx.ui.notify(job ? "Pipeline cancellation requested." : "No pipeline running in this session.", "info");
				} else if (action === "logs") {
					ctx.ui.notify(JSON.stringify(await p.logs(suite), null, 2), "info");
				} else if (action === "status") {
					const status = await p.status();
					ctx.ui.notify(status.configured ? JSON.stringify(status, null, 2) : "No pipeline configuration.", "info");
				} else throw new Error("Usage: /pipeline [status|run [suite|all]|logs <suite>|cancel]");
			} catch (error) { ctx.ui.notify(String(error), "error"); }
		},
	});
	pi.on("session_start", async () => { shuttingDown = false; });
	pi.on("session_shutdown", async () => {
		shuttingDown = true;
		const jobs = [...active.values()];
		for (const job of jobs) job.controller.abort();
		await Promise.allSettled(jobs.map(job => job.done));
	});
}
