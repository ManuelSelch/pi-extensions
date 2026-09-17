/**
 * Model Filter Extension
 *
 * Pi's `enabledModels` setting scopes which models `/model` and Ctrl+P offer.
 * The built-in `/scoped-models` toggles that list live, but it only lists
 * models pi considers *available* — a provider you have not logged into yet
 * (say a freshly added `openai-codex-<account>`) cannot be put into the filter
 * there, and neither can a glob.
 *
 *   /models-filter             show the configured filter and what it resolves to
 *   /models-add [pattern...]   add models; no argument opens a picker over the
 *                              whole catalogue, including unauthenticated ones
 *   /models-remove [pattern]   drop an entry from the filter
 *
 * Patterns are whatever `enabledModels` accepts: "provider/model", a glob such
 * as "openai-codex-*∕*", and an optional ":<thinking level>" suffix.
 *
 * Writes go to ~/.pi/agent/settings.json. Pi keeps the session's scope in
 * memory, so additions apply to the next session; `/scoped-models` remains the
 * way to change the current one.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_FILE = join(getAgentDir(), "settings.json");

type CatalogueModel = ReturnType<ExtensionContext["modelRegistry"]["getAll"]>[number];

interface Settings {
	enabledModels?: string[];
	[key: string]: unknown;
}

function readSettings(): Settings {
	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Settings) : {};
	} catch {
		return {};
	}
}

function readFilter(): string[] {
	const enabled = readSettings().enabledModels;
	return Array.isArray(enabled) ? enabled.filter((entry) => typeof entry === "string") : [];
}

/**
 * Rewrites only `enabledModels`, re-reading the file first: pi merges its own
 * writes field by field, so both sides keep each other's changes as long as
 * they do not touch this field in the same moment.
 */
function writeFilter(patterns: string[]): void {
	const settings = readSettings();
	settings.enabledModels = patterns;
	writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8" });
}

function modelReference(model: CatalogueModel): string {
	return `${model.provider}/${model.id}`;
}

/** Strips the optional ":<thinking level>" suffix used by enabledModels patterns. */
function patternBase(pattern: string): string {
	const colon = pattern.lastIndexOf(":");
	return colon === -1 ? pattern : pattern.slice(0, colon);
}

function matchesPattern(reference: string, pattern: string): boolean {
	const base = patternBase(pattern).toLowerCase();
	const target = reference.toLowerCase();
	if (!base.includes("*")) return base === target;

	const regex = new RegExp(`^${base.split("*").map(escapeRegex).join(".*")}$`);
	return regex.test(target);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCovered(reference: string, patterns: string[]): boolean {
	return patterns.some((pattern) => matchesPattern(reference, pattern));
}

export default function modelFilterExtension(pi: ExtensionAPI): void {
	const describeFilter = (ctx: ExtensionContext, patterns: string[]): string[] => {
		const models = ctx.modelRegistry.getAll();
		return patterns.map((pattern) => {
			const matches = models.filter((model) => matchesPattern(modelReference(model), pattern));
			if (matches.length === 0) return `  ${pattern} — no match in the catalogue`;
			if (matches.length === 1 && !patternBase(pattern).includes("*")) {
				const configured = ctx.modelRegistry.hasConfiguredAuth(matches[0]!);
				return `  ${pattern}${configured ? "" : " — provider not logged in"}`;
			}
			return `  ${pattern} — ${matches.length} model${matches.length === 1 ? "" : "s"}`;
		});
	};

	const report = (ctx: ExtensionContext, added: string[], patterns: string[]): void => {
		ctx.ui.notify(
			[
				`Added to the model filter: ${added.join(", ")}`,
				`Filter now has ${patterns.length} entr${patterns.length === 1 ? "y" : "ies"}.`,
				"Applies to new sessions; use /scoped-models to change the current one.",
			].join("\n"),
			"info",
		);
	};

	pi.registerCommand("models-filter", {
		description: "Show the enabledModels filter and what it resolves to",
		handler: async (_args, ctx) => {
			const patterns = readFilter();
			if (patterns.length === 0) {
				ctx.ui.notify(
					`No model filter configured — every available model is offered. Add one with /models-add (${SETTINGS_FILE}).`,
					"info",
				);
				return;
			}
			ctx.ui.notify(
				[`Model filter (${SETTINGS_FILE}):`, ...describeFilter(ctx, patterns)].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("models-add", {
		description: "Add models to the enabledModels filter (no argument opens a picker)",
		handler: async (args, ctx) => {
			const patterns = readFilter();
			let requested = args.trim().split(/\s+/).filter(Boolean);

			if (requested.length === 0) {
				const candidates = ctx.modelRegistry
					.getAll()
					.map((model) => ({ model, reference: modelReference(model) }))
					.filter((entry) => !isCovered(entry.reference, patterns))
					.sort((a, b) => a.reference.localeCompare(b.reference));

				if (candidates.length === 0) {
					ctx.ui.notify("Every model in the catalogue already matches the filter.", "info");
					return;
				}

				const labels = new Map(
					candidates.map((entry) => [
						ctx.modelRegistry.hasConfiguredAuth(entry.model)
							? entry.reference
							: `${entry.reference}  (not logged in)`,
						entry.reference,
					]),
				);
				const choice = await ctx.ui.select("Add which model?", [...labels.keys()]);
				if (!choice) return;
				requested = [labels.get(choice) ?? choice];
			}

			const added = requested.filter(
				(pattern) => !patterns.some((existing) => existing.toLowerCase() === pattern.toLowerCase()),
			);
			if (added.length === 0) {
				ctx.ui.notify("Already in the filter.", "info");
				return;
			}

			const next = [...patterns, ...added];
			try {
				writeFilter(next);
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${SETTINGS_FILE}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			report(ctx, added, next);
		},
	});

	pi.registerCommand("models-remove", {
		description: "Remove an entry from the enabledModels filter",
		handler: async (args, ctx) => {
			const patterns = readFilter();
			if (patterns.length === 0) {
				ctx.ui.notify("No model filter configured.", "info");
				return;
			}

			const pattern = args.trim() || (await ctx.ui.select("Remove which entry?", patterns));
			if (!pattern) return;

			const next = patterns.filter((entry) => entry.toLowerCase() !== pattern.toLowerCase());
			if (next.length === patterns.length) {
				ctx.ui.notify(`"${pattern}" is not in the filter.`, "error");
				return;
			}

			try {
				writeFilter(next);
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${SETTINGS_FILE}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			ctx.ui.notify(
				next.length === 0
					? `Removed ${pattern}. The filter is now empty, so every available model is offered again (next session).`
					: `Removed ${pattern}. ${next.length} entries left; applies to new sessions.`,
				"info",
			);
		},
	});
}
