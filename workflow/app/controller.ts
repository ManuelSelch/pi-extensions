import { enablement, steps, WorkflowDraft } from "../domain/config.ts";
import type { Snapshot, WorkflowStore } from "../infra/store.ts";

export interface Editing {
 snapshot: Snapshot;
 draft: WorkflowDraft;
}
export const contextWarning = "Prompts refresh on the next run. Previously read instructions remain in context; start a fresh session for a clean reset.";
const samePaths = (a: string[], b: string[]) => {
 const sorted = [...b].sort();
 return a.length === b.length && [...a].sort().every((p, i) => p === sorted[i]);
};

export class WorkflowController {
 private discovered: string[] | undefined;
 constructor(private readonly store: Pick<WorkflowStore, "load" | "resources" | "save">) {}
 async discover(cwd: string, trusted: boolean): Promise<string[]> {
  this.discovered = [];
  const snapshot = await this.store.load(cwd, trusted);
  const resources = await this.store.resources(snapshot.resolved);
  this.discovered = resources.skillPaths;
  return [...this.discovered];
 }
 async prompt(cwd: string, trusted: boolean): Promise<string> {
  return (await this.store.resources((await this.store.load(cwd, trusted)).resolved)).prompt;
 }
 async open(cwd: string, trusted: boolean, scope: "project" | "global"): Promise<Editing> {
  const snapshot = await this.store.load(cwd, trusted, scope, true);
  return { snapshot, draft: new WorkflowDraft(snapshot.config, enablement(snapshot.resolved), enablement(snapshot.inherited)) };
 }
 async save(editing: Editing): Promise<string> {
  const changed = await this.store.save(editing.snapshot, editing.draft.patch());
  return changed ? `Saved ${editing.snapshot.scope} workflow: ${editing.snapshot.file}\nSkill selection changes require /reload. ${contextWarning}` : "No workflow changes.";
 }
 async status(cwd: string, trusted: boolean): Promise<string> {
  const snapshot = await this.store.load(cwd, trusted);
  const lines = [`Workflow project: ${snapshot.file}${trusted ? "" : " (untrusted; ignored)"}`];
  for (const step of steps) {
   const value = snapshot.resolved[step];
   lines.push(`${step}: ${value.enabled ? "on" : "off"} (enabled: ${value.sources.enabled})`,
    `  prompt: ${value.prompt ?? "none"} (from ${value.sources.prompt})`,
    `  skills: ${value.skills.join(", ") || "none"} (from ${value.sources.skills})`);
  }
  try {
   const desired = (await this.store.resources(snapshot.resolved)).skillPaths;
   lines.push(`Configured workflow skills: ${desired.join(", ") || "none"}`);
   lines.push(`Last submitted to Pi discovery: ${this.discovered?.join(", ") || "none"}`);
   if (!this.discovered || !samePaths(desired, this.discovered)) lines.push("Skill discovery pending: run /reload.");
   else lines.push("Workflow skill selection submitted; native Pi diagnostics determine which skills loaded.");
  } catch (error) { lines.push(`Workflow unavailable: ${String(error)}`); }
  lines.push(contextWarning);
  return lines.join("\n");
 }
}
