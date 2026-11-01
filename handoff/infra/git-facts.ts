import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ReviewFacts } from "../domain/handoff.js";

/** Pi's `exec`: runs without a shell and resolves with the exit code. */
export type Exec = (command: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; code: number }>;

export class HandoffFactsError extends Error {}

const APPROVAL = /\b(approv\w*|accepted)\b/i;

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `git status --porcelain=v1 -z` entries; renames and copies carry their source path next. */
function parseStatus(output: string): { line: string; path: string }[] {
	const fields = output.split("\0").filter(Boolean);
	const entries: { line: string; path: string }[] = [];
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]!;
		const status = field.slice(0, 2), path = field.slice(3);
		if (/[RC]/.test(status)) {
			const source = fields[++index] ?? "";
			entries.push({ line: `${status} ${source} -> ${path}`, path });
		} else entries.push({ line: `${status} ${path}`, path });
	}
	return entries;
}

function artifactFiles(root: string, area: "plans" | "mockups", directory: string, preferred?: string): string[] {
	const absolute = join(root, area, directory);
	const markdown = readdirSync(absolute, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
		.map(entry => entry.name).sort();
	const chosen = preferred && markdown.includes(preferred) ? [preferred] : markdown;
	return chosen.length ? chosen.map(name => `${area}/${directory}/${name}`) : [`${area}/${directory}/`];
}

/** Plan/mockup folders named after the feature, or touched by this change. */
function matchingArtifacts(root: string, area: "plans" | "mockups", names: string[], changed: string[], preferred?: string): string[] {
	const folder = join(root, area);
	if (!existsSync(folder) || !statSync(folder).isDirectory()) return [];
	return readdirSync(folder, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name).sort()
		.filter(name => names.includes(name) || changed.some(path => path.startsWith(`${area}/${name}/`)))
		.flatMap(name => artifactFiles(root, area, name, preferred));
}

function approvalLines(root: string, files: string[]): ReviewFacts["approvals"] {
	return files.filter(file => file.endsWith(".md")).flatMap(file => readFileSync(join(root, file), "utf8").split("\n")
		.map((text, index) => ({ location: `${file}:${index + 1}`, text: text.trim().slice(0, 200) }))
		.filter(line => APPROVAL.test(line.text)));
}

export async function collectReviewFacts(exec: Exec, cwd: string, request: { feature?: string; base?: string }): Promise<ReviewFacts> {
	const run = async (args: string[], directory: string): Promise<string | undefined> => {
		const result = await exec("git", args, { cwd: directory });
		return result.code === 0 ? result.stdout : undefined;
	};
	const root = (await run(["rev-parse", "--show-toplevel"], cwd))?.trim();
	if (!root) throw new HandoffFactsError("/handoff review needs a Git repository. Nothing changed.");
	const git = (...args: string[]) => run(args, root).then(output => output?.trim());

	const head = await git("rev-parse", "HEAD");
	if (!head) throw new HandoffFactsError("This repository has no commits to review. Nothing changed.");
	const branch = (await git("rev-parse", "--abbrev-ref", "HEAD")) ?? "HEAD";
	const subject = (await git("log", "-1", "--format=%s")) ?? "";

	const defaultBranch = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
		?? (await git("rev-parse", "--verify", "--quiet", "refs/heads/main") ? "main" : undefined)
		?? (await git("rev-parse", "--verify", "--quiet", "refs/heads/master") ? "master" : undefined);
	const onDefault = defaultBranch?.replace(/^origin\//, "") === branch;

	let base: ReviewFacts["base"];
	if (request.base) {
		const sha = await git("rev-parse", "--verify", "--quiet", `${request.base}^{commit}`);
		if (!sha) throw new HandoffFactsError(`Unknown base ref: ${request.base}. Nothing changed.`);
		base = { sha, source: `--base ${request.base}` };
	} else {
		// A feature branch is reviewed since it left the default branch; work on
		// the default branch itself is reviewed since its upstream.
		const reference = defaultBranch && !onDefault
			? defaultBranch
			: await git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
		const sha = reference ? await git("merge-base", reference, "HEAD") : undefined;
		if (reference && sha) base = { sha, source: `merge-base with ${reference}` };
	}

	const scope = async (args: string[]): Promise<string> => {
		const output = await run(args, root);
		if (output === undefined) throw new HandoffFactsError(`Could not read Git review scope (${args[0]}). Nothing changed.`);
		return output;
	};
	const commits = base ? (await scope(["log", "--format=%h %s", `${base.sha}..HEAD`])).trim().split("\n").filter(Boolean) : [];
	const committed = base ? (await scope(["diff", "--name-only", "-z", base.sha, "HEAD"])).split("\0").filter(Boolean) : [];
	const status = parseStatus(await scope(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
	const changed = [...new Set([...committed, ...status.map(entry => entry.path)])].sort();

	const branchName = branch !== "HEAD" && !onDefault ? branch.split("/").pop() : undefined;
	const names = [branchName, request.feature].filter((name): name is string => !!name).map(slug);
	const plans = matchingArtifacts(root, "plans", names, changed);
	const mockups = matchingArtifacts(root, "mockups", names, changed, "DESIGN.md");
	const planFolders = [...new Set(plans.map(file => file.split("/")[1]!))];
	const feature = request.feature ?? (planFolders.length === 1 ? planFolders[0] : undefined) ?? branchName ?? basename(root);

	return {
		feature, root, branch, head: { sha: head, subject }, base, commits,
		uncommitted: status.map(entry => entry.line), changed, plans, mockups,
		approvals: approvalLines(root, [...plans, ...mockups]),
	};
}
