import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyAction, replay } from "../domain/plan.js";
import type { Params, State } from "../domain/plan.js";
import { fullPlan, widgetLines } from "../ui/format.js";

const enumString = (values: string[], description: string) =>
  Type.Unsafe<string>({ type: "string", enum: values, description });
const titleGuidance = "Keep milestone titles short: aim for 3–6 words, ideally under 40 characters. Put detailed learning objectives in the criterion.";
const parameters = Type.Object({
  action: enumString(["create", "get", "update", "add"], "Create a plan, get full details, update milestones atomically, or append a milestone."),
  title: Type.Optional(Type.String({ description: `Plan title for create; milestone title for add. ${titleGuidance}`, maxLength: 160 })),
  criterion: Type.Optional(Type.String({ description: "Completion criterion for add.", maxLength: 1000 })),
  milestones: Type.Optional(Type.Array(Type.Object({
    title: Type.String({ description: titleGuidance, maxLength: 160 }),
    criterion: Type.String({ description: "What the learner must independently explain and apply.", maxLength: 1000 }),
  }), { minItems: 1, maxItems: 50 })),
  updates: Type.Optional(Type.Array(Type.Object({
    id: Type.Integer({ minimum: 1 }),
    status: Type.Optional(enumString(["pending", "active", "demonstrated"], "Milestone status.")),
    evidence: Type.Optional(Type.String({ description: "Brief assessment evidence, including assistance or unresolved confusion. Required for demonstration or reopening.", maxLength: 2000 })),
  }), { minItems: 1, maxItems: 50 })),
});

export default function learningPlanExtension(pi: ExtensionAPI): void {
  const sessions = new Map<string, State>();
  const id = (ctx: ExtensionContext) => ctx.sessionManager.getSessionId();
  const paint = (ctx: ExtensionContext, state: State) => {
    if (ctx.hasUI) ctx.ui.setWidget("learning-plan", widgetLines(state), { placement: "aboveEditor" });
  };
  const restore = (ctx: ExtensionContext): State => {
    const state = replay(ctx.sessionManager.getBranch());
    sessions.set(id(ctx), state);
    paint(ctx, state);
    return state;
  };
  const reload = async (_event: unknown, ctx: ExtensionContext): Promise<void> => { restore(ctx); };
  pi.on("session_start", reload);
  pi.on("session_tree", reload);
  pi.on("session_compact", reload);
  pi.on("session_shutdown", async (_event, ctx) => { sessions.delete(id(ctx)); });

  pi.registerTool({
    name: "learning_plan",
    label: "Learning plan",
    description: "Track learner understanding in a session-backed milestone list. create(title, milestones), get, update(updates), add(title, criterion). Completion requires assessment evidence, not just teaching a topic. One active milestone; batch transitions atomically.",
    executionMode: "sequential",
    promptSnippet: "Keep an evidence-based milestone plan while teaching",
    promptGuidelines: [
      titleGuidance,
      "Use learning_plan for learning milestones, not todo. Retrieve it before creating or resuming a teaching plan.",
      "Activate the current milestone before teaching. After assessment and before the next question, update changed evidence or status.",
      "Mark demonstrated only after sound explanation and a materially different application without a revealing hint. Record assistance honestly.",
      "Cancellation is not evidence. Preserve incomplete milestones on pause; reopen demonstrated understanding with a reason if later evidence contradicts it.",
      "This tool stores assessments, but does not grade answers. Do not create or expand a plan outside the learner's agreed scope.",
    ],
    parameters,
    async execute(_callId, params, _signal, _onUpdate, ctx) {
      const current = sessions.get(id(ctx)) ?? restore(ctx);
      let next: State;
      try {
        next = applyAction(current, params as Params);
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          details: structuredClone(current), isError: true };
      }
      sessions.set(id(ctx), next);
      paint(ctx, next);
      return { content: [{ type: "text", text: fullPlan(next) }], details: structuredClone(next) };
    },
  });
  pi.registerCommand("learning-plan", {
    description: "Show this session's learning milestones, completion criteria and assessment evidence",
    handler: async (_args, ctx) => { ctx.ui.notify(fullPlan(restore(ctx)), "info"); },
  });
}
