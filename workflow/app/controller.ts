import { enablement, WorkflowDraft } from "../domain/config.ts";
import type { Enabled, Resolved } from "../domain/config.ts";
import type { Snapshot, WorkflowStore } from "../infra/store.ts";
import { displayPath } from "./display-path.ts";

export interface Editing {
 snapshot: Omit<Snapshot, "scope"> & { scope: "project" | "global" | "session" };
 draft: WorkflowDraft;
}
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
 async openSession(cwd: string, trusted: boolean, overrides: Enabled): Promise<Editing> {
  const snapshot = await this.store.load(cwd, trusted);
  const base = enablement(snapshot.resolved);
  const config = { steps: Object.fromEntries(Object.entries(overrides).map(([name, enabled]) => [name, { enabled }])) };
  const current = { ...base, ...overrides };
  return { snapshot: { ...snapshot, scope: "session" }, draft: new WorkflowDraft(config, current, base) };
 }
 async sessionInstructions(resolved: Resolved, step: string): Promise<string> {
  return (await this.store.resources({ [step]: { ...resolved[step], enabled: true } })).prompt;
 }
 async save(editing: Editing): Promise<string> {
  if (editing.snapshot.scope === "session") throw new Error("Session changes cannot be saved to a file.");
  const changed = await this.store.save(editing.snapshot as Snapshot, editing.draft.patch());
  return changed ? `Saved: ${displayPath(editing.snapshot.file)}` : "No workflow changes.";
 }
 async status(cwd: string, trusted: boolean): Promise<string> {
  const snapshot = await this.store.load(cwd, trusted);
  const lines = [`Workflow project: ${displayPath(snapshot.file)}${trusted ? "" : " (untrusted; ignored)"}`];
  for (const step of Object.keys(snapshot.resolved)) {
   const value = snapshot.resolved[step];
   lines.push(`${step}: ${value.enabled ? "on" : "off"}`,
    `  prompt: ${value.prompt === null ? "none" : displayPath(value.prompt)}`,
    `  skills: ${value.skills.map(displayPath).join(", ") || "none"}`);
  }
  try {
   const desired = (await this.store.resources(snapshot.resolved)).skillPaths;
   lines.push(`Configured workflow skills: ${desired.map(displayPath).join(", ") || "none"}`);
   lines.push(`Last submitted to Pi discovery: ${this.discovered?.map(displayPath).join(", ") || "none"}`);
   if (!this.discovered || !samePaths(desired, this.discovered)) lines.push("Skill discovery pending: run /reload.");
  } catch (error) { lines.push(`Workflow unavailable: ${String(error)}`); }
  return lines.join("\n");
 }
}
