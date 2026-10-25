import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const StartParams = Type.Object({
  name: Type.String({ description: "Short preview name, e.g. Frontend" }),
  cwd: Type.String({ description: "Working directory for the preview" }),
  command: Type.String({ description: "Command to start the server, e.g. npm run dev" }),
  url: Type.String({ description: "Expected preview URL, e.g. http://localhost:5173" }),
});
const StopParams = Type.Object({ action: Type.Literal("stop") });

type PreviewConfig = { name: string; cwd: string; command: string; url: string };
type SavedPreview = PreviewConfig & { active: boolean };
type Preview = PreviewConfig & {
  status: "starting" | "running" | "stopped" | "failed";
  child?: ChildProcess;
};
const WIDGET = "Preview";
export const PREVIEW_STATE_ENTRY = "preview-state";

function isActive(current: Preview): boolean {
  return current.status === "starting" || current.status === "running";
}

/** Only JSON configuration is stored, never process handles or UI contexts. */
function snapshot(current: Preview): SavedPreview {
  const { name, cwd, command, url } = current;
  return { name, cwd, command, url, active: isActive(current) };
}

export function replayPreview(branch: Iterable<unknown>): SavedPreview | undefined {
  let saved: SavedPreview | undefined;
  for (const entry of branch) {
    const item = entry as { type?: string; customType?: string; data?: unknown } | null;
    if (item?.type !== "custom" || item.customType !== PREVIEW_STATE_ENTRY) continue;
    const data = item.data as Partial<SavedPreview> | null;
    if (!data || typeof data.active !== "boolean") continue;
    if (![data.name, data.cwd, data.command, data.url].every((value) => typeof value === "string" && value.trim())) continue;
    try {
      const url = new URL(data.url!);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    } catch { continue; }
    saved = { name: data.name!, cwd: data.cwd!, command: data.command!, url: data.url!, active: data.active };
  }
  return saved;
}

export function previewWidgetLines(current: Pick<Preview, "name" | "url" | "status"> | undefined): string[] | undefined {
  if (!current || (current.status !== "starting" && current.status !== "running")) return undefined;
  const name = current.name.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
  // Never allow a destination to terminate OSC 8 or inject terminal commands.
  if (!current.url || /[\x00-\x1f\x7f-\x9f]/.test(current.url)) return [name];
  try {
    const url = new URL(current.url);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return [name];
  } catch { return [name]; }
  return [`\x1b]8;;${current.url}\x1b\\${name}\x1b]8;;\x1b\\`];
}

function paint(ctx: ExtensionContext, current?: Preview) {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET, previewWidgetLines(current), { placement: "aboveEditor" });
}

function start(current: Preview, ctx: ExtensionContext): void {
  current.status = "starting";
  const child = spawn(current.command, {
    cwd: current.cwd,
    shell: true,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  current.child = child;
  child.once("error", () => {
    if (current.child !== child) return;
    current.status = "failed";
    current.child = undefined;
    paint(ctx, current);
  });
  child.once("exit", (code) => {
    if (current.child !== child) return;
    current.child = undefined;
    current.status = code === 0 ? "stopped" : "failed";
    paint(ctx, current);
  });
  void waitReady(current, child, ctx);
  paint(ctx, current);
}

async function waitReady(current: Preview, child: ChildProcess, ctx: ExtensionContext) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && current.child === child) {
    try {
      const response = await fetch(current.url, { signal: AbortSignal.timeout(1200) });
      // A pending probe may resolve after shutdown or session replacement.
      if (current.child !== child) return;
      if (response.ok || response.status < 500) {
        current.status = "running";
        paint(ctx, current);
        return;
      }
    } catch { /* Server not ready yet. */ }
    if (current.child !== child) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (current.child === child && current.status === "starting") {
    current.status = "running";
    paint(ctx, current);
  }
}

async function stop(current: Preview): Promise<void> {
  const child = current.child;
  current.child = undefined;
  current.status = "stopped";
  if (!child?.pid) return;
  const pid = child.pid;
  await new Promise<void>((done) => {
    // Install the exit listener before sending SIGTERM to avoid missing exit.
    const finish = () => {
      clearTimeout(timer);
      child.removeListener("exit", finish);
      done();
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* Already exited. */ }
      finish();
    }, 2500);
    child.once("exit", finish);
    try {
      if (process.platform !== "win32") process.kill(-pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { finish(); }
  });
}

export default function previewExtension(pi: ExtensionAPI) {
  // One preview per session, with no state shared between extension runtimes.
  const previews = new Map<string, Preview>();
  const id = (ctx: ExtensionContext) => ctx.sessionManager.getSessionId();
  const save = (current: Preview) => pi.appendEntry(PREVIEW_STATE_ENTRY, snapshot(current));

  pi.registerTool({
    name: "preview_start",
    label: "Start preview",
    description: "Start or reuse this session's managed preview. Active previews restart after reload; explicitly stopped previews stay stopped.",
    parameters: StartParams,
    async execute(_id, raw, _signal, _update, ctx) {
      let current = previews.get(id(ctx));
      const wasRunning = current && isActive(current);
      if (!wasRunning) {
        const args = raw as PreviewConfig;
        current = { ...args, cwd: resolve(ctx.cwd, args.cwd), status: "stopped" };
        previews.set(id(ctx), current);
        start(current, ctx);
        save(current);
      }
      return {
        content: [{ type: "text", text: `${wasRunning ? "Already running" : "Preview starting"}: ${current!.url}` }],
        details: { url: current!.url },
      };
    },
  });

  pi.registerTool({
    name: "preview_manage",
    label: "Stop preview",
    description: "Stop this session's managed preview. It stays stopped across reloads until started again.",
    parameters: StopParams,
    async execute(_id, _raw, _signal, _update, ctx) {
      const current = previews.get(id(ctx));
      if (!current) return { content: [{ type: "text", text: "No preview is registered." }], details: {}, isError: true };
      const stopping = stop(current);
      save(current);
      await stopping;
      paint(ctx, current);
      return { content: [{ type: "text", text: `${current.name} stopped` }], details: { status: current.status } };
    },
  });

  pi.registerCommand("preview", {
    description: "Start or stop this session's registered preview: /preview start | stop",
    getArgumentCompletions: (prefix) => ["start", "stop"]
      .filter((action) => action.startsWith(prefix.trim()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const current = previews.get(id(ctx));
      const action = args.trim();
      if (!current) {
        ctx.ui.notify("No preview is registered for this session. Start one with the preview_start tool first.", "error");
        return;
      }
      if (action === "start") {
        if (isActive(current)) {
          ctx.ui.notify(`${current.name} is already ${current.status}`, "info");
          return;
        }
        start(current, ctx);
        save(current);
        ctx.ui.notify(`Starting ${current.name} at ${current.url}`, "info");
      } else if (action === "stop") {
        const stopping = stop(current);
        save(current);
        await stopping;
        paint(ctx, current);
        ctx.ui.notify(`Stopped ${current.name}`, "info");
      } else {
        ctx.ui.notify("Usage: /preview start | stop", "error");
      }
    },
  });

  const restore = async (_event: unknown, ctx: ExtensionContext) => {
    const saved = replayPreview(ctx.sessionManager.getBranch());
    const previous = previews.get(id(ctx));
    if (previous) await stop(previous);
    previews.delete(id(ctx));
    if (!saved) { paint(ctx); return; }
    const { active, ...config } = saved;
    const current: Preview = { ...config, status: "stopped" };
    previews.set(id(ctx), current);
    if (active) start(current, ctx);
    else paint(ctx, current);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);

  pi.on("session_shutdown", async (_event, ctx) => {
    const current = previews.get(id(ctx));
    if (!current) { paint(ctx); return; }
    // Preserve intent BEFORE stopping for lifecycle cleanup. A reload or later
    // resume restarts active previews, but never ones explicitly stopped.
    save(current);
    await stop(current);
    previews.delete(id(ctx));
    paint(ctx);
  });
}
