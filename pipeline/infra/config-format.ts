import { Document, isSeq, parseDocument, visit } from "yaml";
import { createTwoFilesPatch } from "diff";
import type { Config } from "../core.ts";

/** Only YAML's core scalar types; duplicate keys and ambiguous/custom tags fail closed. */
export function parseConfigYaml(text: string): unknown {
	const document = parseDocument(text, { uniqueKeys: true });
	const problem = document.errors[0] ?? document.warnings[0];
	if (problem) throw new Error(`Invalid pipeline YAML: ${problem.message}`);
	return document.toJS({ maxAliasCount: 0 });
}

/** Stable block mappings with literal argv arrays kept on one line. */
export function formatYaml(value: unknown): string {
	const document = new Document(value);
	visit(document, {
		Pair(_key, pair) {
			if (String(pair.key) === "command" && isSeq(pair.value)) pair.value.flow = true;
		},
	});
	return document.toString({ lineWidth: 0, flowCollectionPadding: false });
}

export function formatConfigYaml(config: Config): string {
	return formatYaml({ ...(config.prepare ? { prepare: config.prepare } : {}), suites: config.suites });
}

/** Diff normalized sections, never unrelated suites; labels retain context for every hunk. */
export function configurationReview(before: Config | undefined, after: Config): string {
	if (!before) return `New configuration (.pi/pipeline.yaml):\n${formatConfigYaml(after)}`;
	const changes: string[] = [];
	const section = (name: string, previous: unknown, next: unknown) => {
		if (JSON.stringify(previous) === JSON.stringify(next)) return;
		changes.push(createTwoFilesPatch(
			`a/.pi/pipeline.yaml (${name})`, `b/.pi/pipeline.yaml (${name})`,
			previous === undefined ? "" : formatYaml(previous), next === undefined ? "" : formatYaml(next),
			undefined, undefined, { context: 1 },
		));
	};
	section("prepare", before.prepare === undefined ? undefined : { prepare: before.prepare }, after.prepare === undefined ? undefined : { prepare: after.prepare });
	const previousNames = Object.keys(before.suites), nextNames = Object.keys(after.suites);
	section("suite execution order", previousNames, nextNames);
	for (const name of new Set([...previousNames, ...nextNames])) {
		const block = (config: Config) => Object.hasOwn(config.suites, name) ? { suites: { [name]: config.suites[name] } } : undefined;
		section(`suites.${name}`, block(before), block(after));
	}
	return changes.length ? `Configuration changes:\n${changes.join("\n")}` : "No configuration changes.";
}
