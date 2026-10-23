import type { PipelineStatus, SuiteStatus, JobStatus } from "../../../../pipeline/api.ts";

// CLI errors and remote names must not emit terminal controls.
const safe = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
// Match the pipeline widget's symbols without depending on its internal renderer.
function statePresentation(state: string): [string, string] {
  const states: Record<string, [string, string]> = {
    passed: ["✓", ""], failed: ["✗", ""], running: ["›", "running"],
    never: ["○", "never"], cancelled: ["■", "cancelled"],
    "timed-out": ["⌛", "timed out"], queued: ["○", "queued"],
    waiting: ["○", "waiting"], pending: ["○", "pending"], requested: ["○", "requested"], skipped: ["○", "skipped"],
  };
  return Object.hasOwn(states, state) ? states[state] : ["○", state.replace(/_/g, " ")];
}
function outcome(name: string, state: string): string {
  const [symbol, label] = statePresentation(state);
  return `${symbol} ${name}${label ? ` ${label}` : ""}`;
}
function local(name: string, result: SuiteStatus): string {
  return result.stale ? `⚠ ${name} stale (${statePresentation(result.outcome)[0]})` : outcome(name, result.outcome);
}
function remote(job: JobStatus): string {
  const state = job.status === "completed" ? job.conclusion ?? "unknown" : job.status;
  const aliases: Record<string, string> = { success: "passed", failure: "failed", in_progress: "running", timed_out: "timed-out" };
  return outcome(job.name, Object.hasOwn(aliases, state) ? aliases[state] : state);
}

/** Pure, unstyled report: no status fetching, mutation or aggregate success policy. */
export function renderRepositoryStatus(name: string, status?: PipelineStatus, error?: string): string {
  const lines = [`  ${name}`];
  if (!status) lines.push(`    Status unavailable: ${error ?? "unknown error"}`);
  else {
    lines.push(`    Local: ${status.configured ? "" : "not configured"}`.trimEnd());
    if (status.prepare) lines.push(`      ${local("prepare", status.prepare)}`);
    for (const [suite, result] of Object.entries(status.suites)) lines.push(`      ${local(suite, result)}`);
    if (status.configured && !Object.keys(status.suites).length) lines.push("      no suites");
    if (!status.github) lines.push("    Remote: not available");
    else if (status.github.error || status.github.workflows.length) {
      const github = status.github;
      lines.push(`    GitHub: ${github.repository} · ${github.branch}`);
      if (github.error) lines.push(`      GitHub unavailable: ${github.error}`);
      else {
        for (const workflow of github.workflows) {
          lines.push(`      ${remote(workflow)}`);
          if (workflow.jobsError) lines.push(`        Jobs unavailable: ${workflow.jobsError}`);
          else for (const job of workflow.jobs ?? []) lines.push(`        ${remote(job)}`);
        }
      }
    }
  }
  return lines.map(safe).join("\n");
}
