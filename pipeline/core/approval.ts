import type { Config, Prepare, Suite, JobSuite, JobDefinition } from "./pipeline.ts";

const effective = (suite: JobSuite, job: JobDefinition): Suite => ({ command: job.command, cwd: job.cwd ?? suite.cwd, timeoutSeconds: job.timeoutSeconds ?? suite.timeoutSeconds, auto: job.auto ?? suite.auto });

// Preserve literal argument boundaries and escape control characters in plain-text dialogs.
const literal = (value: string) => /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
const command = (step: Prepare) => step.command.map(literal).join(" ");
const label = (name: string, setup: boolean, collision: boolean) => name === "prepare" && collision ? `prepare (${setup ? "setup" : "suite"})` : name;

export function executionSummary(config: Config): string {
	const collision = !!config.prepare && Object.hasOwn(config.suites, "prepare");
	const rows = [
		...(config.prepare ? [[label("prepare", true, collision), config.prepare, false] as const] : []),
		...Object.entries(config.suites).flatMap<readonly [string, Prepare, boolean]>(([name, step]) => "jobs" in step
			? Object.entries(step.jobs).map(([job, value]) => [`${label(name, false, collision)}/${job}`, effective(step, value), true] as const)
			: [[label(name, false, collision), step, false] as const]),
	];
	const defaults = Object.entries(config.suites).filter(([, suite]) => "jobs" in suite).map(([name, suite]) => `${name} defaults\ncwd: ${literal(suite.cwd)}\ntimeout: ${suite.timeoutSeconds}s\nauto: ${suite.auto}`);
	return [...defaults, ...rows.map(([name, step, grouped]) => `${name} · timeout ${step.timeoutSeconds}s\n${command(step)}${step.cwd !== "." ? `\ncwd: ${literal(step.cwd)}` : ""}${grouped && "auto" in step ? `\nauto: ${step.auto}` : ""}`)].join("\n\n") || "No suites configured.";
}

export function configurationReview(before: Config | undefined, after: Config): string {
	if (!before) return executionSummary(after);
	const sections: string[] = [];
	const collision = (!!before.prepare || !!after.prepare) && (Object.hasOwn(before.suites, "prepare") || Object.hasOwn(after.suites, "prepare"));
	const section = (name: string, previous: Prepare | Suite | undefined, next: Prepare | Suite | undefined, setup = false) => {
		const lines: string[] = [];
		const fields = (step: Prepare | Suite) => ({
			command: command(step), timeout: `${step.timeoutSeconds}s`, cwd: literal(step.cwd),
			...("auto" in step ? { auto: step.auto } : {}),
		});
		const oldFields = previous ? fields(previous) : undefined;
		const newFields = next ? fields(next) : undefined;
		for (const key of ["command", "timeout", "cwd", "auto"] as const) {
			const oldValue = oldFields?.[key], newValue = newFields?.[key];
			if (oldValue === newValue) continue;
			// Root cwd is implicit only on creation/removal; cwd transitions always show both values.
			if (key === "cwd" && (!previous || !next) && (previous ?? next)?.cwd === ".") continue;
			if (oldValue !== undefined) lines.push(`- ${key}: ${oldValue}`);
			if (newValue !== undefined) lines.push(`+ ${key}: ${newValue}`);
		}
		const change = !previous ? " (added)" : !next ? " (removed)" : "";
		if (lines.length) sections.push(`${label(name, setup, collision)}${change}\n${lines.join("\n")}`);
	};
	section("prepare", before.prepare, after.prepare, true);
	for (const name of new Set([...Object.keys(before.suites), ...Object.keys(after.suites)])) {
		const oldSuite = before.suites[name], newSuite = after.suites[name];
		if ((oldSuite && "jobs" in oldSuite) || (newSuite && "jobs" in newSuite)) {
			const oldJobs = oldSuite && "jobs" in oldSuite ? oldSuite.jobs : {};
			const newJobs = newSuite && "jobs" in newSuite ? newSuite.jobs : {};
			if (oldSuite && !("jobs" in oldSuite)) section(name, oldSuite, undefined);
			if (newSuite && !("jobs" in newSuite)) section(name, undefined, newSuite);
			const oldGroup = oldSuite && "jobs" in oldSuite ? oldSuite : undefined;
			const newGroup = newSuite && "jobs" in newSuite ? newSuite : undefined;
			for (const job of new Set([...Object.keys(oldJobs), ...Object.keys(newJobs)])) {
				section(`${name}/${job}`, oldGroup && oldJobs[job] ? effective(oldGroup, oldJobs[job]) : undefined, newGroup && newJobs[job] ? effective(newGroup, newJobs[job]) : undefined);
				if (oldJobs[job] && newJobs[job]) {
					const changes = (["cwd", "timeoutSeconds", "auto"] as const).filter(key => Object.hasOwn(oldJobs[job], key) !== Object.hasOwn(newJobs[job], key));
					if (changes.length) sections.push(`${name}/${job} inheritance\n${changes.map(key => `${key}: ${Object.hasOwn(newJobs[job], key) ? "override" : "inherit"}`).join("\n")}`);
				}
			}
			const defaultKeys = (["cwd", "timeoutSeconds", "auto"] as const).filter(key => oldGroup?.[key] !== newGroup?.[key]);
			if (defaultKeys.length) sections.push(`${name} defaults${!oldGroup ? " (added)" : !newGroup ? " (removed)" : ""}\n${defaultKeys.flatMap(key => [ ...(oldGroup ? [`- ${key}: ${literal(String(oldGroup[key]))}`] : []), ...(newGroup ? [`+ ${key}: ${literal(String(newGroup[key]))}`] : []) ]).join("\n")}`);
			const oldOrder = Object.keys(oldJobs), newOrder = Object.keys(newJobs);
			if (JSON.stringify(oldOrder.filter(job => Object.hasOwn(newJobs, job))) !== JSON.stringify(newOrder.filter(job => Object.hasOwn(oldJobs, job)))) sections.push(`${name} job order\n- ${oldOrder.join(" → ")}\n+ ${newOrder.join(" → ")}`);
		} else section(name, oldSuite as Suite | undefined, newSuite as Suite | undefined);
	}
	// Additions/removals already carry their names; show order only when shared suites move.
	const oldOrder = Object.keys(before.suites), newOrder = Object.keys(after.suites);
	if (JSON.stringify(oldOrder.filter(name => Object.hasOwn(after.suites, name))) !== JSON.stringify(newOrder.filter(name => Object.hasOwn(before.suites, name)))) {
		sections.push(`Execution order\n- ${oldOrder.join(" → ")}\n+ ${newOrder.join(" → ")}`);
	}
	return sections.join("\n\n") || "No configuration changes.";
}
