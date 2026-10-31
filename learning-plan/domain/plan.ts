export type Status = "pending" | "active" | "demonstrated";
export interface Milestone {
  id: number;
  title: string;
  criterion: string;
  status: Status;
  evidence?: string;
}
export interface Plan { title: string; milestones: Milestone[]; nextId: number }
export interface State { plan: Plan | null }
export interface Params {
  action: "create" | "get" | "update" | "add";
  title?: string;
  criterion?: string;
  milestones?: { title: string; criterion: string }[];
  updates?: { id: number; status?: Status; evidence?: string }[];
}
const statuses = new Set(["pending", "active", "demonstrated"]);
export function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`${name} must be nonempty and at most ${max} characters.`);
  return value.trim();
}
function milestone(value: { title: string; criterion: string }, id: number): Milestone {
  return { id, title: text(value.title, "Milestone title", 160),
    criterion: text(value.criterion, "Completion criterion", 1000), status: "pending" };
}
export function applyAction(state: State, params: Params): State {
  if (params.action === "get") return state;
  if (params.action === "create") {
    if (state.plan) throw new Error("A learning plan already exists. Continue it or start a new session.");
    if (!Array.isArray(params.milestones) || params.milestones.length < 1 || params.milestones.length > 50)
      throw new Error("create needs 1–50 milestones with titles and completion criteria.");
    return { plan: { title: text(params.title, "Plan title", 160),
      milestones: params.milestones.map((m, i) => milestone(m, i + 1)), nextId: params.milestones.length + 1 } };
  }
  if (!state.plan) throw new Error("No learning plan. Create one first.");
  const plan = structuredClone(state.plan);
  if (params.action === "add") {
    if (plan.milestones.length >= 50) throw new Error("A plan supports at most 50 milestones.");
    plan.milestones.push(milestone({ title: params.title!, criterion: params.criterion! }, plan.nextId++));
  } else if (params.action === "update") {
    if (!Array.isArray(params.updates) || !params.updates.length) throw new Error("update needs milestone updates.");
    const seen = new Set<number>();
    for (const update of params.updates) {
      if (!update || !Number.isSafeInteger(update.id)) throw new Error("A valid milestone id is required.");
      if (seen.has(update.id)) throw new Error(`Duplicate update for #${update.id}.`);
      seen.add(update.id);
      const target = plan.milestones.find(m => m.id === update.id);
      if (!target) throw new Error(`No milestone #${update.id}.`);
      if (update.status === undefined && update.evidence === undefined) throw new Error("update needs status or evidence.");
      if (update.status !== undefined && !statuses.has(update.status)) throw new Error("Invalid milestone status.");
      const reopening = target.status === "demonstrated" && update.status !== undefined && update.status !== "demonstrated";
      if (update.status === "demonstrated" || reopening) text(update.evidence, "Assessment evidence", 2000);
      if (update.evidence !== undefined) target.evidence = text(update.evidence, "Assessment evidence", 2000);
      if (update.status !== undefined) target.status = update.status;
    }
    if (plan.milestones.filter(m => m.status === "active").length > 1)
      throw new Error("Only one milestone may be active. Update both statuses in one batch.");
  } else throw new Error("Unknown learning_plan action.");
  return { plan };
}

/** Validate snapshots without repairing or migrating malformed history. */
export function snapshot(value: unknown): State | undefined {
  if (!value || typeof value !== "object" || !("plan" in value)) return;
  const plan = (value as State).plan;
  if (plan === null) return { plan: null };
  try {
    if (!plan || !Array.isArray(plan.milestones) || !plan.milestones.length || plan.milestones.length > 50) return;
    text(plan.title, "Plan title", 160);
    const ids = new Set<number>();
    for (const m of plan.milestones) {
      if (!m || !Number.isSafeInteger(m.id) || m.id < 1 || ids.has(m.id) || !statuses.has(m.status)) return;
      ids.add(m.id);
      text(m.title, "Milestone title", 160);
      text(m.criterion, "Completion criterion", 1000);
      if (m.evidence !== undefined) text(m.evidence, "Assessment evidence", 2000);
      if (m.status === "demonstrated" && !m.evidence) return;
    }
    if (!Number.isSafeInteger(plan.nextId) || plan.nextId <= Math.max(...ids)) return;
    if (plan.milestones.filter(m => m.status === "active").length > 1) return;
    return structuredClone(value as State);
  } catch { return; }
}
export function replay(branch: Iterable<unknown>): State {
  let state: State = { plan: null };
  for (const raw of branch) {
    const entry = raw as { type?: string; message?: { role?: string; toolName?: string; details?: unknown; isError?: boolean } };
    if (entry?.type !== "message" || entry.message?.role !== "toolResult" ||
        entry.message.toolName !== "learning_plan" || entry.message.isError) continue;
    const next = snapshot(entry.message.details);
    if (next) state = next;
  }
  return state;
}
