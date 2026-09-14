/**
 * Readonly Mode Extension
 *
 * Simple read-only mode that disables all write/modify tools.
 * Toggle with /readonly command or Ctrl+Alt+R shortcut.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Read-only tools allowed in readonly mode
const READONLY_TOOLS = ["read", "ls", "grep", "find", "questionnaire"];

// Full tool set for normal mode (edit and write are the write tools)
const NORMAL_TOOLS = ["read", "ls", "grep", "find", "questionnaire", "bash", "edit", "write"];

// Additional bash commands to block in readonly mode (destructive operations)
const BLOCKED_BASH_PATTERNS = [
	/^\s*rm\s+/i,
	/^\s*mv\s+/i,
	/^\s*cp\s+/i,
	/^\s*mkdir\s+/i,
	/^\s*rmdir\s+/i,
	/^\s*touch\s+/i,
	/^\s*>\s*/,
	/^\s*>>\s*/,
	/\|\s*tee\s+/i,
	/\b(git\s+(commit|push|merge|rebase|reset|checkout\s+-b|branch\s+-[dm]))\b/i,
];

export default function readonlyModeExtension(pi: ExtensionAPI): void {
	let readonlyEnabled = false;

	// Check if --readonly flag was passed
	if (pi.getFlag("readonly") === true) {
		readonlyEnabled = true;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (readonlyEnabled) {
			ctx.ui.setStatus("readonly", ctx.ui.theme.fg("warning", "READONLY"));
		} else {
			ctx.ui.setStatus("readonly", undefined);
		}
	}

	function toggleReadonly(ctx: ExtensionContext): void {
		readonlyEnabled = !readonlyEnabled;

		if (readonlyEnabled) {
			pi.setActiveTools(READONLY_TOOLS);
		} else {
			pi.setActiveTools(NORMAL_TOOLS);
		}

		updateStatus(ctx);
	}

	// Register /readonly command
	pi.registerCommand("readonly", {
		description: "Toggle readonly mode (blocks write/modify tools)",
		handler: async (_args, ctx) => {
			toggleReadonly(ctx);
		},
	});

	// Block write/edit tools in readonly mode
	pi.on("tool_call", async (event) => {
		if (!readonlyEnabled) return;

		// Block write and edit tools
		if (event.toolName === "write" || event.toolName === "edit") {
			return {
				block: true,
				reason: "Readonly mode active: file modifications are blocked. Use /readonly to disable.",
			};
		}

		// Block destructive bash commands
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			const isBlocked = BLOCKED_BASH_PATTERNS.some((pattern) => pattern.test(command));

			if (isBlocked) {
				return {
					block: true,
					reason: `Readonly mode: destructive bash command blocked.\nCommand: ${command}\n\nUse /readonly to disable readonly mode.`,
				};
			}
		}
	});

	// Inject readonly context into system prompt when active
	pi.on("before_agent_start", async () => {
		if (readonlyEnabled) {
			return {
				message: {
					customType: "readonly-context",
					content: `[READONLY MODE ACTIVE]
You are in readonly mode. File modifications are disabled.

Available tools: read, ls, grep, find, questionnaire
Blocked tools: edit, write (file modifications)
Blocked bash: rm, mv, cp, mkdir, rmdir, touch, redirects (>, >>), git commit/push/merge

Analyze code, explore the project, and provide recommendations.
Do NOT attempt to make any changes to files.
Ask clarifying questions using the questionnaire tool when needed.`,
					display: false,
				},
			};
		}
	});

	// Initialize on session start
	pi.on("session_start", async (_event, ctx) => {
		if (readonlyEnabled) {
			pi.setActiveTools(READONLY_TOOLS);
		}
		updateStatus(ctx);
	});
}
