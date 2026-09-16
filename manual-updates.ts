/**
 * Manual Updates Extension
 *
 * - Adds /update for Pi + extension/package updates.
 *
 * Startup banner suppression lives in the minimal-tui extension; this command
 * unsets PI_OFFLINE for its child process so updates still work.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const EXT_ID = "manual-updates";
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

async function runPiUpdate(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
	await ctx.waitForIdle();

	const displayCommand = `pi ${args.join(" ")}`.trim();
	ctx.ui.setStatus(EXT_ID, `running ${displayCommand}`);

	let result: Awaited<ReturnType<typeof pi.exec>>;
	try {
		result = await pi.exec("env", ["-u", "PI_OFFLINE", "pi", ...args], {
			cwd: ctx.cwd,
			timeout: UPDATE_TIMEOUT_MS,
		});
	} finally {
		ctx.ui.setStatus(EXT_ID, undefined);
	}

	if (result.killed) {
		ctx.ui.notify("Update timed out", "error");
		return;
	}

	if (result.code !== 0) {
		ctx.ui.notify(`Update failed (${result.code})`, "error");
		return;
	}

	ctx.ui.notify("Update finished. Restart Pi manually to use the new version.", "info");
}

export default function manualUpdatesExtension(pi: ExtensionAPI): void {
	pi.registerCommand("update", {
		description: "Update Pi itself and installed Pi packages/extensions",
		handler: async (_args, ctx) => {
			await runPiUpdate(pi, ctx, ["update", "--all"]);
		},
	});
}
