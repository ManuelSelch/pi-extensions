import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getPiChatExtensionRegistry } from "@manuelselch/pi-server/extensions";
import { formatHandoff, parseArguments, reviewSessionName, USAGE } from "../domain/handoff.js";
import { collectReviewFacts, HandoffFactsError } from "../infra/git-facts.js";

async function handoffReview(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (!parseArguments(args).ok) return ctx.ui.notify(USAGE, "error");
	if (!ctx.hasUI) return ctx.ui.notify("/handoff review needs an editor and confirmation dialog. Nothing changed.", "error");
	if (!ctx.isIdle()) return ctx.ui.notify("Wait for the current run to finish before handing off. Nothing changed.", "error");
	if (!pi.getCommands().some(command => command.source === "skill" && command.name === "skill:code-reviewer"))
		return ctx.ui.notify("The code-reviewer skill is not available. Nothing changed.", "error");

	let facts;
	try {
		facts = await collectReviewFacts(pi.exec.bind(pi), ctx.cwd);
	} catch (error) {
		if (error instanceof HandoffFactsError) return ctx.ui.notify(error.message, "error");
		throw error;
	}

	const handoff = await ctx.ui.editor("Review handoff: edit before starting the review session", formatHandoff(facts));
	if (handoff === undefined || !handoff.trim()) return ctx.ui.notify("Handoff cancelled. Nothing changed.", "info");

	const name = reviewSessionName(facts.feature);
	const source = ctx.sessionManager.getSessionFile();
	const host = getPiChatExtensionRegistry().sessionHost();
	const archiveNotice = !source
		? "There is no saved implementation session to archive."
		: host
			? "Archive the implementation session after the review successfully starts."
			: `Archive the implementation session manually in Pi Chat: ${source}`;
	if (!await ctx.ui.confirm("Start review session?",
		`Create "${name}" in ${ctx.cwd} and submit the edited handoff to the code-reviewer.\n\n${archiveNotice}`))
		return ctx.ui.notify("Handoff cancelled. Nothing changed.", "info");

	// Session replacement keeps the host's cwd. No parentSession or copied history.
	const result = await ctx.newSession({
		setup: async manager => { manager.appendSessionInfo(name); },
		withSession: async next => {
			try {
				// Use the normal prompt path once: skill expansion and persistence belong to Pi.
				await next.sendUserMessage(`/skill:code-reviewer ${handoff}`, { expandPromptTemplates: true });
			} catch (error) {
				next.ui.notify(`Review could not start: ${error instanceof Error ? error.message : String(error)}. The implementation session was not archived.`, "error");
				next.ui.setEditorText(`/skill:code-reviewer ${handoff}`);
				return;
			}

			if (!source || !host) return next.ui.notify(archiveNotice, "info");
			try {
				await host.archive(source);
				next.ui.notify("Implementation session archived.", "info");
			} catch (error) {
				next.ui.notify(`Review started, but archiving could not be confirmed: ${error instanceof Error ? error.message : String(error)}. Check the implementation session in Pi Chat: ${source}`, "warning");
			}
		},
	});
	if (result.cancelled) ctx.ui.notify("Another extension cancelled the new session. Implementation session left unchanged.", "warning");
}

export default function handoffExtension(pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Start a fresh code review: /handoff review (archive implementation in Pi Chat)",
		getArgumentCompletions: prefix => "review".startsWith(prefix.trim()) ? [{ value: "review", label: "review" }] : null,
		handler: (args, ctx) => handoffReview(pi, args, ctx),
	});
}
