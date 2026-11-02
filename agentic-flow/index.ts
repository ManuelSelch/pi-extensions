/**
 * Agentic Flow Extension
 *
 * Foundation for a discuss → plan → implement → review workflow.
 *
 * Planned commands:
 * - /implement <target>: start a clean session focused on one commit-sized implementation task.
 * - /review <target>: start a clean session focused on structured review of one implementation target.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getTodoStateFromBranch, summary as todoSummary, TODO_SNAPSHOT_ENTRY, todoSnapshot, type TodoState } from "../todo/index.ts";

const EXT_ID = "agentic-flow";

export type FlowCommand = "implement" | "review";

export function normalizeTarget(args: string): string {
	return args.trim();
}

export function requireTarget(command: FlowCommand, args: string): string {
	const target = normalizeTarget(args);
	if (!target) {
		throw new Error(`/${command} requires a target, e.g. /${command} todo 2`);
	}
	return target;
}

export function carriedTodosSection(state: TodoState): string {
	if (state.todos.length === 0) return "";
	return `

Carried todo state from previous session:
${todoSummary(state)}`;
}

export function buildImplementPrompt(target: string, carriedTodos: TodoState = { todos: [], nextId: 1 }): string {
	return `Implement this target in a fresh clean session.

Target:
${target}${carriedTodosSection(carriedTodos)}

Workflow:
1. Inspect the current repository state and relevant files first.
2. Confirm the precise scope before editing if the target is ambiguous or too large.
3. Implement only this target; keep it one small commit-sized task.
4. Add or update tests when appropriate.
5. Run the relevant tests/checks.
6. Commit the change at the end with a clear commit message.

Rules:
- Do not bundle unrelated cleanup or follow-up work.
- If tests fail and cannot be fixed within this target's scope, do not commit; report the blocker.
- If the working tree already contains unrelated user changes, preserve them and avoid overwriting them.`;
}

export function buildReviewPrompt(target: string, carriedTodos: TodoState = { todos: [], nextId: 1 }): string {
	return `Review this implementation target in a fresh clean session.

Target:
${target}${carriedTodosSection(carriedTodos)}

Review checklist:
1. Behavior: does the implementation satisfy the requested change?
2. Tests: are relevant tests added or updated, meaningful, and passing?
3. Regressions: could this break existing behavior or workflows?
4. Architecture: does it fit the project's patterns, boundaries, and conventions?
5. Simplicity: is the solution appropriately small and maintainable?
6. Error handling and edge cases: are important failure modes covered?
7. Security and data safety: note risks when relevant.
8. Commit quality: review diff hygiene, scope, and commit message quality.

Rules:
- Review only; do not modify files unless explicitly asked.
- Inspect the relevant diff, commit(s), tests, and surrounding code before concluding.
- Prefer concrete findings with file paths and actionable fixes.
- If there are no major issues, say so clearly.

Output:
- Summary verdict
- Findings ordered by severity
- Missing or weak tests
- Suggested fixes
- Merge/keep recommendation`;
}

const MAX_CONTINUATIONS = 2;
const STATUS_INSTRUCTIONS = `When ending a response, put exactly one status on its own final line:
[agentic-flow: done] if the user's request is complete;
[agentic-flow: blocked] if you need user input, approval, or cannot safely proceed;
[agentic-flow: not-finished] only if work remains and you can proceed without user input.
Never mark a required approval, cancellation, or blocker as not-finished.`;

export default function agenticFlowExtension(pi: ExtensionAPI): void {
	let continuations = 0;
	pi.on("before_agent_start", (event) => {
		continuations = 0;
		const options = event.systemPromptOptions as typeof event.systemPromptOptions & { sections?: Record<string, string> };
		if (options.sections) options.sections.agentic_flow = STATUS_INSTRUCTIONS;
	});

	pi.on("agent_before_settle", (event, ctx) => {
		const last = event.context.contextMessages.at(-1);
		const assistant = event.context.contextMessages.findLast(message => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") return;
		const text = assistant.content.filter(part => part.type === "text").map(part => part.text).join("\n");
		if (!/(?:^|\n)\[agentic-flow: not-finished\]\s*$/.test(text)) return;
		if (event.outcome !== "completed" || event.continue || event.context.pendingMessages.length || last !== assistant || assistant.stopReason !== "stop") {
			ctx.ui.notify(`Agentic flow: unfinished marker not continued (outcome=${event.outcome}, alreadyContinuing=${event.continue}, pending=${event.context.pendingMessages.length}, lastRole=${last?.role ?? "none"}, stopReason=${assistant.stopReason}).`, "warning");
			return;
		}
		if (continuations >= MAX_CONTINUATIONS) {
			ctx.ui.notify(`Agentic flow: continuation limit (${MAX_CONTINUATIONS}) reached.`, "warning");
			return;
		}
		continuations++;
		ctx.ui.notify(`Agentic flow: continuing unfinished work (${continuations}/${MAX_CONTINUATIONS}).`, "info");
		return {
			entries: [...event.entries, {
				type: "custom_message" as const,
				customType: "agentic-flow-continuation",
				content: "Continue the original request. Finish remaining work and verification; stop if user input or approval is needed.",
				display: true,
			}],
			continue: true,
		};
	});
	pi.registerCommand("implement", {
		description: "Start a clean session to implement one small target and commit it",
		handler: async (args, ctx) => {
			let target: string;
			try {
				target = requireTarget("implement", args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			await ctx.waitForIdle();

			const parentSession = ctx.sessionManager.getSessionFile();
			const todos = todoSnapshot(getTodoStateFromBranch(ctx.sessionManager.getBranch()));
			const prompt = buildImplementPrompt(target, todos);

			const result = await ctx.newSession({
				parentSession,
				setup: async (session) => {
					if (todos.todos.length > 0) session.appendCustomEntry(TODO_SNAPSHOT_ENTRY, todos);
				},
				withSession: async (newCtx) => {
					await newCtx.sendUserMessage(prompt);
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("Implement session creation was cancelled.", "error");
			}
		},
	});

	pi.registerCommand("review", {
		description: "Start a clean session to review one implementation target",
		handler: async (args, ctx) => {
			let target: string;
			try {
				target = requireTarget("review", args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			await ctx.waitForIdle();

			const parentSession = ctx.sessionManager.getSessionFile();
			const todos = todoSnapshot(getTodoStateFromBranch(ctx.sessionManager.getBranch()));
			const prompt = buildReviewPrompt(target, todos);

			const result = await ctx.newSession({
				parentSession,
				setup: async (session) => {
					if (todos.todos.length > 0) session.appendCustomEntry(TODO_SNAPSHOT_ENTRY, todos);
				},
				withSession: async (newCtx) => {
					await newCtx.sendUserMessage(prompt);
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("Review session creation was cancelled.", "error");
			}
		},
	});

	pi.registerCommand("agentic-flow", {
		description: "Show the agentic coding workflow commands",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"Agentic flow: continuation diagnostics enabled; discuss normally, use /plan, then /implement <target>, then /review <target>.",
				"info",
			);
		},
	});
}

export { EXT_ID };
