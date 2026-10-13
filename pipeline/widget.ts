import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { automaticSuites, type PipelineStatus, type SuiteStatus } from "./core.ts";

function age(timestamp: string, now: number): string {
	const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}
function suiteText(name: string, result: SuiteStatus, theme: Pick<Theme, "fg">, now: number): string {
	if (result.outcome === "never") return theme.fg("muted", `○ ${name} never`);
	if (result.outcome === "running") return theme.fg("accent", `› ${name} running ${age(result.startedAt, now)}`);
	const symbols = { passed: "✓", failed: "✗", cancelled: "■", "timed-out": "⌛" };
	const symbol = symbols[result.outcome];
	const timestamp = result.finishedAt ?? result.startedAt;
	const elapsed = now - Date.parse(timestamp) < 60000 ? "just now" : `${age(timestamp, now)} ago`;
	const outcome = result.outcome === "cancelled" ? "cancelled " : result.outcome === "timed-out" ? "timed out " : "";
	if (result.stale) return theme.fg("warning", `⚠ ${name} stale (${symbol} ${outcome}${elapsed})`);
	const color = result.outcome === "passed" ? "success" : result.outcome === "failed" ? "error" : "warning";
	return theme.fg(color, `${symbol} ${name} ${outcome}${elapsed}`);
}
/** One line per suite, truncated to the available terminal width. */
export function renderWidget(status: PipelineStatus | undefined, theme: Pick<Theme, "fg">, width: number, now = Date.now()): string[] {
	if (!status?.configured || !Object.keys(status.suites).length || width <= 0) return [];
	return Object.entries(status.suites).map(([name, result]) =>
		truncateToWidth(suiteText(name, result, theme, now), width),
	);
}

export interface Clock {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(timer: unknown): void;
}
export const realClock: Clock = {
	now: Date.now,
	setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
	clearTimeout(timer) { clearTimeout(timer as ReturnType<typeof setTimeout>); },
};
export interface Automation {
	idle(): boolean;
	run(status: PipelineStatus): Promise<unknown>;
	cancel(): void;
}
const QUIET_MS = 2000;
const RETRY_MS = 5000;
/** Polls files/shared results, schedules opt-in quiet snapshots and never sends agent messages. */
export class PipelineMonitor {
	private live = false;
	private timer: unknown;
	private pending = false;
	private reading?: Promise<void>;
	private latest?: PipelineStatus;
	private autoWindow = false;
	private settledAt = 0;
	private stableSince = 0;
	private stableKey = "";
	private nextAttemptAt = 0;
	private automatic?: Promise<void>;
	constructor(
		private readonly read: () => Promise<PipelineStatus>,
		private readonly render: (status: PipelineStatus | undefined) => void,
		private readonly clock: Clock = realClock,
		private readonly automation?: Automation,
	) {}
	async start() { this.live = true; await this.refresh(); }
	async stop() {
		this.live = false;
		this.clock.clearTimeout(this.timer);
		this.automation?.cancel();
		await Promise.allSettled([this.reading, this.automatic]);
		this.render(undefined);
	}
	agentStarted() {
		this.autoWindow = false;
		this.automation?.cancel();
		if (this.live) this.arm();
	}
	async agentSettled() {
		if (!this.live) return;
		this.autoWindow = true;
		this.settledAt = this.clock.now();
		await this.refresh();
	}
	async refresh(): Promise<void> {
		if (!this.live) return;
		if (this.reading) { this.pending = true; return this.reading; }
		this.reading = (async () => {
			do {
				this.pending = false;
				let status: PipelineStatus | undefined;
				try { status = await this.read(); } catch { /* /pipeline status exposes configuration/read errors. */ }
				if (!this.live) return;
				const key = `${status?.configFingerprint ?? ""}:${status?.sourceFingerprint ?? ""}`;
				if (key !== this.stableKey) { this.stableKey = key; this.stableSince = this.clock.now(); }
				this.latest = status;
				this.render(status);
				this.considerAutomatic();
			} while (this.pending && this.live);
		})();
		try { await this.reading; }
		finally { this.reading = undefined; if (this.live) this.arm(); }
	}
	private considerAutomatic() {
		const now = this.clock.now();
		if (!this.automation || !this.latest || !this.autoWindow || this.automatic || !this.automation.idle()) return;
		if (now < Math.max(this.stableSince + QUIET_MS, this.settledAt + QUIET_MS, this.nextAttemptAt)) return;
		if (!automaticSuites(this.latest, now).length) return;
		this.nextAttemptAt = now + RETRY_MS;
		const snapshot = this.latest;
		this.automatic = Promise.resolve().then(() => {
			if (this.live && this.autoWindow && this.automation!.idle()) return this.automation!.run(snapshot);
		}).catch(() => { /* Busy, changed or unapproved configurations remain silent. */ }).then(async () => {
			this.automatic = undefined;
			if (this.live) await this.refresh();
		});
	}
	private arm() {
		this.clock.clearTimeout(this.timer);
		const running = Object.values(this.latest?.suites ?? {}).some(suite => suite.outcome === "running");
		let delay = running ? 1000 : 5000;
		if (this.automation && this.autoWindow && !this.automatic && automaticSuites(this.latest, this.clock.now(), 0).length) {
			const due = Math.max(this.stableSince + QUIET_MS, this.settledAt + QUIET_MS, this.nextAttemptAt) - this.clock.now();
			if (due > 0) delay = Math.min(delay, due);
		}
		this.timer = this.clock.setTimeout(() => { void this.refresh(); }, delay);
	}
}
