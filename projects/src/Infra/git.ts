import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { ResolvedRepository } from "../Domain/catalogue.ts";

const execute = promisify(execFile);
export async function resolveRepository(cwd: string): Promise<ResolvedRepository> {
  const git = async (...args: string[]) => (await execute("git", ["-C", cwd, ...args], {
    timeout: 10_000, maxBuffer: 1024 * 1024,
  })).stdout;
  try {
    const path = realpathSync((await git("rev-parse", "--show-toplevel")).trim());
    const identity = realpathSync((await git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
    const primary = (await git("worktree", "list", "--porcelain", "-z")).split("\0")[0];
    if (!primary.startsWith("worktree ")) throw new Error("No primary checkout.");
    return { identity, path, defaultName: basename(primary.slice("worktree ".length)) };
  } catch {
    throw new Error("Cannot resolve a Git repository from this session cwd. Open a session inside a non-bare Git checkout and retry.");
  }
}
