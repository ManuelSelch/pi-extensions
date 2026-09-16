/**
 * Extension Manager
 *
 * Adds /extensions to turn individual extensions on and off, and to record the
 * state they should have by default.
 *
 * Two kinds of extensions are managed:
 *   - file extensions in ~/.pi/agent/extensions and <cwd>/.pi/extensions.
 *     Disabling renames `foo.ts` to `foo.ts.disabled` so the loader, which only
 *     picks up *.ts / *.js, skips it. Enabling renames it back.
 *   - package extensions listed under `packages` in settings.json. Disabling
 *     moves the entry into this extension's own config so it can be restored.
 *
 * Defaults live in ~/.pi/agent/extension-manager.json:
 *   defaults      - the on/off state "Apply defaults" restores.
 *   defaultForNew - what happens to an extension seen for the first time
 *                   ("enable" or "disable"), applied at startup.
 *
 * Changes take effect on the next pi start (or /reload for freshly enabled
 * files); nothing is unloaded from the running session.
 */

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const AGENT_DIR = join(homedir(), ".pi", "agent");
const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
const CONFIG_PATH = join(AGENT_DIR, "extension-manager.json");
const DISABLED_SUFFIX = ".disabled";
const SELF = basename(import.meta.filename ?? "extension-manager.ts");

type DefaultForNew = "enable" | "disable";

interface ManagerConfig {
	/** id -> should be enabled. Restored by "Apply defaults". */
	defaults: Record<string, boolean>;
	/** Extensions already known, so "new" really means new. */
	seen: string[];
	/** Package specs removed from settings.packages by this extension. */
	disabledPackages: string[];
	defaultForNew: DefaultForNew;
}

interface Settings {
	packages?: string[];
	[key: string]: unknown;
}

/** One manageable extension, either a file on disk or a package spec. */
interface Entry {
	id: string;
	kind: "file" | "package";
	enabled: boolean;
	/** Current path on disk, for file entries. */
	path?: string;
}

function readJson<T>(path: string, fallback: T): T {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
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
		defaults: raw.defaults ?? {},
		seen: raw.seen ?? [],
		disabledPackages: raw.disabledPackages ?? [],
		defaultForNew: raw.defaultForNew === "disable" ? "disable" : "enable",
	};
}

const writeConfig = (config: ManagerConfig) => writeJson(CONFIG_PATH, config);
const readSettings = () => readJson<Settings>(SETTINGS_PATH, {});
const writeSettings = (settings: Settings) => writeJson(SETTINGS_PATH, settings);

function extensionDirs(cwd: string): string[] {
	return [join(AGENT_DIR, "extensions"), join(cwd, ".pi", "extensions")].filter(existsSync);
}

function isExtensionFile(name: string): boolean {
	return (name.endsWith(".ts") || name.endsWith(".js")) && !name.endsWith(".d.ts");
}

function fileEntries(cwd: string): Entry[] {
	const entries: Entry[] = [];
	for (const dir of extensionDirs(cwd)) {
		for (const name of readdirSync(dir)) {
			const disabled = name.endsWith(DISABLED_SUFFIX);
			const bare = disabled ? name.slice(0, -DISABLED_SUFFIX.length) : name;
			if (!isExtensionFile(bare)) continue;
			entries.push({ id: bare, kind: "file", enabled: !disabled, path: join(dir, name) });
		}
	}
	return entries;
}

function packageEntries(config: ManagerConfig): Entry[] {
	const active = (readSettings().packages ?? []).map((spec) => ({
		id: spec,
		kind: "package" as const,
		enabled: true,
	}));
	const inactive = config.disabledPackages.map((spec) => ({
		id: spec,
		kind: "package" as const,
		enabled: false,
	}));
	return [...active, ...inactive];
}

function inventory(cwd: string, config: ManagerConfig): Entry[] {
	const all = [...fileEntries(cwd), ...packageEntries(config)];
	all.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "file" ? -1 : 1));
	return all;
}

/** Rename a file entry, or move a package spec between settings and config. */
function setEnabled(entry: Entry, enabled: boolean, config: ManagerConfig): void {
	if (entry.enabled === enabled) return;

	if (entry.kind === "file") {
		if (!entry.path) return;
		const target = enabled ? entry.path.slice(0, -DISABLED_SUFFIX.length) : `${entry.path}${DISABLED_SUFFIX}`;
		renameSync(entry.path, target);
		entry.path = target;
	} else {
		const settings = readSettings();
		const packages = settings.packages ?? [];
		if (enabled) {
			config.disabledPackages = config.disabledPackages.filter((spec) => spec !== entry.id);
			settings.packages = packages.includes(entry.id) ? packages : [...packages, entry.id];
		} else {
			settings.packages = packages.filter((spec) => spec !== entry.id);
			if (!config.disabledPackages.includes(entry.id)) config.disabledPackages.push(entry.id);
		}
		writeSettings(settings);
	}

	entry.enabled = enabled;
}

/**
 * Apply `defaultForNew` to extensions never seen before. Runs at startup so a
 * newly dropped-in extension does not silently become active when the user
 * asked for opt-in behaviour.
 */
function applyDefaultForNew(cwd: string): string[] {
	const config = readConfig();
	const seen = new Set(config.seen);
	const touched: string[] = [];

	for (const entry of inventory(cwd, config)) {
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		const enabled = config.defaultForNew === "enable";
		if (entry.id !== SELF && entry.enabled !== enabled) {
			setEnabled(entry, enabled, config);
			touched.push(entry.id);
		}
		config.defaults[entry.id] ??= enabled;
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
	const entries = inventory(ctx.cwd, config);
	let changed = 0;

	for (;;) {
		const options = [
			DONE,
			...entries.map(
				(entry) =>
					`${entry.enabled ? "[x]" : "[ ]"} ${entry.id}${entry.kind === "package" ? "  (package)" : ""}`,
			),
		];
		const choice = await ctx.ui.select(
			`Extensions (${entries.filter((entry) => entry.enabled).length}/${entries.length} enabled)`,
			options,
		);
		if (choice === undefined || choice === DONE) break;

		const entry = entries[options.indexOf(choice) - 1];
		if (!entry) continue;
		if (entry.id === SELF && entry.enabled) {
			ctx.ui.notify("Refusing to disable the extension manager itself", "warning");
			continue;
		}
		setEnabled(entry, !entry.enabled, config);
		changed++;
	}

	writeConfig(config);
	if (changed > 0) ctx.ui.notify(`${changed} change(s) — restart pi to apply`, "info");
}

function saveDefaults(ctx: ExtensionContext): void {
	const config = readConfig();
	for (const entry of inventory(ctx.cwd, config)) config.defaults[entry.id] = entry.enabled;
	writeConfig(config);
	ctx.ui.notify("Saved the current on/off state as the default", "info");
}

function applyDefaults(ctx: ExtensionContext): void {
	const config = readConfig();
	const applied: string[] = [];
	for (const entry of inventory(ctx.cwd, config)) {
		const wanted = config.defaults[entry.id];
		if (wanted === undefined || wanted === entry.enabled) continue;
		if (entry.id === SELF && !wanted) continue;
		setEnabled(entry, wanted, config);
		applied.push(`${wanted ? "+" : "-"}${entry.id}`);
	}
	writeConfig(config);
	ctx.ui.notify(
		applied.length === 0 ? "Already at defaults" : `Restored defaults: ${applied.join(", ")} — restart pi to apply`,
		"info",
	);
}

async function editDefaultForNew(ctx: ExtensionContext): Promise<void> {
	const config = readConfig();
	const choice = (await ctx.ui.select(`New extensions (current: ${config.defaultForNew})`, [
		"enable",
		"disable",
	])) as DefaultForNew | undefined;
	if (!choice) return;
	config.defaultForNew = choice;
	writeConfig(config);
	ctx.ui.notify(`Newly discovered extensions will be ${choice}d`, "info");
}

function showState(ctx: ExtensionContext): void {
	const config = readConfig();
	const lines = inventory(ctx.cwd, config).map((entry) => {
		const def = config.defaults[entry.id];
		const defText = def === undefined ? "no default" : `default ${def ? "on" : "off"}`;
		return `${entry.enabled ? "on " : "off"}  ${entry.id}  (${defText})`;
	});
	ctx.ui.notify([`New extensions: ${config.defaultForNew}`, "", ...lines].join("\n"), "info");
}

let pi!: ExtensionAPI;

export default function extensionManagerExtension(api: ExtensionAPI): void {
	pi = api;

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
				const touched = applyDefaultForNew(ctx.cwd);
				if (touched.length > 0) {
					ctx.ui.notify(`Applied default for new extensions: ${touched.join(", ")}`, "info");
				}
				const choice = await ctx.ui.select("Extensions", Object.keys(actions));
				if (!choice) return;
				await actions[choice]?.(ctx);
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});

	// Startup pass: only acts when defaultForNew is "disable" and something new showed up.
	try {
		applyDefaultForNew(process.cwd());
	} catch {
		// Never block startup because of this.
	}
}
