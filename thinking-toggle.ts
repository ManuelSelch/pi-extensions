/**
 * Thinking Toggle Extension
 *
 * Adds /thinking-toggle to switch between minimal and high thinking.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOW_LEVEL = "minimal" as const;
const HIGH_LEVEL = "high" as const;

export default function thinkingToggleExtension(pi: ExtensionAPI): void {
	pi.registerCommand("thinking-toggle", {
		description: "Toggle thinking level between minimal and high",
		handler: async (_args, ctx) => {
			const current = pi.getThinkingLevel();
			const next = current === HIGH_LEVEL ? LOW_LEVEL : HIGH_LEVEL;

			pi.setThinkingLevel(next);
			ctx.ui.notify(`Thinking level set to ${pi.getThinkingLevel()}`, "info");
		},
	});
}
