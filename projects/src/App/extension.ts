import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  addRepository, createProject, deleteProject, findProject, nameRepository,
  parseArguments, removeRepository, renameProject, type Catalogue, type Project,
} from "../Domain/catalogue.ts";
import { readCatalogue, updateCatalogue } from "../Infra/storage.ts";
import { resolveRepository } from "../Infra/git.ts";
import { ProjectStatus } from "./status.ts";
import { ProjectBrowser } from "./browse.ts";
import { browseProjects } from "../UI/Containers/browse.ts";

const commands = ["create", "add", "remove", "list", "show", "rename", "delete", "repo-name", "status", "browse"];
const usages: Record<string, [number, number, string]> = {
  create: [1, 1, "create <name>"], add: [0, 2, "add [project] [repo-name]"],
  remove: [0, 1, "remove [project]"], list: [0, 0, "list"], show: [1, 1, "show <project>"],
  rename: [2, 2, "rename <project> <new-name>"], delete: [1, 1, "delete <project>"],
  "repo-name": [0, 1, "repo-name [name] (omit name to reset)"],
  status: [0, 1, "status [project]"], browse: [0, 0, "browse"],
};
function quote(value: string): string {
  return /^[^\s'"\\]+$/.test(value) ? value : `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function projectDetails(data: Catalogue, project: Project): string {
  const repositories = project.repositories.map(identity => data.repositories.find(repo => repo.identity === identity)!);
  return `${project.name}\n${repositories.length ? repositories.map(repo => `  ${repo.name}\n    ${repo.path}`).join("\n") : "  No repositories. Use /projects add from a repository session."}`;
}
async function pickProject(ctx: ExtensionContext, projects: Project[]): Promise<Project | undefined> {
  if (!ctx.hasUI) throw new Error("Specify a project name; the project picker needs interactive dialogs.");
  if (!projects.length) throw new Error("No matching projects. Use /projects create or specify another project.");
  const choice = await ctx.ui.select("Choose project", projects.map(project => project.name));
  return projects.find(project => project.name === choice);
}

export default function projectsExtension(pi: ExtensionAPI): void {
  const file = () => join(getAgentDir(), "projects", "config.json");
  const status = new ProjectStatus();
  let browser: ProjectBrowser | undefined;
  const stop = () => { status.stop(); browser?.stop(); browser = undefined; };
  pi.on("session_start", stop);
  pi.on("session_shutdown", stop);
  pi.registerCommand("projects", {
    description: "Manage virtual project collections and the current repository",
    getArgumentCompletions(prefix) {
      if (!/\s/.test(prefix)) return commands.filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
      const match = prefix.match(/^(\S+)\s+([\s\S]*)$/);
      if (!match || !["add", "remove", "show", "rename", "delete", "status"].includes(match[1])) return null;
      const [, action, input] = match;
      try {
        return readCatalogue(file()).projects
          .filter(project => [project.name, quote(project.name)].some(value => value.toLowerCase().startsWith(input.toLowerCase())) ||
            (input.startsWith("'") && project.name.toLowerCase().startsWith(input.slice(1).toLowerCase())))
          .map(project => ({ value: `${action} ${quote(project.name)}`, label: project.name }));
      } catch { return null; } // Execution reports malformed configuration; completion never rewrites it.
    },
    async handler(input, ctx) {
      try {
        const [action = "list", ...args] = parseArguments(input);
        const usage = Object.hasOwn(usages, action) ? usages[action] : undefined;
        if (!usage) throw new Error(`Unknown projects subcommand: ${action}. Use command autocomplete.`);
        if (args.length < usage[0] || args.length > usage[1]) throw new Error(`Usage: /projects ${usage[2]}`);
        const current = readCatalogue(file());
        const notify = (text: string) => ctx.ui.notify(text, "info");
        if (action === "list") {
          notify(current.projects.length ? current.projects.map(project => `${project.name} — ${project.repositories.length} repositories`).join("\n") :
            "No projects. Use /projects create <name>.");
        } else if (action === "browse") {
          if (!ctx.hasUI) throw new Error("Browsing needs interactive dialogs. Use /projects list or /projects status instead.");
          browser?.stop();
          const currentBrowser = new ProjectBrowser(current, () => readCatalogue(file()));
          browser = currentBrowser;
          try { await browseProjects(currentBrowser, ctx.ui); }
          finally { if (browser === currentBrowser) browser = undefined; }
        } else if (action === "status") {
          const projects = args[0] === undefined ? current.projects : [findProject(current, args[0])];
          const report = await status.report(current, projects);
          if (report !== undefined) notify(report);
        } else if (action === "create") {
          let created = "";
          updateCatalogue(file(), data => { created = createProject(data, args[0], randomUUID()).name; });
          notify(`Created project: ${created}`);
        } else if (action === "show") {
          notify(projectDetails(current, findProject(current, args[0])));
        } else if (action === "rename") {
          const project = findProject(current, args[0]);
          updateCatalogue(file(), data => renameProject(data, project.id, args[1]));
          notify(`Renamed ${project.name} to ${args[1].trim()}.`);
        } else if (action === "delete") {
          const project = findProject(current, args[0]);
          if (!ctx.hasUI) throw new Error("Deleting a project requires interactive confirmation.");
          if (!await ctx.ui.confirm(`Delete project ${project.name}?`, "Only the collection and its memberships are removed. Repository files are never deleted.")) return;
          updateCatalogue(file(), data => deleteProject(data, project.id));
          notify(`Deleted project: ${project.name}`);
        } else {
          const repository = await resolveRepository(ctx.cwd);
          if (action === "repo-name") {
            updateCatalogue(file(), data => nameRepository(data, repository, args[0]));
            notify(`Repository name: ${args[0]?.trim() ?? repository.defaultName}`);
          } else {
            const candidates = action === "remove" ? current.projects.filter(project => project.repositories.includes(repository.identity)) : current.projects;
            const project = args[0] === undefined ? await pickProject(ctx, candidates) : findProject(current, args[0]);
            if (!project) return;
            updateCatalogue(file(), data => {
              if (action === "add") addRepository(data, project.id, repository, args[1]);
              else removeRepository(data, project.id, repository.identity);
            });
            notify(`${action === "add" ? "Added repository to" : "Removed repository from"} ${project.name}.`);
          }
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
