/**
 * Agent Defaults Extension
 *
 * Adds /defaults to edit the global settings.json fields that decide what a new
 * session starts with: defaultProvider, defaultModel, defaultThinkingLevel and
 * enabledModels. Other settings keys are preserved untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

interface Settings {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevelName;
	enabledModels?: string[];
	[key: string]: unknown;
}

function readSettings(): Settings {
	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Settings) : {};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`Cannot read ${SETTINGS_PATH}: ${(error as Error).message}`);
	}
}

function writeSettings(settings: Settings): void {
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function update(mutate: (settings: Settings) => void): void {
	const settings = readSettings();
	mutate(settings);
	writeSettings(settings);
}

type CatalogueModel = ReturnType<ExtensionContext["modelRegistry"]["getAll"]>[number];

function modelRef(model: CatalogueModel): string {
	return `${model.provider}/${model.id}`;
}

/** Strips the optional ":<thinking level>" suffix accepted by enabledModels patterns. */
function patternBase(pattern: string): string {
	const colon = pattern.lastIndexOf(":");
	return colon === -1 ? pattern : pattern.slice(0, colon);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPattern(reference: string, pattern: string): boolean {
	const base = patternBase(pattern).toLowerCase();
	const target = reference.toLowerCase();
	if (!base.includes("*")) return base === target;

	const regex = new RegExp(`^${base.split("*").map(escapeRegex).join(".*")}$`);
	return regex.test(target);
}

function enabledModelPatterns(settings: Settings): string[] {
	return Array.isArray(settings.enabledModels)
		? settings.enabledModels.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function isEnabled(ref: string, patterns: string[]): boolean {
	return patterns.length === 0 || patterns.some((pattern) => matchesPattern(ref, pattern));
}

/** Returns catalogue references visible under the configured enabledModels patterns. */
export function visibleModelRefs(references: readonly string[], patterns: readonly string[]): string[] {
	return [...references].filter((ref) => isEnabled(ref, [...patterns]));
}

/** Canonical "provider/modelId" references of every model in the registry. */
function modelRefs(ctx: ExtensionContext, settings = readSettings()): string[] {
	const patterns = enabledModelPatterns(settings);
	return visibleModelRefs(ctx.modelRegistry.getAll().map(modelRef), patterns).sort();
}

function providers(ctx: ExtensionContext): string[] {
	const refs = modelRefs(ctx);
	return [...new Set(refs.map((ref) => ref.slice(0, ref.indexOf("/"))))].sort();
}

async function editProvider(ctx: ExtensionContext): Promise<void> {
	const current = readSettings().defaultProvider;
	const choice = await ctx.ui.select(
		`Default provider (current: ${current ?? "unset"})`,
		providers(ctx),
	);
	if (!choice) return;
	update((settings) => {
		settings.defaultProvider = choice;
	});
	ctx.ui.notify(`defaultProvider set to ${choice}`, "info");
}

async function editModel(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	const settings = readSettings();
	const refs = modelRefs(ctx, settings);
	if (refs.length === 0) {
		ctx.ui.notify("No models match enabledModels. Adjust Enabled models first.", "warning");
		return;
	}
	const choice = await ctx.ui.select(
		`Default model (current: ${settings.defaultModel ?? "unset"})`,
		refs,
	);
	if (!choice) return;

	const slash = choice.indexOf("/");
	const provider = choice.slice(0, slash);
	const modelId = choice.slice(slash + 1);
	update((next) => {
		next.defaultProvider = provider;
		next.defaultModel = modelId;
	});
	ctx.ui.notify(`defaultModel set to ${modelId} (provider ${provider})`, "info");

	const model = ctx.modelRegistry.find(provider, modelId);
	if (model && (await ctx.ui.confirm("Apply now?", "Also switch the current session to this model?"))) {
		const ok = await pi.setModel(model);
		ctx.ui.notify(ok ? `Session model: ${modelId}` : `No auth configured for ${provider}`, ok ? "info" : "warning");
	}
}

async function editThinkingLevel(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	const current = readSettings().defaultThinkingLevel;
	const choice = (await ctx.ui.select(
		`Default thinking level (current: ${current ?? "unset"})`,
		[...THINKING_LEVELS],
	)) as ThinkingLevelName | undefined;
	if (!choice) return;
	update((settings) => {
		settings.defaultThinkingLevel = choice;
	});
	ctx.ui.notify(`defaultThinkingLevel set to ${choice}`, "info");

	if (await ctx.ui.confirm("Apply now?", "Also set the current session's thinking level?")) {
		pi.setThinkingLevel(choice);
		ctx.ui.notify(`Session thinking level: ${pi.getThinkingLevel()}`, "info");
	}
}

async function editEnabledModels(ctx: ExtensionContext): Promise<void> {
	const DONE = "✓ Save and close";
	const CLEAR = "✗ Clear list (allow all models)";
	const refs = ctx.modelRegistry.getAll().map(modelRef).sort();
	const selected = new Set(enabledModelPatterns(readSettings()));
	let showEnabledOnly = false;

	for (;;) {
		// Keep configured patterns that do not name a catalogue entry (including globs)
		// visible, so opening and saving this picker cannot silently rewrite them.
		const unknown = [...selected].filter((pattern) => !refs.includes(pattern));
		const catalogueRefs = showEnabledOnly
			? visibleModelRefs(refs, [...selected]).sort()
			: refs;
		const modelOptions = [...catalogueRefs, ...unknown].map((ref) => ({
			label: `${selected.has(ref) ? "[x]" : "[ ]"} ${ref}`,
			ref,
		}));
		const toggle = `${showEnabledOnly ? "☑" : "☐"} Show enabled models only`;
		const options = [DONE, CLEAR, toggle, ...modelOptions.map((option) => option.label)];
		const choice = await ctx.ui.select(`enabledModels (${selected.size} selected)`, options);
		if (choice === undefined) return;
		if (choice === DONE) break;
		if (choice === CLEAR) {
			selected.clear();
			continue;
		}
		if (choice === toggle) {
			showEnabledOnly = !showEnabledOnly;
			continue;
		}

		const model = modelOptions.find((option) => option.label === choice);
		if (!model) continue;
		if (selected.has(model.ref)) selected.delete(model.ref);
		else selected.add(model.ref);
	}

	const list = [...selected];
	update((settings) => {
		if (list.length === 0) delete settings.enabledModels;
		else settings.enabledModels = list;
	});
	ctx.ui.notify(
		list.length === 0 ? "enabledModels cleared (all models available)" : `enabledModels: ${list.length} model(s)`,
		"info",
	);
}

function showCurrent(ctx: ExtensionContext): void {
	const settings = readSettings();
	const enabled = settings.enabledModels;
	ctx.ui.notify(
		[
			`defaultProvider: ${settings.defaultProvider ?? "unset"}`,
			`defaultModel: ${settings.defaultModel ?? "unset"}`,
			`defaultThinkingLevel: ${settings.defaultThinkingLevel ?? "unset"}`,
			`enabledModels: ${enabled?.length ? enabled.join(", ") : "unset (all models)"}`,
		].join("\n"),
		"info",
	);
}

export default function agentDefaultsExtension(pi: ExtensionAPI): void {

	pi.registerCommand("defaults", {
		description: "Edit global defaults: provider, model, thinking level, enabled models",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/defaults needs an interactive UI", "error");
				return;
			}

			const actions: Record<string, (ctx: ExtensionContext) => void | Promise<void>> = {
				"Show current defaults": showCurrent,
				"Default provider": editProvider,
				"Default model": (ctx) => editModel(ctx, pi),
				"Default thinking level": (ctx) => editThinkingLevel(ctx, pi),
				"Enabled models": editEnabledModels,
			};

			const choice = await ctx.ui.select("Global defaults (settings.json)", Object.keys(actions));
			if (!choice) return;

			try {
				await actions[choice]?.(ctx);
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});
}
