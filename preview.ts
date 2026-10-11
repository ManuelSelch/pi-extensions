import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";

const Params = Type.Object({
  command: Type.String({ description: "Command to start the preview server, e.g. npm run dev" }),
  url: Type.String({ description: "URL where the preview will be available, e.g. http://localhost:3000" }),
  cwd: Type.Optional(Type.String({ description: "Working directory (defaults to the current project)" })),
});

let server: ChildProcess | undefined;
let previewUrl: string | undefined;
const widget = "preview-server";

function paint(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(widget, server && previewUrl
    ? [`Preview: ${previewUrl}`, "Stop: /preview-stop"]
    : undefined, { placement: "aboveEditor" });
}

export default function previewExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "preview_start",
    label: "Start preview",
    description: "Start a local preview server and show its URL in a Pi widget. Replaces any currently running preview.",
    parameters: Params,
    async execute(_id, params, _signal, _update, ctx) {
      if (server) {
        server.kill("SIGTERM");
        server = undefined;
      }
      const args = params as { command: string; url: string; cwd?: string };
      const child = spawn(args.command, { cwd: args.cwd, shell: true, stdio: "ignore", detached: process.platform !== "win32" });
      server = child;
      previewUrl = args.url;
      child.once("exit", () => {
        if (server === child) {
          server = undefined;
          previewUrl = undefined;
          paint(ctx);
        }
      });
      paint(ctx);
      return { content: [{ type: "text", text: `Preview started: ${args.url}` }], details: {} };
    },
  });

  const stop = (ctx: ExtensionContext) => {
    if (server) {
      if (process.platform !== "win32" && server.pid) process.kill(-server.pid, "SIGTERM");
      else server.kill("SIGTERM");
      server = undefined;
      previewUrl = undefined;
    }
    paint(ctx);
  };
  pi.registerCommand("preview-stop", {
    description: "Stop the running preview server",
    handler: async (_args, ctx) => {
      stop(ctx);
      ctx.ui.notify("Preview stopped", "info");
    },
  });
  pi.on("session_shutdown", async (_event, ctx) => stop(ctx));
}
