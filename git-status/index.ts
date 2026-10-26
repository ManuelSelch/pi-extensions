import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readGitDirectories, readGitStatus } from "./Infra/git.ts";
import { watchGitMetadata } from "./Infra/watch.ts";
import { createRefreshQueue } from "./App/refresh.ts";
import { formatRepositoryStatus } from "./UI/Components/status.ts";

export { parseGitStatus } from "./Domain/status.ts";
export type { GitStatus } from "./Domain/status.ts";
export { formatGitStatus, formatRepositoryLabel } from "./UI/Components/status.ts";

const REFRESH_TOOLS = new Set(["write", "edit", "bash"]);

export default function gitStatusExtension(pi: ExtensionAPI): void {
	let session: ReturnType<typeof start> | undefined;

	function start(ctx: ExtensionContext) {
		let closed = false;
		let warned = false;
		let watcher: ReturnType<typeof watchGitMetadata> | undefined;
		let rootsKey = "";
		let published: string | undefined;
		function warn(): void {
			if (closed || warned) return;
			warned = true;
			ctx.ui.notify("Git status automatic refresh is degraded. Tool-triggered refreshes still work; /reload rebuilds watchers.", "warning");
		}
		const queue = createRefreshQueue(async () => {
			const roots = await readGitDirectories(ctx.cwd);
			if (closed) return;
			const key = JSON.stringify(roots);
			if (key !== rootsKey) {
				watcher?.close();
				rootsKey = key;
				watcher = roots.length ? watchGitMetadata(roots, () => queue.invalidate(), warn) : undefined;
			} else watcher?.reconcile();
			const result = await readGitStatus(ctx.cwd);
			if (closed) return;
			const rows = result ? formatRepositoryStatus(result).map(row => row.label
				? ctx.ui.theme.fg("accent", row.label) + ctx.ui.theme.fg(row.color, row.text.slice(row.label.length))
				: ctx.ui.theme.fg(row.color, row.text)) : undefined;
			const content = JSON.stringify(rows) ?? "null";
			if (content !== published) {
				published = content;
				ctx.ui.setWidget("git-status", rows);
			}
		}, warn);
		return {
			cwd: ctx.cwd,
			refresh: queue.request,
			close(): void { closed = true; queue.close(); watcher?.close(); },
		};
	}

	pi.on("session_start", async (_event, ctx) => {
		session?.close();
		session = start(ctx);
		await session.refresh();
	});
	pi.on("session_shutdown", async () => { session?.close(); session = undefined; });
	pi.on("tool_execution_end", async (event, ctx) => {
		if (!REFRESH_TOOLS.has(event.toolName)) return;
		if (!session || session.cwd !== ctx.cwd) { session?.close(); session = start(ctx); }
		await session.refresh();
	});
}
