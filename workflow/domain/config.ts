export const steps = ["mock", "plan", "design", "commit"] as const;
export type Step = typeof steps[number];
export interface StepConfig {
	enabled?: boolean;
	prompt?: string | null;
	skills?: string[];
	[key: string]: unknown;
}
export interface WorkflowConfig {
	steps?: Partial<Record<Step, StepConfig>>;
	[key: string]: unknown;
}
export interface StepValues { enabled: boolean; prompt: string | null; skills: string[] }
export type Defaults = Record<Step, StepValues>;
export type Resolved = Record<Step, StepValues & { sources: Record<keyof StepValues, string> }>;
export type Enabled = Record<Step, boolean>;
/** null means remove the local enabled field, not disable it. */
export type Patch = Partial<Record<Step, boolean | null>>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const pathString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !v.includes("\0");

export function validateConfig(value: unknown, source: string): WorkflowConfig {
	const fail = (field: string): never => { throw new Error(`${source}: invalid ${field}`); };
	if (!object(value)) return fail("configuration (expected an object)");
	if (value.steps !== undefined) {
		if (!object(value.steps)) return fail("steps");
		for (const [name, entry] of Object.entries(value.steps)) {
			if (!steps.includes(name as Step) || !object(entry)) return fail(`steps.${name}`);
			if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") return fail(`steps.${name}.enabled`);
			if (entry.prompt !== undefined && entry.prompt !== null && !pathString(entry.prompt)) return fail(`steps.${name}.prompt`);
			if (entry.skills !== undefined && (!Array.isArray(entry.skills) || !entry.skills.every(pathString))) return fail(`steps.${name}.skills`);
		}
	}
	return value as WorkflowConfig;
}

export function validateDefaults(value: unknown, source: string): Defaults {
	const config = validateConfig(value, source);
	return Object.fromEntries(steps.map(step => {
		const entry = config.steps?.[step];
		if (entry?.enabled === undefined || entry.prompt === undefined || entry.skills === undefined) {
			throw new Error(`${source}: defaults require enabled, prompt and skills for ${step}`);
		}
		return [step, { enabled: entry.enabled, prompt: entry.prompt, skills: [...entry.skills] }];
	})) as Defaults;
}

export function resolveSteps(defaults: Defaults, global: WorkflowConfig = {}, project: WorkflowConfig = {}, globalSource = "global", projectSource = "project", defaultSource = "default"): Resolved {
	return Object.fromEntries(steps.map(step => {
		const value = { ...defaults[step], sources: { enabled: defaultSource, prompt: defaultSource, skills: defaultSource } };
		for (const [config, source] of [[global, globalSource], [project, projectSource]] as const) {
			const entry = config.steps?.[step];
			if (!entry) continue;
			if (entry.enabled !== undefined) { value.enabled = entry.enabled; value.sources.enabled = source; }
			if (entry.prompt !== undefined) { value.prompt = entry.prompt; value.sources.prompt = source; }
			if (entry.skills !== undefined) { value.skills = [...entry.skills]; value.sources.skills = source; }
		}
		return [step, value];
	})) as Resolved;
}

export function composePrompts(prompts: Partial<Record<Step, string>>): string {
	return steps.filter(s => prompts[s]?.trim()).map(s => `## ${s}\n${prompts[s]!.trim()}`).join("\n\n");
}
export const enablement = (resolved: Resolved): Enabled => Object.fromEntries(steps.map(s => [s, resolved[s].enabled])) as Enabled;

export class WorkflowDraft {
	private readonly original: Partial<Record<Step, boolean>> = {};
	private readonly local: Partial<Record<Step, boolean>> = {};
	constructor(config: WorkflowConfig, private readonly initial: Enabled, private readonly inherited: Enabled) {
		for (const s of steps) this.original[s] = this.local[s] = config.steps?.[s]?.enabled;
	}
	values(): Enabled { return Object.fromEntries(steps.map(s => [s, this.local[s] ?? this.inherited[s]])) as Enabled; }
	toggle(step: Step): void {
		const next = !this.values()[step];
		this.local[step] = next === this.initial[step] ? this.original[step] : next;
	}
	restore(): void { for (const s of steps) this.local[s] = undefined; }
	patch(): Patch {
		return Object.fromEntries(steps.filter(s => this.local[s] !== this.original[s]).map(s => [s, this.local[s] ?? null]));
	}
}

export function parseCommand(args: string): "project" | "global" | "status" | "preview" {
	const command = args.trim();
	if (!command) return "project";
	if (command === "global" || command === "status" || command === "preview") return command;
	throw new Error("Usage: /workflow [global|status|preview]");
}
