/**
 * Manual Updates Extension
 *
 * - Adds /update for Pi + extension/package updates.
 *
 * Startup banner suppression lives in the minimal-tui extension; this command
 * unsets PI_OFFLINE for its child process so updates still work.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const EXT_ID = "manual-updates";
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

function restartCurrentSessionAfterExit(ctx: ExtensionCommandContext): void {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const restartArgs = sessionFile ? ["--session", sessionFile] : [];
	const env = { ...process.env };
	delete env.PI_OFFLINE;

	const child = spawn(
		"/bin/sh",
		[
			"-c",
			'parent_pid="$1"; shift; while kill -0 "$parent_pid" 2>/dev/null; do sleep 1; done; exec pi "$@"',
			"pi-restart",
			String(process.pid),
			...restartArgs,
		],
		{
			cwd: ctx.cwd,
			env,
			stdio: "inherit",
		},
	);
	child.unref();
}

async function runPiUpdate(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
	await ctx.waitForIdle();

	const displayCommand = `pi ${args.join(" ")}`.trim();
	ctx.ui.setStatus(EXT_ID, `running ${displayCommand}`);

	const result = await pi.exec("env", ["-u", "PI_OFFLINE", "pi", ...args], {
		cwd: ctx.cwd,
		timeout: UPDATE_TIMEOUT_MS,
	});

	ctx.ui.setStatus(EXT_ID, undefined);

	if (result.killed) {
		ctx.ui.notify("Update timed out", "error");
		return;
	}

	if (result.code !== 0) {
		ctx.ui.notify(`Update failed (${result.code})`, "error");
		return;
	}

	ctx.ui.notify("Update finished. Restarting the current session…", "info");
	restartCurrentSessionAfterExit(ctx);
	ctx.shutdown();
}

export default function manualUpdatesExtension(pi: ExtensionAPI): void {
	pi.registerCommand("update", {
		description: "Update Pi itself and installed Pi packages/extensions",
		handler: async (_args, ctx) => {
			await runPiUpdate(pi, ctx, ["update", "--all"]);
		},
	});
}
