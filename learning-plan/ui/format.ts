import type { State, Status } from "../domain/plan.js";
const marks: Record<Status, string> = { pending: "○", active: "●", demonstrated: "✓" };
const line = (value: string): string => value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
export function widgetLines(state: State): string[] | undefined {
  if (!state.plan) return undefined;
  const { title, milestones } = state.plan;
  const done = milestones.filter(m => m.status === "demonstrated").length;
  let shown = [...milestones];
  while (shown.length > 8) {
    const doneIndex = shown.findIndex(m => m.status === "demonstrated");
    if (doneIndex < 0) break;
    shown.splice(doneIndex, 1);
  }
  if (shown.length > 8) {
    const active = shown.find(m => m.status === "active");
    shown = shown.slice(0, 8);
    if (active && !shown.includes(active)) shown[7] = active;
    shown.sort((a, b) => a.id - b.id);
  }
  const hidden = milestones.length - shown.length;
  return [
    `${line(title)} · ${done}/${milestones.length}`,
    ...shown.map(m => `${marks[m.status]} #${m.id} ${line(m.title)}`),
    ...(hidden ? [`… ${hidden} more · /learning-plan for full details`] : []),
  ];
}
export function fullPlan(state: State): string {
  if (!state.plan) return "No learning plan.";
  const plan = state.plan;
  return [
    `${plan.title} · ${plan.milestones.filter(m => m.status === "demonstrated").length}/${plan.milestones.length} demonstrated`,
    ...plan.milestones.map(m => [
      `${marks[m.status]} #${m.id} ${m.title} [${m.status}]`,
      `  Criterion: ${m.criterion}`,
      ...(m.evidence ? [`  Evidence: ${m.evidence}`] : []),
    ].join("\n")),
  ].join("\n");
}
