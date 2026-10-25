import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type App = { command: string; args: string[] };
type Config = { apps: Record<string, App> };
type Placeholders = { cwd: string; primaryRepo: string };
const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-open.json");
const CWD_TOKEN = "{cwd}";
const PRIMARY_REPO_TOKEN = "{primaryRepo}";

function git(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });
}

async function resolvePrimaryRepo(cwd: string): Promise<string | undefined> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!root) return undefined;
  const listing = await git(root, ["worktree", "list", "--porcelain"]);
  const primary = listing
    ?.split(/\r?\n/)
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  return primary || root;
}

function substitute(arg: string, placeholders: Placeholders): string {
  return arg.replaceAll(CWD_TOKEN, placeholders.cwd).replaceAll(PRIMARY_REPO_TOKEN, placeholders.primaryRepo);
}

function loadConfig(): Config {
  const value: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!value || typeof value !== "object" || !("apps" in value) || !value.apps || typeof value.apps !== "object" || Array.isArray(value.apps)) {
    throw new Error('Expected an object with an "apps" map');
  }
  const apps: Record<string, App> = {};
  for (const [name, rawApp] of Object.entries(value.apps)) {
    const app = rawApp as { command?: unknown; args?: unknown };
    if (!name.trim() || !app || typeof app !== "object" || typeof app.command !== "string" || !app.command.trim() || !Array.isArray(app.args) || !app.args.every((arg: unknown) => typeof arg === "string")) {
      throw new Error(`Invalid app definition: ${name}`);
    }
    apps[name] = { command: app.command, args: app.args as string[] };
  }
  return { apps };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("open", {
    description: "Open the current working directory in a configured app",
    getArgumentCompletions(argumentPrefix) {
      try {
        return Object.keys(loadConfig().apps)
          .filter((name) => name.startsWith(argumentPrefix))
          .map((name) => ({ value: name, label: name }));
      } catch {
        return null;
      }
    },
    async handler(args, ctx) {
      const name = args.trim().split(/\s+/, 1)[0];
      if (!name) {
        ctx.ui.notify("Usage: /open <app>", "warning");
        return;
      }
      let app: App | undefined;
      try {
        app = loadConfig().apps[name];
      } catch (error) {
        ctx.ui.notify(`Could not read ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      if (!app) {
        ctx.ui.notify(`Unknown app "${name}". Configure it in ${CONFIG_PATH}.`, "error");
        return;
      }
      const usesPrimaryRepo = app.args.some((arg) => arg.includes(PRIMARY_REPO_TOKEN));
      const primaryRepo = usesPrimaryRepo ? await resolvePrimaryRepo(ctx.cwd) : undefined;
      if (usesPrimaryRepo && !primaryRepo) {
        ctx.ui.notify(`Could not resolve the primary repository from ${ctx.cwd}.`, "error");
        return;
      }
      const placeholders: Placeholders = { cwd: ctx.cwd, primaryRepo: primaryRepo ?? ctx.cwd };
      const spawnCwd = usesPrimaryRepo ? primaryRepo! : ctx.cwd;
      try {
        const child = spawn(app.command, app.args.map((arg) => substitute(arg, placeholders)), {
          cwd: spawnCwd,
          detached: true,
          stdio: "ignore",
          shell: false,
        });
        child.once("error", (error) => ctx.ui.notify(`Could not open ${name}: ${error.message}`, "error"));
        child.once("exit", (code) => {
          if (code !== 0 && code !== null) ctx.ui.notify(`Opening ${name} failed with exit code ${code}.`, "error");
        });
        child.unref();
      } catch (error) {
        ctx.ui.notify(`Could not open ${name}: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
