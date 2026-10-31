import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Adds Claude Code rules (`.claude/rules/**\/*.md`) to Pi's system prompt.
 *
 * Rules come from `~/.claude/rules` and from every `.claude/rules` between the
 * filesystem root and the working directory, outermost first so the nearest
 * project rules are read last. Files are reread before each run, so edits apply
 * without a reload. Claude Code's `paths:` frontmatter is dropped: every rule
 * applies everywhere, like Pi's own context files.
 */

const SECTION = "claude_rules";

/** `~/.claude/rules` first, then `<dir>/.claude/rules` from the root down to `cwd`. */
function ruleDirectories(cwd: string, home: string): string[] {
 const ancestors: string[] = [];
 for (let dir = resolve(cwd); ; dir = dirname(dir)) {
  ancestors.unshift(dir);
  if (dirname(dir) === dir) break;
 }
 const dirs = [home, ...ancestors].map(dir => join(dir, ".claude", "rules"));
 return [...new Set(dirs)].filter(dir => existsSync(dir));
}

function markdownFiles(dir: string): string[] {
 return readdirSync(dir, { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap(entry => {
   const path = join(dir, entry.name);
   if (entry.isDirectory()) return markdownFiles(path);
   return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

const withoutFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();

export function claudeRulesPrompt(cwd: string, home = homedir()): string | undefined {
 const rules = ruleDirectories(cwd, home).flatMap(markdownFiles).flatMap(path => {
  const text = withoutFrontmatter(readFileSync(path, "utf8"));
  const shown = relative(cwd, path).startsWith("..") ? path : relative(cwd, path);
  return text ? [`## ${shown}\n\n${text}`] : [];
 });
 if (!rules.length) return undefined;
 return ["# Claude rules", "Follow these rules from `.claude/rules`.", ...rules].join("\n\n");
}

export default function claudeRules(pi: ExtensionAPI, home = homedir()): void {
 pi.on("before_agent_start", async (event, ctx) => {
  // Repository dev types predate sections; the supported Pi runtime supplies it.
  const options = event.systemPromptOptions as typeof event.systemPromptOptions & { sections?: Record<string, string> };
  if (!options.sections) {
   ctx.ui.notify("Claude rules require a Pi runtime with structured system prompt sections.", "error");
   return;
  }
  try {
   const prompt = claudeRulesPrompt(ctx.cwd, home);
   if (prompt) options.sections[SECTION] = prompt;
   else delete options.sections[SECTION];
  } catch (error) {
   ctx.ui.notify(`Claude rules unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
 });
}
