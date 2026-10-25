import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readGitStatus } from "./Infra/git.ts";
import { formatRepositoryStatus } from "./UI/Components/status.ts";

export { parseGitStatus } from "./Domain/status.ts";
export type { GitStatus } from "./Domain/status.ts";
export { formatGitStatus, formatRepositoryLabel } from "./UI/Components/status.ts";

const REFRESH_TOOLS = new Set(["write", "edit", "bash"]);

export default function gitStatusExtension(pi: ExtensionAPI): void {
	let refreshInFlight: Promise<void> | undefined;
	let refreshRequested = false;

	async function refresh(ctx: ExtensionContext): Promise<void> {
		if (refreshInFlight) {
			refreshRequested = true;
			return refreshInFlight;
		}

		refreshInFlight = (async () => {
			do {
				refreshRequested = false;
				const result = await readGitStatus(ctx.cwd);
				if (!result) {
					ctx.ui.setWidget("git-status", undefined);
				} else {
					ctx.ui.setWidget("git-status", formatRepositoryStatus(result).map(row =>
							row.label
								? ctx.ui.theme.fg("accent", row.label) + ctx.ui.theme.fg(row.color, row.text.slice(row.label.length))
								: ctx.ui.theme.fg(row.color, row.text),
						));
				}
			} while (refreshRequested);
		})();

		try {
			await refreshInFlight;
		} finally {
			refreshInFlight = undefined;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (REFRESH_TOOLS.has(event.toolName)) await refresh(ctx);
	});
}
