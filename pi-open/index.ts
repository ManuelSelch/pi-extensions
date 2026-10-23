import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type App = { command: string; args: string[] };
type Config = { apps: Record<string, App> };
const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-open.json");

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
      try {
        const child = spawn(app.command, app.args.map((arg) => arg.replaceAll("{cwd}", ctx.cwd)), {
          cwd: ctx.cwd,
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
