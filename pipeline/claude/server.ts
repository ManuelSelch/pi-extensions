import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Pipeline, projectRoot, type RunResult } from "../core/pipeline.ts";
import { PipelineStatusReader } from "../core/api.ts";
import { waitForPipeline, type WaitOptions, type WaitResult } from "../core/wait.ts";
import { GitHubWaitReader } from "../core/github-wait.ts";

const step = z.object({
  command: z.array(z.string()).min(1).describe("Executable followed by literal arguments; no shell interpolation or watch mode."),
  cwd: z.string().optional().describe("Project-relative working directory."),
  timeoutSeconds: z.number().positive().max(86400).optional(),
}).strict();
const suite = step.extend({ auto: z.enum(["manual", "after-agent"]).optional() });
const jobSuite = z.object({
  cwd: z.string().optional(),
  timeoutSeconds: z.number().positive().max(86400).optional(),
  auto: z.enum(["manual", "after-agent"]).optional(),
  jobs: z.record(z.string(), suite),
}).strict();
const config = z.object({ suites: z.record(z.string(), z.union([suite, jobSuite])), prepare: step.optional() }).strict();
const result = (value: unknown, isError = false) => {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: text.length > 24000 ? `${text.slice(0, 24000)}\n[Truncated; full output is in the reported log files.]` : text }], ...(isError ? { isError: true } : {}) };
};
type Options = {
  cwd: string;
  cacheRoot?: string;
  wait?: (cwd: string, options: WaitOptions) => Promise<WaitResult>;
};

/** One server and status cache per client connection. */
export function createPipelineServer(options: Options): McpServer {
  const server = new McpServer({ name: "pipeline", version: "1.0.0" }, { instructions: "Use pipeline tools to configure, run and inspect local tests, or wait for GitHub Actions on an exact commit." });
  const statusReader = new PipelineStatusReader(options.cacheRoot);
  const active = new Set<AbortController>();
  const previousClose = server.server.onclose;
  server.server.onclose = () => { for (const controller of active) controller.abort(); statusReader.stop(); previousClose?.(); };
  const pipeline = async () => new Pipeline(await projectRoot(options.cwd), options.cacheRoot);
  const confirm = async (text: string, signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted || !server.server.getClientCapabilities()?.elicitation) return false;
    try {
      const answer = await server.server.elicitInput({
        mode: "form", message: text,
        requestedSchema: { type: "object", properties: { approved: { type: "boolean", title: "Approve the pipeline configuration and commands" } }, required: ["approved"] },
      }, { signal, timeout: 300000 });
      return !signal.aborted && answer.action === "accept" && answer.content?.approved === true;
    } catch { return false; }
  };
  const runOperation = async <T>(signal: AbortSignal, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    active.add(controller);
    try { return await fn(controller.signal); }
    finally { active.delete(controller); signal.removeEventListener("abort", abort); }
  };

  server.registerTool("pipeline_status", {
    description: "Read local suite outcomes and latest GitHub Actions branch status. Does not run tests or request approval.",
    inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true },
  }, async () => result(await statusReader.read(options.cwd)));

  server.registerTool("pipeline_configure", {
    description: "Create or replace .pi/pipeline.yaml after explicit user review. Read status first; preserve all suites and prepare to retain them. Saving does not run tests.",
    inputSchema: z.object({ config }).strict(),
  }, async ({ config: proposed }, extra) => runOperation(extra.signal, async signal => {
    const p = await pipeline();
    const saved = await p.configure(proposed, text => confirm(text, signal));
    return result({ saved, configPath: p.configPath });
  }));

  server.registerTool("pipeline_run", {
    description: "Run selected approved local test suites serially. Preparation runs once per worktree; failures block suites. Unapproved commands require explicit user approval.",
    inputSchema: z.object({ suite: z.string().optional().describe("Suite name, or all (default).") }).strict(),
  }, async ({ suite: selected }, extra) => runOperation(extra.signal, async signal => {
    const results: RunResult[] = await (await pipeline()).run(selected ?? "all", { signal, confirm: text => confirm(text, signal) });
    return result(results, results.some(item => item.outcome !== "passed"));
  }));

  server.registerTool("pipeline_wait", {
    description: "Wait for GitHub Actions on one exact commit after an approved push. No runs, timeout, cancellation and unavailable CI are not success. Never pushes or changes remote CI.",
    inputSchema: z.object({ ref: z.string().min(1).optional(), timeoutSeconds: z.number().positive().max(86400).optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, async (params, extra) => runOperation(extra.signal, async signal => {
    const wait = options.wait ?? ((cwd: string, input: WaitOptions) => waitForPipeline(new GitHubWaitReader(cwd), input));
    const outcome = await wait(options.cwd, { ...params, signal });
    return result(outcome, outcome.outcome !== "passed");
  }));
  return server;
}
