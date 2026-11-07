import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowController } from "./app/controller.ts";
import { parseCommand } from "./domain/config.ts";
import { WorkflowStore } from "./infra/store.ts";
import { selectWorkflow } from "./ui/containers/selection.ts";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function workflowExtension(pi: ExtensionAPI): void {
 const controller = new WorkflowController(new WorkflowStore(getAgentDir()));
 const sessionOverrides = (ctx: { sessionManager?: { getBranch(): unknown[] } }): Record<string, boolean> => {
  const overrides: Record<string, boolean> = {};
  for (const item of ctx.sessionManager?.getBranch() ?? []) {
   const entry = item as { type?: string; customType?: string; details?: { changes?: Record<string, boolean | null> } };
   if (entry.type !== "custom_message" || entry.customType !== "workflow-session") continue;
   for (const [step, value] of Object.entries(entry.details?.changes ?? {})) {
    if (value === null) delete overrides[step];
    else if (typeof value === "boolean") overrides[step] = value;
   }
  }
  return overrides;
 };
 pi.on("resources_discover", async (_event, ctx) => {
  try { return { skillPaths: await controller.discover(ctx.cwd, ctx.isProjectTrusted()) }; }
  catch (error) { ctx.ui.notify(`Workflow unavailable: ${errorText(error)}`, "error"); return { skillPaths: [] }; }
 });
 pi.on("before_agent_start", async (event, ctx) => {
  // Repository dev types predate sections; the supported Pi runtime supplies it.
  const options = event.systemPromptOptions as typeof event.systemPromptOptions & { sections?: Record<string, string> };
  if (!options.sections) {
   ctx.ui.notify("Workflow requires a Pi runtime with structured system prompt sections.", "error");
   return;
  }
  try {
   const prompt = await controller.prompt(ctx.cwd, ctx.isProjectTrusted());
   if (prompt) options.sections.workflow = prompt;
   else delete options.sections.workflow;
  } catch (error) {
   const diagnostic = `Workflow unavailable: ${errorText(error)}`;
   options.sections.workflow = diagnostic;
   ctx.ui.notify(diagnostic, "error");
  }
 });
 pi.registerCommand("workflow", {
  description: "Select enabled workflow steps (project, global, session, status, preview)",
  getArgumentCompletions: prefix => ["project", "global", "session", "status", "preview"].filter(s => s.startsWith(prefix)).map(value => ({ value, label: value })),
  handler: async (args, ctx) => {
   try {
    const command = parseCommand(args);
    if (command === "status") { ctx.ui.notify(await controller.status(ctx.cwd, ctx.isProjectTrusted()), "info"); return; }
    if (command === "preview") { ctx.ui.notify(await controller.prompt(ctx.cwd, ctx.isProjectTrusted()) || "(No workflow prompt)", "info"); return; }
    if (!ctx.hasUI) { ctx.ui.notify("Workflow editing requires an interactive selection dialog.", "error"); return; }
    const editing = command === "session"
     ? await controller.openSession(ctx.cwd, ctx.isProjectTrusted(), sessionOverrides(ctx))
     : await controller.open(ctx.cwd, ctx.isProjectTrusted(), command);
    if (await selectWorkflow(ctx.ui, editing)) {
     if (command === "session") {
      if (editing.snapshot.writable && !ctx.isProjectTrusted()) throw new Error("Project trust changed; reopen workflow selection.");
      const changes = editing.draft.patch();
      if (!Object.keys(changes).length) { ctx.ui.notify("No workflow changes.", "info"); return; }
      const values = editing.draft.values();
      const messages: string[] = [];
      for (const step of Object.keys(changes)) {
       if (values[step]) {
        const prompt = await controller.sessionInstructions(editing.snapshot.resolved, step);
        messages.push(`Workflow step ${step} is now enabled.${prompt ? `\n\n${prompt}` : ""}`);
       } else messages.push(`Workflow step ${step} is now disabled. Do not follow its previous workflow instructions.`);
      }
      pi.sendMessage({ customType: "workflow-session", content: messages.join("\n\n"), display: false, details: { changes } }, { triggerTurn: false });
      ctx.ui.notify("Session workflow updated.", "info");
      return;
     }
     if (command === "project" && !ctx.isProjectTrusted()) throw new Error("Project workflow editing requires project trust.");
     ctx.ui.notify(await controller.save(editing), "info");
    }
   } catch (error) { ctx.ui.notify(errorText(error), "error"); }
  },
 });
}
