import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PipelineStatus, SuiteStatus } from "../core/pipeline.ts";

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
	const color = result.outcome === "passed" ? "success" : result.outcome === "failed" ? "error" : "warning";
	return theme.fg(color, `${symbol} ${name} ${outcome}${elapsed}`);
}
// Workflow names come from remote content; never emit terminal control sequences.
const safeText = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
function githubText(workflow: import("../core/github.ts").WorkflowStatus, theme: Pick<Theme, "fg">, now: number, branch?: "├─" | "└─", compact = false): string {
	const state = workflow.status === "completed" ? workflow.conclusion ?? "unknown" : workflow.status;
	const states: Record<string, [string, Parameters<Theme["fg"]>[0], string]> = {
		success: ["✓", "success", "passed"], failure: ["✗", "error", "failed"],
		in_progress: ["›", "accent", "running"], queued: ["○", "accent", "queued"],
		waiting: ["○", "accent", "waiting"], pending: ["○", "accent", "pending"], requested: ["○", "accent", "requested"],
		cancelled: ["■", "warning", "cancelled"], skipped: ["○", "muted", "skipped"],
		timed_out: ["⌛", "warning", "timed out"], never: ["○", "muted", "never"],
	};
	const [symbol, color, label] = Object.hasOwn(states, state) ? states[state] : ["○", "warning" as const, state.replace(/_/g, " ")];
	const elapsed = workflow.updatedAt && Number.isFinite(Date.parse(workflow.updatedAt)) ? ` ${age(workflow.updatedAt, now)} ago` : "";
	if (compact) {
		const jobs = workflow.jobs ?? [];
		const active = workflow.status !== "completed" && workflow.status !== "never";
		const count = jobs.length ? `${jobs.filter(job => active ? job.status === "completed" : job.status === "completed" && job.conclusion === "success").length}/${jobs.length}${active ? " complete" : ""}` : label;
		const needsWarning = workflow.jobsError;
		return theme.fg(needsWarning ? "warning" : color,
			`${needsWarning ? "⚠" : active ? "◐" : symbol} GitHub ${safeText(workflow.name)} · ${safeText(count)}${elapsed ? ` ·${elapsed}` : ""}`);
	}
	return theme.fg(color, branch
		? `  ${branch} ${symbol} ${safeText(workflow.name)} ${safeText(label)}`
		: `${symbol} ${safeText(workflow.name)} ${safeText(label)}${elapsed}`);
}
/** Expanded status for /pipeline; includes every preparation, suite and job. */
export function renderStatus(status: PipelineStatus | undefined, theme: Pick<Theme, "fg">, width: number, now = Date.now()): string[] {
	if (!status || width <= 0) return [];
	const entries: [string, SuiteStatus][] = [
		...(status.prepare ? [["prepare", status.prepare] as [string, SuiteStatus]] : []),
		...Object.entries(status.suites),
	];
	const lines = status.configured && Object.keys(status.suites).length
		? entries.flatMap(([name, result]) => [suiteText(name, result, theme, now), ...("jobs" in result ? Object.entries(result.jobs).map(([job, value]) => `  ${suiteText(job, value, theme, now)}`) : [])]) : [];
	const hasGitHubSection = status.github?.error || status.github?.workflows.length;
	if (hasGitHubSection) {
		if (lines.length) lines.unshift(theme.fg("muted", "Local"));
		const github = status.github!;
		if (github.errorKind) {
			const reason = { timeout: "timeout", authentication: "auth", access: "access", "missing-cli": "gh missing", connection: "connection", unknown: "refresh failed" }[github.errorKind];
			lines.push(theme.fg("warning", `⚠ GitHub · unavailable · ${reason}`));
		} else lines.push(theme.fg("muted", "GitHub"));
	}
	if (status.github?.error && !status.github.errorKind) lines.push(theme.fg("warning", status.github.error));
	if (!status.github?.error) for (const workflow of status.github?.workflows ?? []) {
		lines.push(githubText(workflow, theme, now));
		if (workflow.jobsError) lines.push(theme.fg("warning", `  └─ ⚠ ${safeText(workflow.jobsError)}`));
		else {
			const jobs = workflow.jobs ?? [];
			for (const [index, job] of jobs.entries()) {
				lines.push(githubText(job, theme, now, index === jobs.length - 1 ? "└─" : "├─"));
			}
		}
	}
	return lines.map(line => truncateToWidth(line, width));
}

/** Compact summaries with detail rows only for results needing attention. */
export function renderWidget(status: PipelineStatus | undefined, theme: Pick<Theme, "fg">, width: number, now = Date.now()): string[] {
	if (!status || width <= 0) return [];
	const lines: string[] = [];
	const suites = Object.entries(status.suites);
	if (status.configured && suites.length) {
		const entries: [string, SuiteStatus][] = [
			...(status.prepare && status.prepare.outcome !== "passed" && status.prepare.outcome !== "never" ? [["prepare", status.prepare] as [string, SuiteStatus]] : []),
			...suites,
		];
		const results = entries.map(([, result]) => result);
		const failed = results.some(result => ["failed", "cancelled", "timed-out"].includes(result.outcome));
		const running = results.some(result => result.outcome === "running");
		const passed = suites.filter(([, result]) => result.outcome === "passed").length;
		const symbol = failed ? "✗" : running ? "◐" : passed === suites.length ? "✓" : "○";
		const color = failed ? "error" : running ? "accent" : passed === suites.length ? "success" : "muted";
		// Preparation may be days old; summary age reflects the most recent suite result.
		const timestamps = suites.flatMap(([, result]) => result.outcome === "never" ? [] : [Date.parse(result.finishedAt ?? result.startedAt)]).filter(Number.isFinite);
		const latest = timestamps.length ? Math.max(...timestamps) : undefined;
		const elapsed = latest === undefined ? "" : now - latest < 60000 ? " · just now" : ` · ${age(new Date(latest).toISOString(), now)} ago`;
		lines.push(theme.fg(color, `${symbol} Local ${passed}/${suites.length}${elapsed}`));
		for (const [name, result] of entries) {
			if (result.outcome !== "passed") lines.push(`  ${suiteText(safeText(name), result, theme, now)}`);
			if ("jobs" in result) for (const [job, value] of Object.entries(result.jobs)) {
				if (value.outcome !== "passed") lines.push(`    ${suiteText(safeText(job), value, theme, now)}`);
			}
		}
	}
	const github = status.github;
	if (github) {
		const reason = github.errorKind ? { timeout: "timeout", authentication: "auth", access: "access", "missing-cli": "gh missing", connection: "connection", unknown: "refresh failed" }[github.errorKind] : safeText(github.error ?? "");
		const workflows = !github.error ? github.workflows : [];
		if (!workflows.length && (github.error || github.errorKind)) lines.push(theme.fg("warning", `⚠ GitHub · unavailable · ${reason}`));
		for (const workflow of workflows) {
			lines.push(githubText(workflow, theme, now, undefined, true));
			if (workflow.jobsError) lines.push(theme.fg("warning", `  └─ ⚠ ${safeText(workflow.jobsError)}`));
			else {
				const jobs = (workflow.jobs ?? []).filter(job => job.status !== "completed" || job.conclusion !== "success");
				for (const [index, job] of jobs.entries()) lines.push(githubText(job, theme, now, index === jobs.length - 1 ? "└─" : "├─"));
			}
		}
	}
	return lines.map(line => truncateToWidth(line, width));
}
