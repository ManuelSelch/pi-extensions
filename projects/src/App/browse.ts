import type { Catalogue } from "../Domain/catalogue.ts";
import { ProjectStatus, type RepositoryStatus } from "./status.ts";

export type BrowseAction =
  | { kind: "project"; projectId: string }
  | { kind: "repository"; repositoryId: string }
  | { kind: "back" | "refresh" | "close" };
export interface BrowseView {
  data: Catalogue;
  results: ReadonlyMap<string, RepositoryStatus>;
  projectId?: string;
  repositoryId?: string;
}

/** One read-only interaction; native UI is supplied by its container. */
export class ProjectBrowser {
  private readonly lifetime = new AbortController();
  private readonly status = new ProjectStatus();
  private results = new Map<string, RepositoryStatus>();
  private projectId?: string;
  private repositoryId?: string;

  constructor(private data: Catalogue, private readonly reread: () => Catalogue) {}
  get signal(): AbortSignal { return this.lifetime.signal; }
  get view(): BrowseView {
    return { data: this.data, results: this.results, projectId: this.projectId, repositoryId: this.repositoryId };
  }

  stop(): void {
    if (this.signal.aborted) return;
    this.lifetime.abort();
    this.status.stop();
  }

  async dispatch(action: BrowseAction): Promise<void> {
    if (this.signal.aborted) return;
    switch (action.kind) {
      case "close": this.stop(); return;
      case "back":
        if (this.repositoryId !== undefined) this.repositoryId = undefined;
        else if (this.projectId !== undefined) this.projectId = undefined;
        else this.stop();
        return;
      case "project":
        if (!this.data.projects.some(project => project.id === action.projectId)) return;
        this.projectId = action.projectId;
        this.repositoryId = undefined;
        break;
      case "repository":
        if (this.data.projects.find(project => project.id === this.projectId)?.repositories.includes(action.repositoryId)) {
          this.repositoryId = action.repositoryId;
        }
        return;
      case "refresh": {
        // Parse first: invalid catalogue data is never repaired or overwritten.
        this.data = this.reread();
        this.results.clear();
        const project = this.data.projects.find(project => project.id === this.projectId);
        if (!project) this.projectId = undefined;
        if (!project?.repositories.includes(this.repositoryId ?? "")) this.repositoryId = undefined;
        break;
      }
    }
    const project = this.data.projects.find(project => project.id === this.projectId);
    if (!project) return;
    const missing = project.repositories.filter(id => !this.results.has(id));
    if (!missing.length) return;
    const results = await this.status.read(this.data, [{ ...project, repositories: missing }]);
    if (this.signal.aborted || !results) return;
    for (const [id, result] of results) this.results.set(id, result);
  }
}
