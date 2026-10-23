/**
 * /extensions manages local entry points through native settings.json resource
 * exclusions, never by renaming source files. Package toggles remain separate.
 * Defaults and seen-state live in the agent's extension-manager.json.
 * Changes apply on /reload or restart, not in the current runtime. Startup
 * defaults cannot prevent code already selected for loading from running.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CONFIG_DIR_NAME, DefaultPackageManager, getAgentDir, SettingsManager,
	type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const AGENT_DIR = resolve(getAgentDir());
const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
const CONFIG_PATH = join(AGENT_DIR, "extension-manager.json");
const SELF = fileURLToPath(import.meta.url);

type DefaultForNew = "enable" | "disable";
interface ManagerConfig {
	defaults: Record<string, boolean>;
	seen: string[];
	/** Package specs removed from settings.packages by this extension. */
	disabledPackages: string[];
	defaultForNew: DefaultForNew;
}
interface Settings {
	extensions?: string[];
	packages?: string[];
	[key: string]: unknown;
}
interface Entry {
	id: string;
	kind: "file" | "package";
	enabled: boolean;
	/** Actual entry point and owning scope for local extensions. */
	path?: string;
	settingsPath?: string;
	cwd?: string;
}

function readJson<T>(path: string, fallback: T): T {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
		return parsed as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
		throw new Error(`Cannot read ${path}: ${(error as Error).message}`);
	}
}
function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function readConfig(): ManagerConfig {
	const raw = readJson<Partial<ManagerConfig>>(CONFIG_PATH, {});
	return {
		defaults: raw.defaults ?? {}, seen: raw.seen ?? [], disabledPackages: raw.disabledPackages ?? [],
		defaultForNew: raw.defaultForNew === "disable" ? "disable" : "enable",
	};
}
const writeConfig = (config: ManagerConfig) => writeJson(CONFIG_PATH, config);
function readSettings(path = SETTINGS_PATH): Settings {
	const settings = readJson<Settings>(path, {});
	if (settings.extensions !== undefined && (!Array.isArray(settings.extensions) || settings.extensions.some(p => typeof p !== "string"))) {
		throw new Error(`Invalid extensions array in ${path}`);
	}
	return settings;
}

function extensionDirs(cwd: string): string[] {
	return [...new Set([join(AGENT_DIR, "extensions"), join(resolve(cwd), CONFIG_DIR_NAME, "extensions")])].filter(existsSync);
}

/** Query native filtering without installing packages or writing settings. */
async function localResources(cwd: string, overridePath?: string, override?: Settings) {
	const projectPath = join(resolve(cwd), CONFIG_DIR_NAME, "settings.json");
	const user = overridePath === SETTINGS_PATH ? override! : readSettings();
	const project = overridePath === projectPath ? override! : readSettings(projectPath);
	const settingsManager = SettingsManager.inMemory({ extensions: user.extensions ?? [] }, { projectTrusted: true });
	settingsManager.setProjectExtensionPaths(project.extensions ?? []);
	const resources = await new DefaultPackageManager({ cwd, agentDir: AGENT_DIR, settingsManager }).resolve();
	return new Map(resources.extensions.map(entry => [resolve(entry.path), entry.enabled]));
}
function exactPath(pattern: string, base: string): string {
	const expanded = pattern.startsWith("~/") ? join(homedir(), pattern.slice(2)) : pattern;
	return resolve(base, expanded);
}
function isSelf(entry: Entry): boolean {
	return entry.path === SELF;
}
function isExtensionFile(name: string): boolean {
	return (name.endsWith(".ts") || name.endsWith(".js")) && !name.endsWith(".d.ts");
}
async function fileEntries(cwd: string): Promise<Entry[]> {
	const entries: Entry[] = [];
	const resources = await localResources(cwd);
	for (const dir of extensionDirs(cwd)) {
		const base = dirname(dir);
		const scope = base === AGENT_DIR ? "user" : "project";
		for (const name of readdirSync(dir)) {
			let path = join(dir, name);
			if (!existsSync(path)) continue;
			if (statSync(path).isDirectory()) {
				const index = ["index.ts", "index.js"].find(file => existsSync(join(path, file)) && statSync(join(path, file)).isFile());
				if (!index) continue;
				path = join(path, index);
			} else if (!isExtensionFile(name) || !statSync(path).isFile()) continue;
			const id = `${scope}:${relative(base, path).split(sep).join("/")}`;
			entries.push({ id, kind: "file", enabled: resources.get(path) ?? false, path, settingsPath: join(base, "settings.json"), cwd });
		}
	}
	return entries;
}
function packageEntries(config: ManagerConfig): Entry[] {
	const active = (readSettings().packages ?? []).map(spec => ({ id: spec, kind: "package" as const, enabled: true }));
	const inactive = config.disabledPackages.map(spec => ({ id: spec, kind: "package" as const, enabled: false }));
	return [...active, ...inactive];
}
async function inventory(cwd: string, config: ManagerConfig): Promise<Entry[]> {
	const all = [...await fileEntries(cwd), ...packageEntries(config)];
	all.sort((a, b) => a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "file" ? -1 : 1);
	return all;
}

/** Update native local-resource filters, or move a package spec between settings and config. */
async function setEnabled(entry: Entry, enabled: boolean, config: ManagerConfig): Promise<void> {
	if (entry.enabled === enabled) return;
	if (!enabled && isSelf(entry)) throw new Error("Refusing to disable the extension manager itself");
	if (entry.kind === "file") {
		const { path, settingsPath, cwd } = entry;
		if (!path || !settingsPath || !cwd) throw new Error("Missing local extension scope");
		const base = dirname(settingsPath);
		const target = relative(base, path).split(sep).join("/");
		const settings = readSettings(settingsPath);
		settings.extensions = (settings.extensions ?? []).filter(pattern => !(pattern.startsWith("-") && exactPath(pattern.slice(1), base) === path));
		if (!enabled) settings.extensions.push(`-${target}`);
		let resources = await localResources(cwd, settingsPath, settings);
		if (enabled && !resources.get(path)) {
			if (!settings.extensions.includes(`+${target}`)) settings.extensions.push(`+${target}`);
			resources = await localResources(cwd, settingsPath, settings);
		}
		if (resources.get(path) !== enabled) {
			throw new Error(`Cannot ${enabled ? "enable" : "disable"} ${entry.id}: blocked by another scope or resource filter; settings unchanged`);
		}
		writeJson(settingsPath, settings);
	} else {
		const settings = readSettings();
		const packages = settings.packages ?? [];
		if (enabled) {
			config.disabledPackages = config.disabledPackages.filter(spec => spec !== entry.id);
			settings.packages = packages.includes(entry.id) ? packages : [...packages, entry.id];
		} else {
			settings.packages = packages.filter(spec => spec !== entry.id);
			if (!config.disabledPackages.includes(entry.id)) config.disabledPackages.push(entry.id);
		}
		writeJson(SETTINGS_PATH, settings);
	}
	entry.enabled = enabled;
}

/** Persist defaults for subsequent reloads; this cannot undo first-load execution. */
async function applyDefaultForNew(cwd: string): Promise<string[]> {
	const config = readConfig();
	const seen = new Set(config.seen);
	const touched: string[] = [];
	for (const entry of await inventory(cwd, config)) {
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		// Native exclusions are explicit user choices, not newly enabled defaults.
		if (!isSelf(entry) && config.defaultForNew === "disable" && entry.enabled) {
			await setEnabled(entry, false, config);
			touched.push(entry.id);
		}
		config.defaults[entry.id] ??= entry.enabled;
	}
	if (touched.length > 0 || seen.size !== config.seen.length) {
		config.seen = [...seen];
		writeConfig(config);
	}
	return touched;
}
async function toggleExtensions(ctx: ExtensionContext): Promise<void> {
	const DONE = "✓ Close";
	const config = readConfig();
	const entries = await inventory(ctx.cwd, config);
	let changed = 0;
	for (;;) {
		const options = [DONE, ...entries.map(entry => `${entry.enabled ? "[x]" : "[ ]"} ${entry.id}${entry.kind === "package" ? "  (package)" : ""}`)];
		const choice = await ctx.ui.select(`Extensions (${entries.filter(entry => entry.enabled).length}/${entries.length} enabled)`, options);
		if (choice === undefined || choice === DONE) break;
		const entry = entries[options.indexOf(choice) - 1];
		if (!entry) continue;
		if (isSelf(entry) && entry.enabled) {
			ctx.ui.notify("Refusing to disable the extension manager itself", "warning");
			continue;
		}
		await setEnabled(entry, !entry.enabled, config);
		changed++;
	}
	writeConfig(config);
	if (changed > 0) ctx.ui.notify(`${changed} change(s) — /reload or restart pi to apply`, "info");
}
async function saveDefaults(ctx: ExtensionContext): Promise<void> {
	const config = readConfig();
	for (const entry of await inventory(ctx.cwd, config)) config.defaults[entry.id] = entry.enabled;
	writeConfig(config);
	ctx.ui.notify("Saved the current on/off state as the default", "info");
}
async function applyDefaults(ctx: ExtensionContext): Promise<void> {
	const config = readConfig();
	const applied: string[] = [];
	for (const entry of await inventory(ctx.cwd, config)) {
		const wanted = config.defaults[entry.id];
		if (wanted === undefined || wanted === entry.enabled) continue;
		if (isSelf(entry) && !wanted) continue;
		await setEnabled(entry, wanted, config);
		applied.push(`${wanted ? "+" : "-"}${entry.id}`);
	}
	writeConfig(config);
	ctx.ui.notify(applied.length === 0 ? "Already at defaults" : `Restored defaults: ${applied.join(", ")} — /reload or restart pi to apply`, "info");
}
async function editDefaultForNew(ctx: ExtensionContext): Promise<void> {
	const config = readConfig();
	const choice = await ctx.ui.select(`New extensions (current: ${config.defaultForNew})`, ["enable", "disable"]) as DefaultForNew | undefined;
	if (!choice) return;
	config.defaultForNew = choice;
	writeConfig(config);
	ctx.ui.notify(`Newly discovered extensions will be ${choice}d`, "info");
}
async function showState(ctx: ExtensionContext): Promise<void> {
	const config = readConfig();
	const lines = (await inventory(ctx.cwd, config)).map(entry => {
		const def = config.defaults[entry.id];
		return `${entry.enabled ? "on " : "off"}  ${entry.id}  (${def === undefined ? "no default" : `default ${def ? "on" : "off"}`})`;
	});
	ctx.ui.notify([`New extensions: ${config.defaultForNew}`, "", ...lines].join("\n"), "info");
}

export default async function extensionManagerExtension(pi: ExtensionAPI): Promise<void> {
	pi.registerCommand("extensions", {
		description: "Enable or disable extensions and manage their default state",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/extensions needs an interactive UI", "error");
				return;
			}
			const actions: Record<string, (ctx: ExtensionContext) => void | Promise<void>> = {
				"Show state": showState,
				"Enable / disable extensions": toggleExtensions,
				"Save current state as default": saveDefaults,
				"Apply defaults now": applyDefaults,
				"Default for new extensions": editDefaultForNew,
			};
			try {
				const touched = await applyDefaultForNew(ctx.cwd);
				if (touched.length > 0) ctx.ui.notify(`Applied default for new extensions: ${touched.join(", ")} — /reload or restart pi to apply`, "info");
				const choice = await ctx.ui.select("Extensions", Object.keys(actions));
				if (choice === undefined) return;
				await actions[choice]?.(ctx);
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});
	try {
		await applyDefaultForNew(process.cwd());
	} catch {
		// Never block startup; command invocation reports invalid configuration.
	}
}
