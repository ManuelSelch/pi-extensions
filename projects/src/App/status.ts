import type { Catalogue, Project } from "../Domain/catalogue.ts";
import { ProjectPipelineReader } from "../Infra/pipeline.ts";
import { renderRepositoryStatus } from "../UI/Components/status.ts";

/** On-demand reports, with one cached API reader per session lifecycle. */
export class ProjectStatus {
  private reader?: ProjectPipelineReader;
  private generation = 0;

  stop(): void {
    this.generation++;
    this.reader?.stop();
    this.reader = undefined;
  }

  async report(data: Catalogue, projects: Project[]): Promise<string | undefined> {
    const generation = this.generation;
    const identities = [...new Set(projects.flatMap(project => project.repositories))];
    const repositories = identities.map(id => data.repositories.find(repo => repo.identity === id)!);
    const reports = new Map<string, string>();
    const reader = repositories.length ? (this.reader ??= new ProjectPipelineReader()) : undefined;
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, repositories.length) }, async () => {
      while (index < repositories.length && generation === this.generation) {
        const repo = repositories[index++];
        try {
          const status = await reader!.read(repo.path);
          reports.set(repo.identity, renderRepositoryStatus(repo.name, repo.path, status));
        } catch (error) {
          reports.set(repo.identity, renderRepositoryStatus(repo.name, repo.path, undefined,
            error instanceof Error ? error.message : String(error)));
        }
      }
    }));
    if (generation !== this.generation) return undefined;
    if (!projects.length) return "No projects. Use /projects create <name>.";
    return projects.map(project => `${project.name}\n${project.repositories.length
      ? project.repositories.map(id => reports.get(id)).join("\n")
      : "  No repositories. Use /projects add from a repository session."}`).join("\n\n");
  }
}
