/**
 * Claude Auth Extension
 *
 * doppelclaude runs Claude Code subprocesses that read the Claude Code OAuth
 * credential store. When the access token expires, the first turn fails with
 * "401 OAuth access token has expired". The manual remedy is to start Claude
 * Code once so it refreshes the stored token.
 *
 * This extension does that without leaving Pi:
 *   - /claude-login  refreshes the stored token now (add "force" to always refresh)
 *   - before every agent turn on a doppelclaude model, the stored expiry is
 *     checked and refreshed proactively when it is inside the margin.
 *
 * Refresh is delegated to the Claude Code CLI (a tiny headless haiku turn), so
 * the rotating refresh token is only ever written by Claude Code itself.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXT_ID = "claude-auth";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");
/** Refresh when the stored token expires within this window. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 90_000;
/** Cheapest call that makes Claude Code touch the API and therefore refresh. */
const REFRESH_ARGS = ["-p", "--model", "haiku", "--max-turns", "1", "ok"];

interface StoredToken {
	expiresAt?: number;
	subscriptionType?: string;
}

async function readStoredToken(pi: ExtensionAPI): Promise<StoredToken | undefined> {
	let raw: string | undefined;

	if (process.platform === "darwin") {
		const result = await pi.exec("security", [
			"find-generic-password",
			"-s",
			KEYCHAIN_SERVICE,
			"-w",
		]);
		if (result.code === 0) raw = result.stdout;
	}

	if (!raw) {
		try {
			raw = readFileSync(CREDENTIALS_FILE, "utf8");
		} catch {
			return undefined;
		}
	}

	try {
		const oauth = JSON.parse(raw)?.claudeAiOauth;
		if (!oauth || typeof oauth !== "object") return undefined;
		return {
			expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
			subscriptionType: oauth.subscriptionType,
		};
	} catch {
		return undefined;
	}
}

function minutesUntil(expiresAt: number): number {
	return Math.round((expiresAt - Date.now()) / 60_000);
}

/** Runs Claude Code once so it refreshes and rewrites the stored token. */
async function refreshToken(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<{ ok: boolean; message: string }> {
	ctx.ui.setStatus(EXT_ID, "refreshing Claude credentials…");
	try {
		const result = await pi.exec("claude", REFRESH_ARGS, {
			cwd: ctx.cwd,
			timeout: REFRESH_TIMEOUT_MS,
		});

		if (result.killed) return { ok: false, message: "Claude refresh timed out" };
		if (result.code !== 0) {
			const detail = (result.stderr || result.stdout || "").trim().split("\n")[0] ?? "";
			return {
				ok: false,
				message: `Claude refresh failed (${result.code})${detail ? `: ${detail}` : ""} — run \`claude auth login\` in a terminal`,
			};
		}

		const token = await readStoredToken(pi);
		const expiry = token?.expiresAt;
		return {
			ok: true,
			message: expiry
				? `Claude credentials refreshed, valid for ${minutesUntil(expiry)} min`
				: "Claude credentials refreshed",
		};
	} finally {
		ctx.ui.setStatus(EXT_ID, undefined);
	}
}

function usesDoppelclaude(ctx: ExtensionContext): boolean {
	const model = ctx.model as { provider?: string; api?: string; id?: string } | undefined;
	return `${model?.provider ?? ""}`.toLowerCase().includes("doppel");
}

export default function claudeAuthExtension(pi: ExtensionAPI): void {
	pi.registerCommand("claude-login", {
		description: "Refresh the Claude Code OAuth token used by doppelclaude",
		handler: async (args, ctx) => {
			const force = args.trim().toLowerCase() === "force";
			const token = await readStoredToken(pi);

			if (!token) {
				ctx.ui.notify(
					"No Claude Code credentials found — run `claude auth login` in a terminal",
					"error",
				);
				return;
			}

			if (!force && token.expiresAt && token.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
				ctx.ui.notify(
					`Claude token still valid for ${minutesUntil(token.expiresAt)} min (use \`/claude-login force\` to refresh anyway)`,
					"info",
				);
				return;
			}

			const result = await refreshToken(pi, ctx);
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!usesDoppelclaude(ctx)) return;

		const token = await readStoredToken(pi);
		if (!token?.expiresAt) return;
		if (token.expiresAt - Date.now() > REFRESH_MARGIN_MS) return;

		const result = await refreshToken(pi, ctx);
		if (!result.ok) ctx.ui.notify(result.message, "error");
	});
}
