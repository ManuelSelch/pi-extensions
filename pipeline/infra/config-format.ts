import { Document, isSeq, parseDocument, visit } from "yaml";
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
