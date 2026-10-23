import { stat } from "node:fs/promises";
import { PipelineStatusReader, type PipelineStatus } from "../../../pipeline/api.ts";

/** Session-owned public API adapter. Does not register UI or execute suites. */
export class ProjectPipelineReader {
  private readonly reader = new PipelineStatusReader();
  async read(path: string): Promise<PipelineStatus> {
    if (!(await stat(path)).isDirectory()) throw new Error(`Checkout is not a directory: ${path}`);
    return this.reader.read(path);
  }
  stop(): void { this.reader.stop(); }
}
