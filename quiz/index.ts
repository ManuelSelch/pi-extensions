import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { editWithPresentation, selectWithPresentation, type PromptContext } from "@manuelselch/pi-sdk/extension-ui";
import { Type, type Static } from "typebox";

const UNKNOWN_LABEL = "I don't know";
const UNKNOWN_ID = "__unknown__";
const REASONING = "Explain how you reached your answer. What assumptions or uncertainties do you have? You may leave this empty.";

const QuizParams = Type.Object({
	questionId: Type.String({ minLength: 1, maxLength: 128, description: "Stable ID for this question" }),
	title: Type.String({ minLength: 1, maxLength: 200, description: "Short, literal dialog title" }),
	body: Type.String({ minLength: 1, maxLength: 32768, description: "Question content in Markdown; code fences and math are supported in Pi Chat" }),
	options: Type.Array(Type.Object({
		id: Type.String({ minLength: 1, maxLength: 128, description: "Unique option identity; __unknown__ is reserved" }),
		label: Type.String({ minLength: 1, maxLength: 2000, description: "Unique plain-text choice; do not include the reserved I don't know choice" }),
	}, { additionalProperties: false }), { minItems: 2, maxItems: 8 }),
}, { additionalProperties: false });

type Question = Static<typeof QuizParams>;
type Outcome =
	| (Question & { status: "submitted"; answer: { kind: "option"; optionId: string; label: string } | { kind: "unknown" }; reasoning: string })
	| { status: "cancelled"; questionId: string; stage: "answer" | "reasoning" }
	| { status: "unavailable"; questionId: string; reason: string };

function result(details: Outcome) {
	return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

function validate(question: Question): void {
	if (![question.questionId, question.title, question.body].every(text => text.trim())) {
		throw new Error("Quiz question ID, title and body must not be blank");
	}
	const ids = question.options.map(option => option.id.trim());
	const labels = question.options.map(option => option.label.trim());
	if (ids.some(id => !id || id === UNKNOWN_ID) || labels.some(label => !label || label === UNKNOWN_LABEL)
		|| new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) {
		throw new Error("Quiz options require unique, non-blank IDs and labels; the unknown choice is reserved");
	}
}

/** One question's evidence only. The teaching agent owns evaluation and sequencing. */
export default function quizExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "Quiz",
		description: "Collect one multiple-choice answer and the learner's written reasoning using separate native dialogs. Prepare the expected solution privately first; never pass an answer key. I don't know is added automatically. This tool does not grade or ask subsequent questions.",
		parameters: QuizParams,
		executionMode: "sequential",
		async execute(_toolCallId, question, signal, _onUpdate, ctx) {
			validate(question);
			const cancelled = (stage: "answer" | "reasoning") => result({ status: "cancelled", questionId: question.questionId, stage });
			if (signal?.aborted) return cancelled("answer");
			if (!ctx.hasUI) return result({ status: "unavailable", questionId: question.questionId, reason: "No dialog-capable UI is available" });
			const promptContext: PromptContext = { mode: ctx.mode, ui: ctx.ui };
			if (ctx.mode !== "tui" && !promptContext.ui.withPromptPresentation) {
				return result({ status: "unavailable", questionId: question.questionId, reason: "This host does not support prompt presentation" });
			}

			const selected = await selectWithPresentation(promptContext, {
				title: question.title,
				body: { format: "markdown", text: question.body },
				options: [...question.options.map(option => option.label), UNKNOWN_LABEL],
				submission: "explicit",
				submitLabel: "Continue to reasoning",
			});
			if (selected === undefined || signal?.aborted) return cancelled("answer");
			const option = question.options.find(option => option.label === selected);
			if (!option && selected !== UNKNOWN_LABEL) throw new Error("Quiz UI returned an unexpected option");

			const reasoning = await editWithPresentation(promptContext, {
				title: `${question.title} — Reasoning`,
				body: { format: "plain", text: `Selected answer: ${selected}\n\n${REASONING}` },
				submitLabel: "Submit answer",
			});
			if (reasoning === undefined || signal?.aborted) return cancelled("reasoning");
			return result({
				...question,
				status: "submitted",
				answer: option ? { kind: "option", optionId: option.id, label: option.label } : { kind: "unknown" },
				reasoning,
			});
		},
	});
}
