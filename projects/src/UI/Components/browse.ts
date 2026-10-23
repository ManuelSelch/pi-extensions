import { visibleWidth } from "@earendil-works/pi-tui";
import type { GitHubStatus, PipelineStatus } from "../../../../pipeline/api.ts";
import type { BrowseAction, BrowseView } from "../../App/browse.ts";
import { renderRepositoryStatus } from "./status.ts";

export interface BrowseMenu {
  title: string;
  options: { label: string; action: BrowseAction }[];
}
const safe = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const icons: Record<string, string> = {
  passed: "✓", failed: "✗", running: "›", never: "○", stale: "⚠",
  cancelled: "■", "timed-out": "⌛", queued: "○",
};
const icon = (state: string) => Object.hasOwn(icons, state) ? icons[state] : "?";
// A conservative compact signal; full mixed outcomes remain available in details.
function representative(states: string[]): string {
  return ["running", "failed", "timed-out", "stale", "never", "cancelled"].find(state => states.includes(state))
    ?? states.find(state => state !== "passed") ?? "passed";
}
export function localSummary(status: PipelineStatus): string {
  if (!status.configured) return "—";
  const results = [...(status.prepare ? [status.prepare] : []), ...Object.values(status.suites)];
  if (!results.length) return "—";
  return icon(representative(results.map(result => result.stale ? "stale" : result.outcome)));
}
export function githubSummary(github?: GitHubStatus): string {
  if (!github) return "—";
  if (github.error) return "!";
  if (!github.workflows.length) return "—";
  if (github.workflows.some(workflow => workflow.jobsError)) return "!";
  const aliases: Record<string, string> = { success: "passed", failure: "failed", in_progress: "running", timed_out: "timed-out" };
  const states = github.workflows.map(workflow => {
    const state = workflow.status === "completed" ? workflow.conclusion ?? "unknown" : workflow.status;
    return Object.hasOwn(aliases, state) ? aliases[state] : state;
  });
  return icon(representative(states));
}

function statusTable(rows: string[][]): string {
  // Box-drawing separators opt into Pi Chat's existing preformatted title body.
  // Pad visible columns rather than JS length (wide glyphs, combining marks).
  const widths = rows[0].map((_, column) => rows.reduce((width, row) => Math.max(width, visibleWidth(row[column])), 0));
  return rows.map(row => row.map((cell, column) => cell + " ".repeat(widths[column] - visibleWidth(cell))).join(" │ ")).join("\n");
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
  const repositories = project.repositories.map((id, index) => {
    const repo = view.data.repositories.find(item => item.identity === id)!;
    return { id, name: `${index + 1}. ${safe(repo.name)}`, status: view.results.get(id)?.status };
  });
  const body = repositories.length ? statusTable([
    ["Repository", "Local", "GitHub"],
    ...repositories.map(repo => [repo.name, repo.status ? localSummary(repo.status) : "!", repo.status ? githubSummary(repo.status.github) : "!"]),
  ]) : "No repositories. Use /projects add from a repository session.";
  return {
    title: `${safe(project.name)}\n${body}`,
    options: [
      ...repositories.map(repo => ({ label: repo.name, action: { kind: "repository" as const, repositoryId: repo.id } })),
      ...navigation,
    ],
  };
}
