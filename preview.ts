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

type Preview = {
  name: string;
  cwd: string;
  command: string;
  url: string;
  status: "starting" | "running" | "stopped" | "failed";
  child?: ChildProcess;
};
// One managed preview belongs to this extension/session.
let preview: Preview | undefined;
const WIDGET = "Preview";

export function previewWidgetLines(current: Pick<Preview, "name" | "url" | "status"> | undefined): string[] | undefined {
  if (!current || (current.status !== "starting" && current.status !== "running")) return undefined;
  const name = current.name.replace(/[\\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
  return [`[${name}](${current.url})`];
}

function paint(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET, previewWidgetLines(preview), { placement: "aboveEditor" });
}

function start(ctx: ExtensionContext): void {
  if (!preview) return;
  preview.status = "starting";
  const child = spawn(preview.command, {
    cwd: preview.cwd,
    shell: true,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  preview.child = child;
  child.once("error", () => {
    if (preview?.child !== child) return;
    preview.status = "failed";
    preview.child = undefined;
    paint(ctx);
  });
  child.once("exit", (code) => {
    if (preview?.child !== child) return;
    preview.child = undefined;
    preview.status = code === 0 ? "stopped" : "failed";
    paint(ctx);
  });
  void waitReady(preview, child, ctx);
  paint(ctx);
}

async function waitReady(current: Preview, child: ChildProcess, ctx: ExtensionContext) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && current.child === child) {
    try {
      const response = await fetch(current.url, { signal: AbortSignal.timeout(1200) });
      if (response.ok || response.status < 500) {
        current.status = "running";
        paint(ctx);
        return;
      }
    } catch { /* Server not ready yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (current.child === child && current.status === "starting") {
    current.status = "running";
    paint(ctx);
  }
}

async function stop(): Promise<void> {
  if (!preview) return;
  const child = preview.child;
  if (!child) { preview.status = "stopped"; return; }
  preview.child = undefined;
  if (child.pid) {
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { /* Already exited. */ }
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { /* Already exited. */ }
        done();
      }, 2500);
      child.once("exit", () => { clearTimeout(timer); done(); });
    });
  }
  preview.status = "stopped";
}

function registerPreview(args: { name: string; cwd: string; command: string; url: string }, ctx: ExtensionContext): Preview {
  const cwd = resolve(args.cwd);
  if (preview && (preview.status === "starting" || preview.status === "running")) return preview;
  preview = { ...args, cwd, status: "stopped" };
  start(ctx);
  return preview;
}

export default function previewExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "preview_start",
    label: "Start preview",
    description: "Start or reuse this session's managed preview. Repeated calls won't launch a duplicate while it is starting or running.",
    parameters: StartParams,
    async execute(_id, raw, _signal, _update, ctx) {
      const wasRunning = preview && (preview.status === "starting" || preview.status === "running");
      const managed = registerPreview(raw as { name: string; cwd: string; command: string; url: string }, ctx);
      return {
        content: [{ type: "text", text: `${wasRunning ? "Already running" : "Preview starting"}: ${managed.url}` }],
        details: { url: managed.url },
      };
    },
  });

  pi.registerTool({
    name: "preview_manage",
    label: "Stop preview",
    description: "Stop this session's managed preview.",
    parameters: StopParams,
    async execute(_id, _raw, _signal, _update, ctx) {
      if (!preview) return { content: [{ type: "text", text: "No preview is registered." }], details: {}, isError: true };
      await stop();
      paint(ctx);
      return { content: [{ type: "text", text: `${preview.name} stopped` }], details: { status: preview.status } };
    },
  });

  pi.registerCommand("preview", {
    description: "Start or stop this session's registered preview: /preview start | stop",
    getArgumentCompletions: (prefix) => ["start", "stop"]
      .filter((action) => action.startsWith(prefix.trim()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const action = args.trim();
      if (!preview) {
        ctx.ui.notify("No preview is registered for this session. Start one with the preview_start tool first.", "error");
        return;
      }
      if (action === "start") {
        if (preview.status === "starting" || preview.status === "running") {
          ctx.ui.notify(`${preview.name} is already ${preview.status}`, "info");
          return;
        }
        start(ctx);
        ctx.ui.notify(`Starting ${preview.name} at ${preview.url}`, "info");
      } else if (action === "stop") {
        await stop();
        paint(ctx);
        ctx.ui.notify(`Stopped ${preview.name}`, "info");
      } else {
        ctx.ui.notify("Usage: /preview start | stop", "error");
      }
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await stop();
    paint(ctx);
  });
}
