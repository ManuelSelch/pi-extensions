import type { Editing } from "../../app/controller.ts";
import { displayPath } from "../../app/display-path.ts";

export interface SelectionUI {
 select(title: string, options: string[]): Promise<string | undefined>;
}
/** Native single-select loop: stage several toggles before one atomic save. */
export async function selectWorkflow(ui: SelectionUI, editing: Editing): Promise<boolean> {
 const { snapshot, draft } = editing;
 for (;;) {
  const values = draft.values();
  const rows = Object.keys(values).map(s => ({ step: s, label: `[${values[s] ? "x" : " "}] ${s}` }));
  const options = rows.map(r => r.label);
  if (snapshot.scope !== "global") options.push("Restore");
  options.push("Save", "Cancel");
  const choice = await ui.select(snapshot.scope === "session" ? "Workflow session" : `Workflow ${snapshot.scope}: ${displayPath(snapshot.file)}`, options);
  if (choice === undefined || choice === "Cancel") return false;
  if (choice === "Save") return true;
  if (choice === "Restore" && snapshot.scope !== "global") draft.restore();
  else {
   const row = rows.find(r => r.label === choice);
   if (row) draft.toggle(row.step);
  }
 }
}
