import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const StartParams = Type.Object({
  name: Type.String({ description: "Short preview name, e.g. Frontend" }),
  cwd: Type.String({ description: "Working directory for the preview" }),
  command: Type.String({ description: "Command to start the server, e.g. npm run dev" }),
  url: Type.String({ description: "Expected preview URL, e.g. http://localhost:5173" }),
});
const ManageParams = Type.Object({
  action: Type.Union([Type.Literal("stop"), Type.Literal("list")]),
});

type Preview = {
  id: string; name: string; cwd: string; command: string; url: string;
  status: "starting" | "running" | "stopped" | "failed";
  child?: ChildProcess; startedAt?: number;
};
const previews = new Map<string, Preview>();
const WIDGET = "managed-previews";
function paint(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;
  const active = [...previews.values()].filter((p) => p.status === "starting" || p.status === "running");
  ctx.ui.setWidget(WIDGET, active.length ? active.flatMap((p) => [
    `${p.name} · ${p.status === "running" ? "Running" : "Starting"} · ${new URL(p.url).port || "default port"}`,
    `Open ↗ ${p.url} · /preview-stop`,
    `Directory: ${p.cwd}`,
  ]) : undefined, { placement: "aboveEditor" });
}

function start(preview: Preview, ctx: ExtensionContext): void {
  preview.status = "starting";
  const child = spawn(preview.command, {
    cwd: preview.cwd, shell: true, stdio: "ignore",
    detached: process.platform !== "win32",
  });
  preview.child = child;
  preview.startedAt = Date.now();
  child.once("error", (error) => {
    preview.status = "failed";
    preview.child = undefined;
    paint(ctx);
  });
  child.once("exit", (code, signal) => {
    if (preview.child !== child) return;
    preview.child = undefined;
    preview.status = code === 0 ? "stopped" : "failed";
    paint(ctx);
  });
  void waitReady(preview, child, ctx);
  paint(ctx);
}

async function waitReady(preview: Preview, child: ChildProcess, ctx: ExtensionContext) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && preview.child === child) {
    try {
      const response = await fetch(preview.url, { signal: AbortSignal.timeout(1200) });
      if (response.ok || response.status < 500) {
        preview.status = "running";
        paint(ctx);
        return;
      }
    } catch { /* Server not ready yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (preview.child === child && preview.status === "starting") {
    preview.status = "running";
    paint(ctx);
  }
}

async function stop(preview: Preview): Promise<void> {
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
  let preview = [...previews.values()].find((p) => p.name === args.name && p.cwd === cwd);
  if (preview && (preview.status === "starting" || preview.status === "running")) return preview;
  if (!preview) {
    preview = { id: randomUUID().slice(0, 8), name: args.name, cwd, command: args.command, url: args.url, status: "stopped" };
    previews.set(preview.id, preview);
  } else {
    preview.command = args.command;
    preview.url = args.url;
  }
  start(preview, ctx);
  return preview;
}

export default function previewExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "preview_start",
    label: "Start preview",
    description: "Start or reuse a managed preview. The same name and working directory reuse the existing preview rather than launching a duplicate.",
    parameters: StartParams,
    async execute(_id, raw, _signal, _update, ctx) {
      const args = raw as { name: string; cwd: string; command: string; url: string };
      const existing = [...previews.values()].find((p) => p.name === args.name && p.cwd === resolve(args.cwd));
      const preview = registerPreview(args, ctx);
      const verb = existing && (existing.status === "starting" || existing.status === "running") ? "Already managed" : "Preview starting";
      return { content: [{ type: "text", text: `${verb}: ${preview.id} ${preview.url} (${preview.status})` }], details: { id: preview.id, url: preview.url } };
    },
  });

  pi.registerTool({
    name: "preview_manage",
    label: "Manage preview",
    description: "List previews or stop the registered preview.",
    parameters: ManageParams,
    async execute(_id, raw, _signal, _update, ctx) {
      const args = raw as { action: "stop" | "list" };
      if (args.action === "list") {
        const list = [...previews.values()].map(({ id, name, cwd, url, status }) => ({ id, name, cwd, url, status }));
        paint(ctx);
        return { content: [{ type: "text", text: JSON.stringify(list) }], details: { previews: list } };
      }
      const preview = [...previews.values()][0];
      if (!preview) return { content: [{ type: "text", text: "No preview is registered." }], details: {}, isError: true };
      await stop(preview);
      paint(ctx);
      return { content: [{ type: "text", text: `${preview.name} stopped` }], details: { status: preview.status } };
    },
  });

  pi.registerCommand("preview-start", {
    description: "Start the preview registered for this session: /preview-start",
    handler: async (_args, ctx) => {
      const preview = [...previews.values()][0];
      if (!preview) {
        ctx.ui.notify("No preview is registered for this session. Start one with the preview_start tool first.", "error");
        return;
      }
      if (preview.status === "starting" || preview.status === "running") {
        ctx.ui.notify(`${preview.name} is already ${preview.status} (${preview.id})`, "info");
        return;
      }
      start(preview, ctx);
      ctx.ui.notify(`Starting ${preview.name} at ${preview.url} (${preview.id})`, "info");
    },
  });

  pi.registerCommand("preview-stop", {
    description: "Stop the registered preview",
    handler: async (_args, ctx) => {
      const preview = [...previews.values()][0];
      if (!preview) { ctx.ui.notify("No preview is registered.", "error"); return; }
      await stop(preview);
      paint(ctx);
      ctx.ui.notify(`Stopped ${preview.name}`, "info");
    },
  });

  pi.registerCommand("preview", {
    description: "Manage previews: /preview list | stop",
    getArgumentCompletions: (prefix) => ["list", "stop"]
      .filter((action) => action.startsWith(prefix.trim()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const action = args.trim() || "list";
      if (action === "stop") {
        const preview = [...previews.values()][0];
        if (!preview) { ctx.ui.notify("No preview is registered.", "error"); return; }
        await stop(preview);
        paint(ctx);
        ctx.ui.notify(`Stopped ${preview.name}`, "info");
        return;
      }
      const rows = [...previews.values()].map((p) => `${p.name} · ${p.status} · ${p.url} · ${p.cwd}`);
      ctx.ui.notify(rows.join("\n") || "No previews registered.", "info");
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await Promise.all([...previews.values()].map(stop));
    paint(ctx);
  });
}
