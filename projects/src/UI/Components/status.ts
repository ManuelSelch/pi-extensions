import type { PipelineStatus, SuiteStatus, JobStatus } from "../../../../pipeline/api.ts";

// CLI errors and remote names must not emit terminal controls.
const safe = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const local = (result: SuiteStatus) => `${result.outcome}${result.stale ? " (stale)" : ""}`;
function remote(job: JobStatus): string {
  const state = job.status === "completed" ? job.conclusion ?? "unknown" : job.status;
  const labels: Record<string, string> = { success: "passed", failure: "failed", in_progress: "running", timed_out: "timed out" };
  return `${job.name}: ${Object.hasOwn(labels, state) ? labels[state] : state}`;
}

/** Pure, unstyled report: no status fetching, mutation or aggregate success policy. */
export function renderRepositoryStatus(name: string, status?: PipelineStatus, error?: string): string {
  const lines = [`  ${name}`];
  if (!status) lines.push(`    Status unavailable: ${error ?? "unknown error"}`);
  else {
    lines.push(`    Local: ${status.configured ? "" : "not configured"}`.trimEnd());
    if (status.prepare) lines.push(`      prepare: ${local(status.prepare)}`);
    for (const [suite, result] of Object.entries(status.suites)) lines.push(`      ${suite}: ${local(result)}`);
    if (status.configured && !Object.keys(status.suites).length) lines.push("      no suites");
    if (!status.github) lines.push("    Remote: not available");
    else {
      const github = status.github;
      lines.push(`    GitHub: ${github.repository} · ${github.branch}`);
      if (github.error) lines.push(`      GitHub unavailable: ${github.error}`);
      else {
        if (!github.workflows.length) lines.push("      no workflows");
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
