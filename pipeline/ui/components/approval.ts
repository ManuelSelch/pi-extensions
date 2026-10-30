import type { Config, Prepare, Suite } from "../../core.ts";

// Preserve literal argument boundaries and escape control characters in plain-text dialogs.
const literal = (value: string) => /^[a-zA-Z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
const command = (step: Prepare) => step.command.map(literal).join(" ");
const label = (name: string, setup: boolean, collision: boolean) => name === "prepare" && collision ? `prepare (${setup ? "setup" : "suite"})` : name;

export function executionSummary(config: Config): string {
	const collision = !!config.prepare && Object.hasOwn(config.suites, "prepare");
	const rows = [
		...(config.prepare ? [[label("prepare", true, collision), config.prepare] as const] : []),
		...Object.entries(config.suites).map(([name, step]) => [label(name, false, collision), step] as const),
	];
	return rows.map(([name, step]) => `${name} · timeout ${step.timeoutSeconds}s\n${command(step)}${step.cwd !== "." ? `\ncwd: ${literal(step.cwd)}` : ""}`).join("\n\n") || "No suites configured.";
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
		section(name, before.suites[name], after.suites[name]);
	}
	// Additions/removals already carry their names; show order only when shared suites move.
	const oldOrder = Object.keys(before.suites), newOrder = Object.keys(after.suites);
	if (JSON.stringify(oldOrder.filter(name => Object.hasOwn(after.suites, name))) !== JSON.stringify(newOrder.filter(name => Object.hasOwn(before.suites, name)))) {
		sections.push(`Execution order\n- ${oldOrder.join(" → ")}\n+ ${newOrder.join(" → ")}`);
	}
	return sections.join("\n\n") || "No configuration changes.";
}
