// One queue per session. Timers exist only after a filesystem invalidation.
export function createRefreshQueue(run: () => Promise<void>, onError: (error: unknown) => void) {
	let closed = false;
	let dirty = false;
	let running: Promise<void> | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;

	function cancelTimers(): void {
		clearTimeout(debounce);
		clearTimeout(deadline);
		debounce = deadline = undefined;
	}

	function request(): Promise<void> {
		if (closed) return Promise.resolve();
		cancelTimers();
		dirty = true;
		if (running) return running;
		running = (async () => {
			do {
				dirty = false;
				try { await run(); } catch (error) { if (!closed) onError(error); }
			} while (dirty && !closed);
		})();
		const result = running.finally(() => { running = undefined; });
		return result;
	}

	return {
		request,
		invalidate(): void {
			if (closed) return;
			if (running) { dirty = true; return; }
			clearTimeout(debounce);
			debounce = setTimeout(() => { void request(); }, 500);
			deadline ??= setTimeout(() => { void request(); }, 2000);
		},
		close(): void { closed = true; cancelTimers(); },
	};
}
