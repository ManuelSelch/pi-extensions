/**
 * Dot Clean Extension
 *
 * Adds /dot-clean, which runs `dot_clean -m .` in the session's working
 * directory to remove the AppleDouble `._*` sidecar files macOS leaves behind
 * on mounted Windows/network drives.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const run = promisify(execFile);

export default function dotCleanExtension(pi: ExtensionAPI): void {
	pi.registerCommand("dot-clean", {
		description: "Run `dot_clean -m .` to strip macOS ._* metadata files from the working directory",
		handler: async (_args, ctx) => {
			// ctx.cwd is the session's project directory; process.cwd() is the host
			// process dir, which in pi-chat is the server's launch folder.
			const cwd = ctx.cwd;
			try {
				const { stderr } = await run("dot_clean", ["-m", "."], { cwd });
				const trailer = stderr.trim();
				ctx.ui.notify(trailer ? `dot_clean -m . in ${cwd}\n${trailer}` : `dot_clean -m . done in ${cwd}`, "info");
			} catch (error) {
				ctx.ui.notify(`dot_clean failed in ${cwd}: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
