/**
 * Codex Accounts Extension
 *
 * Pi stores one credential per provider id in ~/.pi/agent/auth.json, so a
 * second ChatGPT subscription has nowhere to live: logging in with it
 * overwrites the first. This extension registers additional providers named
 * `openai-codex-<id>` that speak the same `openai-codex-responses` API and
 * carry their own ChatGPT OAuth flow, so every account gets its own auth.json
 * entry and pi refreshes each of them independently.
 *
 *   /codex-accounts            list configured accounts and their auth status
 *   /codex-account-add [id]    add an account, then `/login openai-codex-<id>`
 *   /codex-account-remove <id> drop an account (its stored credential stays)
 *
 * Accounts live in ~/.pi/agent/codex-accounts.json. Models are cloned from the
 * built-in openai-codex catalogue and cached in codex-accounts.models.json, so
 * the providers already exist when pi resolves --model or the default model at
 * startup; every session start refreshes the cache from the live catalogue.
 *
 * The OAuth flow mirrors pi's built-in one (same client id, PKCE, browser
 * callback on :1455, and device-code fallback); it is reimplemented here
 * because pi does not export it.
 */

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Derived from the public provider config so pi-ai never has to be imported. */
type ProviderOAuth = NonNullable<ProviderConfig["oauth"]>;
type OAuthLoginCallbacks = Parameters<ProviderOAuth["login"]>[0];
type OAuthCredentials = Awaited<ReturnType<ProviderOAuth["login"]>>;
type CatalogueModel = ReturnType<ExtensionContext["modelRegistry"]["getAll"]>[number];

const BASE_PROVIDER = "openai-codex";
const PROVIDER_PREFIX = `${BASE_PROVIDER}-`;
const CONFIG_FILE = join(getAgentDir(), "codex-accounts.json");
const MODEL_CACHE_FILE = join(getAgentDir(), "codex-accounts.models.json");
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Same OAuth app pi itself uses; the redirect URI is registered with it.
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const DEVICE_CODE_TIMEOUT_SECONDS = 900;
const CALLBACK_PORT = 1455;
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

interface AccountConfig {
	id: string;
	label: string;
}

interface AccountsFile {
	accounts: AccountConfig[];
}

// =============================================================================
// Config
// =============================================================================

function readAccounts(): AccountConfig[] {
	let raw: string;
	try {
		raw = readFileSync(CONFIG_FILE, "utf8");
	} catch {
		return [];
	}

	try {
		const parsed = JSON.parse(raw) as Partial<AccountsFile>;
		if (!Array.isArray(parsed.accounts)) return [];
		return parsed.accounts.filter(
			(account): account is AccountConfig =>
				typeof account?.id === "string" &&
				ID_PATTERN.test(account.id) &&
				typeof account.label === "string",
		);
	} catch {
		return [];
	}
}

function writeAccounts(accounts: AccountConfig[]): void {
	mkdirSync(dirname(CONFIG_FILE), { recursive: true });
	const file: AccountsFile = { accounts };
	writeFileSync(CONFIG_FILE, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8" });
}

function providerId(account: AccountConfig): string {
	return `${PROVIDER_PREFIX}${account.id}`;
}

/**
 * Model catalogue cache. Extensions cannot read the model registry at load
 * time, but providers must be registered by then or pi cannot resolve a
 * `openai-codex-<id>/...` model passed on the command line or stored as the
 * default. So the catalogue observed at session start is cached on disk and
 * replayed on the next startup.
 */
function readCachedModels(): ProviderModelConfig[] {
	try {
		const parsed = JSON.parse(readFileSync(MODEL_CACHE_FILE, "utf8"));
		return Array.isArray(parsed) ? (parsed as ProviderModelConfig[]) : [];
	} catch {
		return [];
	}
}

function writeCachedModels(models: ProviderModelConfig[]): void {
	try {
		mkdirSync(dirname(MODEL_CACHE_FILE), { recursive: true });
		writeFileSync(MODEL_CACHE_FILE, `${JSON.stringify(models, null, 2)}\n`, { encoding: "utf8" });
	} catch {
		// A stale cache only costs one startup, so a failed write is not worth reporting.
	}
}

// =============================================================================
// OAuth (ChatGPT / Codex)
// =============================================================================

function base64url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
	const verifier = base64url(randomBytes(32));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function decodeJwt(token: string): Record<string, any> | null {
	const payload = token.split(".")[1];
	if (!payload) return null;
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

/** The codex API driver derives the ChatGPT account from this claim. */
function accountIdFromToken(access: string): string {
	const accountId = decodeJwt(access)?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
	if (typeof accountId !== "string" || accountId.length === 0) {
		throw new Error("Failed to extract accountId from token");
	}
	return accountId;
}

interface TokenResponse {
	access: string;
	refresh: string;
	expires: number;
}

async function readTokenResponse(response: Response, operation: string): Promise<TokenResponse> {
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`OpenAI Codex token ${operation} failed (${response.status}): ${text || response.statusText}`,
		);
	}
	const json = (await response.json()) as any;
	if (!json?.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
		throw new Error(`OpenAI Codex token ${operation} response missing fields`);
	}
	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

function toCredentials(token: TokenResponse): OAuthCredentials {
	return { ...token, accountId: accountIdFromToken(token.access) };
}

async function exchangeCode(
	code: string,
	verifier: string,
	redirectUri: string,
	signal?: AbortSignal,
): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
		signal,
	});
	return toCredentials(await readTokenResponse(response, "exchange"));
}

/** Waits for OpenAI to redirect back with ?code=, on the port the app expects. */
function startCallbackServer(state: string): Promise<{
	waitForCode: () => Promise<string | null>;
	close: () => void;
}> {
	let settle: ((code: string | null) => void) | undefined;
	const codePromise = new Promise<string | null>((resolve) => {
		let settled = false;
		settle = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
	});

	const respond = (res: any, status: number, message: string): void => {
		res.statusCode = status;
		res.setHeader("Content-Type", "text/plain; charset=utf-8");
		res.end(message);
	};

	const server = createServer((req, res) => {
		const url = new URL(req.url || "", "http://localhost");
		if (url.pathname !== "/auth/callback") {
			respond(res, 404, "Not found");
			return;
		}
		if (url.searchParams.get("state") !== state) {
			respond(res, 400, "State mismatch.");
			return;
		}
		const code = url.searchParams.get("code");
		if (!code) {
			respond(res, 400, "Missing authorization code.");
			return;
		}
		respond(res, 200, "OpenAI authentication completed. You can close this window.");
		settle?.(code);
	});

	return new Promise((resolve) => {
		const close = (): void => {
			try {
				server.close();
			} catch {
				// already closed
			}
		};
		server
			.listen(CALLBACK_PORT, "127.0.0.1", () =>
				resolve({ waitForCode: () => codePromise, close }),
			)
			.on("error", (error) => {
				settle?.(null);
				resolve({
					waitForCode: async () => {
						throw new Error(
							`Cannot listen on port ${CALLBACK_PORT} for the OAuth callback (${error.message}). ` +
								"Close the other login and retry, or pick device code login.",
						);
					},
					close,
				});
			});
	});
}

async function loginViaBrowser(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePkce();
	const state = randomBytes(16).toString("hex");
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "pi");

	const server = await startCallbackServer(state);
	try {
		cb.onAuth({
			url: url.toString(),
			instructions: "Sign in with the account you want to add, then return here.",
		});
		const code = await server.waitForCode();
		if (!code) throw new Error("Login cancelled");
		return await exchangeCode(code, verifier, REDIRECT_URI, cb.signal);
	} finally {
		server.close();
	}
}

async function loginViaDeviceCode(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const start = await fetch(DEVICE_USER_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
		signal: cb.signal,
	});
	if (!start.ok) {
		const body = await start.text().catch(() => "");
		throw new Error(`OpenAI Codex device code request failed (${start.status})${body ? `: ${body}` : ""}`);
	}
	const device = (await start.json()) as any;
	const intervalSeconds = Number(device?.interval);
	if (!device?.device_auth_id || !device.user_code || !Number.isFinite(intervalSeconds)) {
		throw new Error("Invalid OpenAI Codex device code response");
	}

	cb.onDeviceCode({
		userCode: device.user_code,
		verificationUri: DEVICE_VERIFICATION_URI,
		intervalSeconds,
		expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
	});

	const deadline = Date.now() + DEVICE_CODE_TIMEOUT_SECONDS * 1000;
	let waitMs = Math.max(1000, Math.floor(intervalSeconds * 1000));
	while (Date.now() < deadline) {
		if (cb.signal?.aborted) throw new Error("Login cancelled");
		await new Promise((resolve) => setTimeout(resolve, waitMs));

		const response = await fetch(DEVICE_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
			signal: cb.signal,
		});
		if (response.ok) {
			const json = (await response.json()) as any;
			if (!json?.authorization_code || !json.code_verifier) {
				throw new Error("Invalid OpenAI Codex device auth token response");
			}
			return await exchangeCode(
				json.authorization_code,
				json.code_verifier,
				DEVICE_REDIRECT_URI,
				cb.signal,
			);
		}
		if (response.status === 403 || response.status === 404) continue;

		const body = await response.text().catch(() => "");
		let errorCode: string | undefined;
		try {
			const error = JSON.parse(body)?.error;
			errorCode = typeof error === "object" ? error?.code : error;
		} catch {
			// non-JSON error body
		}
		if (errorCode === "deviceauth_authorization_pending") continue;
		if (errorCode === "slow_down") {
			waitMs += 5000;
			continue;
		}
		throw new Error(`OpenAI Codex device auth failed (${response.status})${body ? `: ${body}` : ""}`);
	}
	throw new Error("Device flow timed out");
}

function createOAuth(account: AccountConfig): ProviderOAuth {
	return {
		name: `OpenAI Codex — ${account.label}`,
		isSubscription: true,
		async login(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
			const method = await cb.onSelect({
				message: `Login method for ${account.label}:`,
				options: [
					{ id: "browser", label: "Browser login (default)" },
					{ id: "device_code", label: "Device code login (headless)" },
				],
			});
			if (method === "device_code") return loginViaDeviceCode(cb);
			return loginViaBrowser(cb);
		},
		async refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
			let response: Response;
			try {
				response = await fetch(TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "refresh_token",
						refresh_token: credentials.refresh,
						client_id: CLIENT_ID,
					}),
					signal,
				});
			} catch (error) {
				throw new Error(
					`OpenAI Codex token refresh error: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return toCredentials(await readTokenResponse(response, "refresh"));
		},
		getApiKey(credentials: OAuthCredentials): string {
			return credentials.access;
		},
	};
}

// =============================================================================
// Provider registration
// =============================================================================

function catalogueModels(ctx: ExtensionContext): ProviderModelConfig[] {
	return ctx.modelRegistry
		.getAll()
		.filter((model: CatalogueModel) => model.provider === BASE_PROVIDER)
		.map((model) => ({
			id: model.id,
			name: model.name,
			api: model.api,
			baseUrl: model.baseUrl,
			reasoning: model.reasoning,
			thinkingLevelMap: model.thinkingLevelMap,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			headers: model.headers,
			compat: model.compat,
		}));
}

/** Returns the number of models registered, or 0 when the base catalogue is missing. */
function registerAccount(
	pi: ExtensionAPI,
	account: AccountConfig,
	models: ProviderModelConfig[],
): number {
	if (models.length === 0) return 0;

	pi.registerProvider(providerId(account), {
		name: `OpenAI Codex (${account.label})`,
		baseUrl: "https://chatgpt.com/backend-api",
		api: "openai-codex-responses",
		models: models.map((model) => ({ ...model, name: `${model.name} (${account.label})` })),
		oauth: createOAuth(account),
	});
	return models.length;
}

// =============================================================================
// Extension
// =============================================================================

export default function codexAccountsExtension(pi: ExtensionAPI): void {
	const registered = new Set<string>();
	let models = readCachedModels();

	const syncProviders = (): void => {
		const accounts = readAccounts();
		const wanted = new Set(accounts.map(providerId));

		for (const id of registered) {
			if (wanted.has(id)) continue;
			pi.unregisterProvider(id);
			registered.delete(id);
		}
		for (const account of accounts) {
			if (registerAccount(pi, account, models) > 0) registered.add(providerId(account));
		}
	};

	// Registered here (queued until the runner binds) so the providers exist
	// before pi resolves the startup model.
	syncProviders();

	pi.on("session_start", async (_event, ctx) => {
		const live = catalogueModels(ctx);
		if (live.length > 0 && JSON.stringify(live) !== JSON.stringify(models)) {
			models = live;
			writeCachedModels(live);
		}
		syncProviders();
	});

	pi.registerCommand("codex-accounts", {
		description: "List extra ChatGPT/Codex accounts and their login status",
		handler: async (_args, ctx) => {
			const accounts = readAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify(
					`No extra Codex accounts configured. Add one with /codex-account-add (config: ${CONFIG_FILE}).`,
					"info",
				);
				return;
			}

			const lines = accounts.map((account) => {
				const id = providerId(account);
				const status = ctx.modelRegistry.getProviderAuthStatus(id);
				const state = status.configured
					? `logged in${status.source ? ` (${status.source})` : ""}`
					: `not logged in — run /login ${id}`;
				return `  ${account.label}: ${id} — ${state}`;
			});
			ctx.ui.notify([`Codex accounts (${CONFIG_FILE}):`, ...lines].join("\n"), "info");
		},
	});

	pi.registerCommand("codex-account-add", {
		description: "Add an extra ChatGPT/Codex account as its own provider",
		handler: async (args, ctx) => {
			const [argId, ...argLabel] = args.trim().split(/\s+/).filter(Boolean);
			const id = (argId ?? (await ctx.ui.input("Account id (a-z, digits, dashes)", "work")))?.trim();
			if (!id) return;
			if (!ID_PATTERN.test(id)) {
				ctx.ui.notify(`Invalid account id "${id}". Use lowercase letters, digits, and dashes.`, "error");
				return;
			}

			const accounts = readAccounts();
			if (accounts.some((account) => account.id === id)) {
				ctx.ui.notify(`Account "${id}" already exists.`, "error");
				return;
			}

			const label =
				(argLabel.length > 0 ? argLabel.join(" ") : await ctx.ui.input("Display label", id))?.trim() ||
				id;
			const account: AccountConfig = { id, label };

			try {
				writeAccounts([...accounts, account]);
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			if (models.length === 0) models = catalogueModels(ctx);
			if (registerAccount(pi, account, models) === 0) {
				ctx.ui.notify(
					`Added ${label}, but no built-in ${BASE_PROVIDER} models were found to clone. Restart pi and try /codex-accounts.`,
					"warning",
				);
				return;
			}
			registered.add(providerId(account));
			ctx.ui.notify(`Added ${label}. Run /login ${providerId(account)} to sign in.`, "info");
		},
	});

	pi.registerCommand("codex-account-remove", {
		description: "Remove an extra ChatGPT/Codex account provider",
		handler: async (args, ctx) => {
			const accounts = readAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify("No extra Codex accounts configured.", "info");
				return;
			}

			const id =
				args.trim() || (await ctx.ui.select("Remove which account?", accounts.map((a) => a.id)));
			if (!id) return;

			const account = accounts.find((candidate) => candidate.id === id);
			if (!account) {
				ctx.ui.notify(`Unknown account "${id}".`, "error");
				return;
			}

			try {
				writeAccounts(accounts.filter((candidate) => candidate.id !== id));
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			pi.unregisterProvider(providerId(account));
			registered.delete(providerId(account));
			ctx.ui.notify(
				`Removed ${account.label}. Its credential is still in auth.json under "${providerId(account)}".`,
				"info",
			);
		},
	});
}
