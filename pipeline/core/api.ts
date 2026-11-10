import { Pipeline, projectRoot, type PipelineStatus } from "./pipeline.ts";
import { GitHubActions } from "./github.ts";

export type { PipelineStatus, SuiteStatus, RunResult, Config, ConfigSuite, Suite, JobSuite, JobDefinition, Prepare } from "./pipeline.ts";
export type { GitHubStatus, GitHubErrorKind, WorkflowStatus, JobStatus } from "./github.ts";

/**
 * Read-only local and GitHub status for arbitrary checkout paths.
 * Own one reader per consumer lifecycle; call stop() on shutdown/reload.
 * Remote caches are per canonical worktree, never module-global.
 */
export class PipelineStatusReader {
  private readonly github = new Map<string, GitHubActions>();
  private stopped = false;

  constructor(private readonly cacheRoot?: string) {}

  /** Force bypasses the remote TTL, but still shares any in-flight refresh. */
  async read(cwd: string, options: { force?: boolean } = {}): Promise<PipelineStatus> {
    this.assertLive();
    const root = await projectRoot(cwd);
    this.assertLive(); // Disposal may happen while Git/realpath resolves the cwd.
    let reader = this.github.get(root);
    if (!reader) {
      reader = new GitHubActions(root);
      this.github.set(root, reader);
    }
    const [local, github] = await Promise.all([new Pipeline(root, this.cacheRoot).status(), reader.read(options)]);
    this.assertLive(); // Never publish a cancelled lifecycle's late results.
    return { ...local, ...(github ? { github } : {}) };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const reader of this.github.values()) reader.stop();
    this.github.clear();
  }

  private assertLive(): void {
    if (this.stopped) throw new Error("Pipeline status reader is stopped. Create a new reader for the new lifecycle.");
  }
}
