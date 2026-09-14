import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const QuestionSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Stable answer key. Defaults to q1, q2, ..." })),
	prompt: Type.String({ description: "Question shown to the user" }),
	type: Type.Optional(
		Type.Union([
			Type.Literal("select"),
			Type.Literal("input"),
			Type.Literal("confirm"),
			Type.Literal("text"),
		], {
			description: "UI control type. Defaults to select when options are present, otherwise input.",
		}),
	),
	options: Type.Optional(Type.Array(Type.String(), { description: "Choices for select questions" })),
	allowOther: Type.Optional(Type.Boolean({ description: "For select questions, allow a custom typed answer" })),
	placeholder: Type.Optional(Type.String({ description: "Placeholder for input questions" })),
	prefill: Type.Optional(Type.String({ description: "Initial content for text editor questions" })),
	detail: Type.Optional(Type.String({ description: "Additional text shown for confirm questions" })),
});

const AskUserParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description: "Questions to ask the user in order",
		minItems: 1,
	}),
});

type Question = {
	id?: string;
	prompt: string;
	type?: "select" | "input" | "confirm" | "text";
	options?: string[];
	allowOther?: boolean;
	placeholder?: string;
	prefill?: string;
	detail?: string;
};

type Answer = {
	id: string;
	prompt: string;
	type: "select" | "input" | "confirm" | "text";
	answer: string | boolean | null;
	cancelled: boolean;
	wasCustom?: boolean;
};

function inferType(question: Question): "select" | "input" | "confirm" | "text" {
	if (question.type) return question.type;
	return question.options && question.options.length > 0 ? "select" : "input";
}

function makeToolResult(answers: Answer[], cancelled: boolean, error?: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: error
					? `Error: ${error}`
					: cancelled
						? `User cancelled. Answers so far: ${JSON.stringify(answers)}`
						: `User answered: ${JSON.stringify(Object.fromEntries(answers.map((a) => [a.id, a.answer])))}`,
			},
		],
		details: { answers, cancelled, error },
	};
}

export default function askUserExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user one or more questions using interactive UI controls: select, input, confirm, or multi-line text editor. Use when you need a decision or missing information before continuing.",
		parameters: AskUserParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// `hasUI` is true in TUI *and* RPC mode. Pi Chat binds a web UI context
			// in "rpc" mode, so guarding on `mode === "tui"` would wrongly refuse it.
			if (!ctx.hasUI) {
				return makeToolResult([], true, "No dialog-capable UI available (non-interactive mode)");
			}

			const answers: Answer[] = [];

			for (let index = 0; index < params.questions.length; index++) {
				const question = params.questions[index] as Question;
				const id = question.id || `q${index + 1}`;
				const type = inferType(question);

				if (type === "select") {
					const options = question.options || [];
					if (options.length === 0) {
						return makeToolResult(answers, true, `Question '${id}' is select but has no options`);
					}

					const otherLabel = "Other…";
					const displayOptions = question.allowOther ? [...options, otherLabel] : options;
					const selected = await ctx.ui.select(question.prompt, displayOptions);

					if (selected === undefined) {
						answers.push({ id, prompt: question.prompt, type, answer: null, cancelled: true });
						return makeToolResult(answers, true);
					}

					if (question.allowOther && selected === otherLabel) {
						const custom = await ctx.ui.input(question.prompt, question.placeholder || "Type your answer…");
						answers.push({
							id,
							prompt: question.prompt,
							type,
							answer: custom ?? null,
							cancelled: custom === undefined,
							wasCustom: true,
						});
						if (custom === undefined) return makeToolResult(answers, true);
					} else {
						answers.push({ id, prompt: question.prompt, type, answer: selected, cancelled: false });
					}
					continue;
				}

				if (type === "confirm") {
					const confirmed = await ctx.ui.confirm(question.prompt, question.detail || "");
					answers.push({ id, prompt: question.prompt, type, answer: confirmed, cancelled: false });
					continue;
				}

				if (type === "text") {
					const text = await ctx.ui.editor(question.prompt, question.prefill || "");
					answers.push({ id, prompt: question.prompt, type, answer: text ?? null, cancelled: text === undefined });
					if (text === undefined) return makeToolResult(answers, true);
					continue;
				}

				const input = await ctx.ui.input(question.prompt, question.placeholder || "");
				answers.push({ id, prompt: question.prompt, type, answer: input ?? null, cancelled: input === undefined });
				if (input === undefined) return makeToolResult(answers, true);
			}

			return makeToolResult(answers, false);
		},
	});

	pi.registerCommand("ask-user-demo", {
		description: "Show a demo ask_user select/input/confirm flow",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("ask-user-demo requires a dialog-capable UI", "error");
				return;
			}

			const favorite = await ctx.ui.select("Pick a UI control:", ["select", "input", "confirm", "text"]);
			if (!favorite) return;
			const name = await ctx.ui.input("What should I call you?", "Name");
			if (name === undefined) return;
			const ok = await ctx.ui.confirm("Confirm", `Use ${favorite} for ${name}?`);
			ctx.ui.notify(ok ? `Confirmed: ${name} chose ${favorite}` : "Cancelled", ok ? "info" : "warning");
		},
	});
}
