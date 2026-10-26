import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composePrompts, resolveSteps, steps, validateConfig, validateDefaults } from "../domain/config.ts";
import type { Patch, Resolved, Step, WorkflowConfig } from "../domain/config.ts";

export interface Snapshot {
	file: string;
	config: WorkflowConfig;
	resolved: Resolved;
	inherited: Resolved;
	scope: "project" | "global";
	writable: boolean;
}
export interface Resources { prompt: string; skillPaths: string[] }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function readConfig(file: string, required = false): Promise<{ config: WorkflowConfig; text: string | undefined }> {
	let text: string;
	try { text = await readFile(file, "utf8"); }
	catch (error) { if (!required && missing(error)) return { config: {}, text: undefined }; throw new Error(`${file}: ${message(error)}`); }
	try { return { config: validateConfig(JSON.parse(text), file), text }; }
	catch (error) { throw new Error(`${file}: ${message(error)}`); }
}
function normalize(config: WorkflowConfig, file: string): WorkflowConfig {
	const result: WorkflowConfig = { ...config, steps: {} };
	for (const s of steps) {
		const entry = config.steps?.[s];
		if (!entry) continue;
		result.steps![s] = {
			...entry,
			...(typeof entry.prompt === "string" ? { prompt: resolve(dirname(file), entry.prompt) } : {}),
			...(entry.skills !== undefined ? { skills: entry.skills.map(p => resolve(dirname(file), p)) } : {}),
		};
	}
	return result;
}

export class WorkflowStore {
	readonly globalFile: string;
	constructor(agentDir: string, readonly defaultsFile = fileURLToPath(new URL("../workflow.default.json", import.meta.url))) {
		this.globalFile = resolve(agentDir, "workflow.json");
	}
	async load(cwd: string, trusted: boolean, scope: "project" | "global" = "project", requireWrite = false): Promise<Snapshot> {
		if (requireWrite && scope === "project" && !trusted) throw new Error("Project workflow editing requires project trust.");
		const template = await readConfig(this.defaultsFile, true);
		// The shipped JSON is a global installation template, based at the agent directory.
		const defaults = validateDefaults(normalize(template.config, this.globalFile), this.defaultsFile);
		const global = await readConfig(this.globalFile);
		const projectFile = join(cwd, ".pi", "workflow.json");
		const project = scope === "project" && trusted ? await readConfig(projectFile) : { config: {} };
		const inherited = resolveSteps(defaults, scope === "project" ? normalize(global.config, this.globalFile) : {}, {}, this.globalFile, projectFile, this.defaultsFile);
		return {
			file: scope === "global" ? this.globalFile : projectFile,
			config: scope === "global" ? global.config : project.config,
			resolved: resolveSteps(defaults, normalize(global.config, this.globalFile), normalize(project.config, projectFile), this.globalFile, projectFile, this.defaultsFile),
			inherited, scope, writable: scope === "global" || trusted,
		};
	}
	async resources(resolved: Resolved): Promise<Resources> {
		const prompts: Partial<Record<Step, string>> = {};
		const seenPrompts = new Set<string>(), skillPaths = new Set<string>();
		for (const s of steps) {
			const entry = resolved[s];
			if (!entry.enabled) continue;
			if (entry.prompt !== null) {
				try {
					const canonical = await realpath(entry.prompt);
					if (!seenPrompts.has(canonical)) {
						prompts[s] = await readFile(canonical, "utf8");
						seenPrompts.add(canonical);
					}
				} catch (error) { throw new Error(`${entry.prompt}: ${message(error)}`); }
			}
			for (const skill of entry.skills) {
				try {
					if (basename(skill) !== "SKILL.md") throw new Error("Expected a SKILL.md file");
					const canonical = await realpath(skill);
					if (!(await stat(canonical)).isFile()) throw new Error("Expected a file");
					await readFile(canonical, "utf8"); // Check readability; Pi owns parsing and diagnostics.
					skillPaths.add(canonical);
				} catch (error) { throw new Error(`${skill}: ${message(error)}`); }
			}
		}
		return { prompt: composePrompts(prompts), skillPaths: [...skillPaths] };
	}
	async save(snapshot: Snapshot, patch: Patch): Promise<boolean> {
		if (!snapshot.writable) throw new Error("Project workflow editing requires project trust.");
		if (!Object.keys(patch).length) return false;
		for (const [s, value] of Object.entries(patch)) {
			if (!steps.includes(s as Step) || (value !== null && typeof value !== "boolean")) throw new Error("Invalid workflow patch");
		}
		const file = snapshot.file, lock = `${file}.lock`;
		await mkdir(dirname(file), { recursive: true });
		try { await mkdir(lock); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file}: workflow settings busy. If Pi crashed, verify no writer remains before removing ${lock}`);
			throw error;
		}
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			const current = await readConfig(file);
			const next: WorkflowConfig = { ...current.config, steps: { ...current.config.steps } };
			for (const s of steps) {
				if (!(s in patch)) continue;
				if (current.config.steps?.[s]?.enabled !== snapshot.config.steps?.[s]?.enabled) throw new Error(`${file}: ${s}.enabled changed while the popup was open. Reopen /workflow.`);
				const entry = { ...next.steps![s] };
				if (patch[s] === null) delete entry.enabled;
				else entry.enabled = patch[s]!;
				if (Object.keys(entry).length) next.steps![s] = entry;
				else delete next.steps![s];
			}
			validateConfig(next, file);
			await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
			if ((await readConfig(file)).text !== current.text) throw new Error(`${file}: configuration changed during save. Retry /workflow.`);
			await rename(temporary, file);
			return true;
		} finally {
			try { await rm(temporary, { force: true }); }
			finally { await rm(lock, { recursive: true, force: true }); }
		}
	}
}
