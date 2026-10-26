import { lstatSync, readdirSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, join, resolve } from "node:path";

type DirectoryKind = "root" | "refs" | "worktrees";
const ROOT_ENTRIES = new Set([
	"HEAD", "index", "packed-refs", "config", "config.worktree", "commondir", "gitdir",
	"refs", "worktrees", "MERGE_HEAD", "REBASE_HEAD", "FETCH_HEAD", "ORIG_HEAD",
]);

export function watchGitMetadata(directories: string[], onChange: () => void, onError: (error: unknown) => void) {
	let closed = false;
	const roots = [...new Set(directories.map(path => resolve(path)))];
	const handles = new Map<string, { watcher: FSWatcher; identity: string }>();
	const failed = new Set<string>();

	function failure(path: string, error: unknown): void {
		handles.get(path)?.watcher.close();
		handles.delete(path);
		failed.add(path);
		if (!closed) onError(error);
	}

	function reconcile(): void {
		if (closed) return;
		const desired = new Set<string>();
		function visit(path: string, kind: DirectoryKind): void {
			if (desired.has(path)) return;
			try {
				const stat = lstatSync(path);
				if (!stat.isDirectory() || stat.isSymbolicLink()) return;
				desired.add(path);
				const identity = `${stat.dev}:${stat.ino}`;
				const existing = handles.get(path);
				if (existing && existing.identity !== identity) {
					existing.watcher.close();
					handles.delete(path);
				}
				if (!handles.has(path) && !failed.has(path)) {
					const watcher = watch(path, { recursive: false, persistent: false }, (_event, filename) => {
						if (closed || handles.get(path)?.watcher !== watcher) return;
						const name = filename?.toString();
						if (name?.endsWith(".lock")) return;
						if (!name || kind !== "root" || ROOT_ENTRIES.has(name) || name === basename(path)) onChange();
					});
					handles.set(path, { watcher, identity });
					watcher.on("error", error => {
						if (!closed && handles.get(path)?.watcher === watcher) failure(path, error);
					});
				}
				// Install each parent before enumerating children. Never enumerate objects/logs.
				if (kind === "root") {
					visit(join(path, "refs"), "refs");
					visit(join(path, "worktrees"), "worktrees");
				} else {
					for (const entry of readdirSync(path, { withFileTypes: true })) {
						if (entry.isDirectory() && !entry.isSymbolicLink()) {
							visit(join(path, entry.name), kind === "worktrees" ? "root" : "refs");
						}
					}
				}
			} catch (error) {
				// Missing optional directories are normal, including during Git's atomic updates.
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") failure(path, error);
			}
		}
		for (const root of roots) visit(root, "root");
		for (const [path, { watcher }] of handles) {
			if (!desired.has(path)) { watcher.close(); handles.delete(path); }
		}
	}

	reconcile();
	return {
		reconcile,
		close(): void {
			closed = true;
			for (const { watcher } of handles.values()) watcher.close();
			handles.clear();
		},
	};
}
