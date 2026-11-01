/** Facts about finished work, gathered from the repository rather than the conversation. */
export interface ReviewFacts {
	feature: string;
	root: string;
	branch: string;
	head: { sha: string; subject: string };
	/** Undefined when no base could be determined; only uncommitted work is then in scope. */
	base?: { sha: string; source: string };
	commits: string[];
	/** `git status --porcelain` lines, e.g. ` M src/app.ts`. */
	uncommitted: string[];
	/** Repository-relative paths changed since base, committed or not. */
	changed: string[];
	plans: string[];
	mockups: string[];
	/** `path:line`, matched text. */
	approvals: { location: string; text: string }[];
}

export type PathConcern = "code" | "tests" | "docs" | "artifacts";

export type ParsedArguments =
	| { ok: true; feature: string | undefined; base: string | undefined }
	| { ok: false };

export const USAGE = "Usage: /handoff review [--base <ref>] [feature name]";

const LIST_LIMIT = 100;

export function parseArguments(args: string): ParsedArguments {
	const words = args.trim().split(/\s+/).filter(Boolean);
	if (words.shift() !== "review") return { ok: false };
	let base: string | undefined;
	if (words[0] === "--base") {
		base = words[1];
		if (!base || base.startsWith("-")) return { ok: false };
		words.splice(0, 2);
	}
	if (words.some(word => word.startsWith("--"))) return { ok: false };
	return { ok: true, feature: words.length ? words.join(" ") : undefined, base };
}

export function classifyPath(path: string): PathConcern {
	if (/^(plans|mockups)\//.test(path)) return "artifacts";
	if (/(^|\/)(tests?|__tests__|spec)\//.test(path) || /\.(test|spec)\.[^./]+$/.test(path)) return "tests";
	if (/^docs\//.test(path) || /\.md$/i.test(path)) return "docs";
	return "code";
}

export function reviewSessionName(feature: string): string {
	return `Review: ${feature}`;
}

function capped(items: string[], format: (item: string) => string): string[] {
	const shown = items.slice(0, LIST_LIMIT).map(format);
	if (items.length > LIST_LIMIT) shown.push(`… and ${items.length - LIST_LIMIT} more`);
	return shown;
}

const code = (text: string) => `\`${text}\``;

function inline(label: string, items: string[]): string {
	return `- ${label} (${items.length}): ${items.length ? capped(items, code).join(", ") : "none"}`;
}

function nested(label: string, items: string[], format: (item: string) => string): string[] {
	if (!items.length) return [`- ${label}: none`];
	return [`- ${label} (${items.length}):`, ...capped(items, format).map(item => `  - ${item}`)];
}

export function knownGaps(facts: ReviewFacts): string[] {
	const byConcern = (concern: PathConcern) => facts.changed.filter(path => classifyPath(path) === concern);
	const gaps: string[] = [];
	if (!facts.base) gaps.push("Could not determine a base commit; only uncommitted changes are listed. Rerun with `/handoff review --base <ref>`.");
	if (!facts.changed.length) gaps.push("No changed files found in scope.");
	if (!facts.plans.length) gaps.push("No plan directory under `plans/` matches this change.");
	if (!byConcern("tests").length) gaps.push("No test files changed.");
	if (!byConcern("docs").length) gaps.push("No documentation files changed.");
	gaps.push("Verification results are not recorded in this handoff; run the relevant checks yourself.");
	return gaps;
}

export function formatHandoff(facts: ReviewFacts): string {
	const byConcern = (concern: PathConcern) => facts.changed.filter(path => classifyPath(path) === concern);
	const base = facts.base ? `${code(facts.base.sha)} (${facts.base.source})` : "unknown";
	return [
		`# Review handoff: ${facts.feature}`,
		"",
		"Independently review this implementation with the code-reviewer skill. This handoff lists repository facts only; it carries no conclusions from the implementation session.",
		"",
		"## Scope",
		"",
		`- Repository: ${code(facts.root)}`,
		`- Branch: ${code(facts.branch)}`,
		`- Base: ${base}`,
		`- Head: ${code(facts.head.sha)} ${facts.head.subject}`,
		...nested("Commits", facts.commits, commit => commit),
		...nested("Uncommitted changes", facts.uncommitted, code),
		"",
		"## Artifacts",
		"",
		`- Plans: ${facts.plans.length ? capped(facts.plans, code).join(", ") : "none found"}`,
		`- Mockups: ${facts.mockups.length ? capped(facts.mockups, code).join(", ") : "none found"}`,
		...(facts.approvals.length
			? ["- Approval references:", ...facts.approvals.map(approval => `  - ${code(approval.location)}: ${approval.text}`)]
			: ["- Approval references: none found"]),
		"",
		"## Changed files",
		"",
		inline("Code", byConcern("code")),
		inline("Tests", byConcern("tests")),
		inline("Docs", byConcern("docs")),
		inline("Plans and mockups", byConcern("artifacts")),
		"",
		"## Known gaps",
		"",
		...knownGaps(facts).map(gap => `- ${gap}`),
		"",
		"## Review rules",
		"",
		"- Compare the implementation and affected current documentation against the approved plans, scenarios and mockups.",
		"- Report findings only; do not modify code, documentation, plans or mockups.",
		"- Do not clean up plans or treat the feature as accepted; that needs the user's explicit acceptance.",
		"",
	].join("\n");
}
