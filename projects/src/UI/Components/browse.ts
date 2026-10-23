import type { GitHubStatus, PipelineStatus } from "../../../../pipeline/api.ts";
import type { BrowseAction, BrowseView } from "../../App/browse.ts";
import { renderRepositoryStatus } from "./status.ts";

export interface BrowseMenu {
  title: string;
  options: { label: string; action: BrowseAction }[];
}
const safe = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const labels: Record<string, string> = {
  passed: "✓ passed", failed: "✗ failed", running: "› running", never: "○ never",
  cancelled: "■ cancelled", "timed-out": "⌛ timed out", queued: "○ queued",
};
const label = (state: string) => Object.hasOwn(labels, state) ? labels[state] : `○ ${safe(state.replace(/_/g, " "))}`;
// A conservative compact signal; full mixed outcomes remain available in details.
function representative(states: string[]): string {
  return ["running", "failed", "timed-out", "stale", "never", "cancelled"].find(state => states.includes(state))
    ?? states.find(state => state !== "passed") ?? "passed";
}
export function localSummary(status: PipelineStatus): string {
  if (!status.configured) return "not configured";
  const results = [...(status.prepare ? [status.prepare] : []), ...Object.values(status.suites)];
  if (!results.length) return "no suites";
  const state = representative(results.map(result => result.stale ? "stale" : result.outcome));
  if (state === "stale") {
    const stale = results.filter(result => result.stale);
    return `⚠ stale (${label(representative(stale.map(result => result.outcome)))})`;
  }
  return label(state);
}
export function githubSummary(github?: GitHubStatus): string {
  if (!github) return "not available";
  if (github.error) return "unavailable";
  if (!github.workflows.length) return "no runs";
  if (github.workflows.some(workflow => workflow.jobsError)) return "jobs unavailable";
  const aliases: Record<string, string> = { success: "passed", failure: "failed", in_progress: "running", timed_out: "timed-out" };
  const states = github.workflows.map(workflow => {
    const state = workflow.status === "completed" ? workflow.conclusion ?? "unknown" : workflow.status;
    return Object.hasOwn(aliases, state) ? aliases[state] : state;
  });
  return label(representative(states));
}

/** Plain title/options only: host-native select owns rendering and input. */
export function browseMenu(view: BrowseView): BrowseMenu {
  const project = view.data.projects.find(item => item.id === view.projectId);
  if (!project) return {
    title: view.data.projects.length ? "Projects" : "Projects\nNo registered projects. Use /projects create <name>.",
    options: [
      ...view.data.projects.map((item, index) => ({
        label: `${index + 1}. ${safe(item.name)} — ${item.repositories.length} repositories`,
        action: { kind: "project" as const, projectId: item.id },
      })),
      { label: "↻ Refresh catalogue", action: { kind: "refresh" } },
      { label: "Close", action: { kind: "close" } },
    ],
  };
  const repository = view.data.repositories.find(item => item.identity === view.repositoryId && project.repositories.includes(item.identity));
  const navigation: BrowseMenu["options"] = [
    { label: repository ? `← Back to ${safe(project.name)}` : "← Back to projects", action: { kind: "back" } },
    { label: "↻ Refresh status", action: { kind: "refresh" } },
    { label: "Close", action: { kind: "close" } },
  ];
  if (repository) {
    const result = view.results.get(repository.identity);
    // Avoid repeating the repository heading already used as the select title.
    const detail = renderRepositoryStatus(repository.name, result?.status, result?.error)
      .split("\n").slice(1).join("\n").replaceAll(repository.path, "[checkout]");
    return {
      title: `${safe(repository.name)}\n${detail}\n\nRegistered checkout · read-only\nGitHub cache: up to 60 seconds. Refresh does not run tests.`,
      options: navigation,
    };
  }
  return {
    title: `${safe(project.name)}\n${project.repositories.length ? "Local pipeline / GitHub Actions" : "No repositories. Use /projects add from a repository session."}`,
    options: [
      ...project.repositories.map((id, index) => {
        const repo = view.data.repositories.find(item => item.identity === id)!;
        const status = view.results.get(id)?.status;
        return {
          label: `${index + 1}. ${safe(repo.name)} — Local: ${status ? localSummary(status) : "unavailable"} · GitHub: ${status ? githubSummary(status.github) : "unavailable"}`,
          action: { kind: "repository" as const, repositoryId: id },
        };
      }),
      ...navigation,
    ],
  };
}
