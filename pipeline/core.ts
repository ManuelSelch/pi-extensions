import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { promisify } from "node:util";
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { GitHubStatus } from "./github.ts";

const exec = promisify(execFile);
export type Confirm = (description: string) => Promise<boolean>;
export interface Prepare {
	command: string[];
	cwd: string;
	timeoutSeconds: number;
}
export interface Suite extends Prepare {
	auto: "manual" | "after-agent";
}
export interface Config { version: 1; suites: Record<string, Suite>; prepare?: Prepare }
export interface RunResult {
	suite: string;
	outcome: "running" | "passed" | "failed" | "cancelled" | "timed-out";
	startedAt: string;
	finishedAt?: string;
	durationMs: number;
	exitCode: number | null;
	signal?: string | null;
	logPath: string;
	output: string;
	sourceFingerprint: string;
	configFingerprint: string;
	changedDuringRun: boolean;
	pid: number;
}
export type SuiteStatus = (RunResult | { outcome: "never" }) & { stale: boolean };
export interface PipelineStatus {
	github?: GitHubStatus;
	configured: boolean;
	root?: string;
	config?: Config;
	sourceFingerprint?: string;
	configFingerprint?: string;
	suites: Record<string, SuiteStatus>;
	prepare?: SuiteStatus;
}
export interface RunOptions {
	confirm?: Confirm;
	signal?: AbortSignal;
	onChange?: () => void;
	automatic?: boolean;
	cooldownMs?: number;
	expectedSourceFingerprint?: string;
	expectedConfigFingerprint?: string;
}
export const AUTO_COOLDOWN_MS = 60000;
/** Skip unchanged snapshots regardless of outcome or age, so failures never create a retry loop. */
export function automaticSuites(status: PipelineStatus | undefined, now = Date.now(), cooldownMs = AUTO_COOLDOWN_MS): string[] {
	if (!status?.configured || !status.config || !status.sourceFingerprint || !status.configFingerprint) return [];
	const prepare = status.prepare;
	if (prepare && prepare.outcome !== "never" && prepare.outcome !== "passed") {
		if (prepare.outcome === "running" || now - Date.parse(prepare.finishedAt ?? prepare.startedAt) < cooldownMs) return [];
		if (!prepare.changedDuringRun && prepare.sourceFingerprint === status.sourceFingerprint && prepare.configFingerprint === status.configFingerprint) return [];
	}
	return Object.entries(status.config.suites).filter(([name, suite]) => {
		if (suite.auto !== "after-agent") return false;
		const result = status.suites[name];
		if (!result || result.outcome === "never") return true;
		if (result.outcome === "running") return false;
		if (now - Date.parse(result.finishedAt ?? result.startedAt) < cooldownMs) return false;
		return result.changedDuringRun || result.sourceFingerprint !== status.sourceFingerprint || result.configFingerprint !== status.configFingerprint;
	}).map(([name]) => name);
}
const MAX_OUTPUT = 16384;
const GENERATED = new Set([
	".git", "node_modules", "dist", "build", "coverage", ".next", ".DS_Store", "__pycache__", ".venv",
	"test-results", "playwright-report", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".turbo",
]);
const sourcePath = (file: string) => file !== ".pi/pipeline.json" && !file.split(/[\\/]/).some(part => GENERATED.has(part));
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => {
	const rel = relative(root, path);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
}
export function validateConfig(input: unknown): Config {
	const value = object(input);
	keys(value, ["version", "suites", "prepare"]);
	if (value.version !== 1) throw new Error("Pipeline version must be 1");
	const suites: Record<string, Suite> = Object.create(null);
	for (const [name, inputSuite] of Object.entries(object(value.suites))) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error(`Invalid suite name: ${name}`);
		const suite = object(inputSuite);
		// Accept but discard the removed age-expiry option in existing suite configs.
		keys(suite, ["command", "cwd", "timeoutSeconds", "auto", "staleAfterMinutes"]);
		if (!Array.isArray(suite.command) || !suite.command.length || suite.command.some(arg => typeof arg !== "string" || arg.includes("\0")) || !suite.command[0].trim()) {
			throw new Error(`${name}: command must be a nonempty executable/argument array`);
		}
		const cwd = suite.cwd ?? ".";
		if (typeof cwd !== "string" || !cwd || cwd.includes("\0") || isAbsolute(cwd) || !inside("/project", resolve("/project", cwd))) throw new Error(`${name}: cwd must remain inside the project`);
		const timeoutSeconds = suite.timeoutSeconds ?? 300;
		if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 86400) throw new Error(`${name}: invalid timeoutSeconds`);
		const auto = suite.auto ?? "manual";
		if (auto !== "manual" && auto !== "after-agent") throw new Error(`${name}: invalid auto mode`);
		suites[name] = { command: [...suite.command], cwd, timeoutSeconds, auto };
	}
	if (value.prepare === undefined) return { version: 1, suites }; // Preserve existing approval fingerprints.
	const prepare = object(value.prepare);
	keys(prepare, ["command", "cwd", "timeoutSeconds"]);
	const normalized = validateConfig({ version: 1, suites: { prepare } }).suites.prepare;
	return { version: 1, suites, prepare: { command: normalized.command, cwd: normalized.cwd, timeoutSeconds: normalized.timeoutSeconds } };
}
export async function projectRoot(cwd: string): Promise<string> {
	try {
		const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
		return realpath(result.stdout.trim());
	} catch { return realpath(cwd); }
}
async function optionalText(file: string): Promise<string | undefined> {
	try { return await readFile(file, "utf8"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function atomicJSON(file: string, value: unknown): Promise<void> {
	const tmp = `${file}.${randomUUID()}.tmp`;
	try { await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(tmp, file); }
	finally { await rm(tmp, { force: true }); }
}

export async function sourceFingerprint(root: string, excludedDirectories: string[] = []): Promise<string> {
	const include = (file: string) => sourcePath(file) && !excludedDirectories.some(dir => inside(resolve(dir), join(root, file)));
	let files: string[];
	try {
		const result = await exec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
		files = result.stdout.split("\0").filter(Boolean);
	} catch (error) {
		// Only fall back outside git; errors/oversized output in a repository must not hide changes.
		let inRepository = false;
		try { await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root }); inRepository = true; }
		catch { /* Non-git projects use the recursive scan below. */ }
		if (inRepository) throw error;
		files = [];
		async function walk(dir: string) {
			for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
				const file = dir ? `${dir}/${entry.name}` : entry.name;
				if (!include(file)) continue;
				if (entry.isDirectory()) await walk(file); else files.push(file);
			}
		}
		await walk("");
	}
	const hash = createHash("sha256");
	for (const file of [...new Set(files)].filter(include).sort()) {
		hash.update(JSON.stringify(file));
		const path = join(root, file);
		try {
			const info = await lstat(path);
			hash.update(String(info.mode));
			if (info.isSymbolicLink()) hash.update(await readlink(path));
			else if (info.isFile()) { hash.update(await readFile(path)); }
			else hash.update("non-file");
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; hash.update("missing"); }
		hash.update("\0");
	}
	return hash.digest("hex");
}

export class Pipeline {
	readonly configPath: string;
	readonly storage: string;
	constructor(readonly root: string, private readonly cacheRoot = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pipeline")) {
		this.configPath = join(root, ".pi", "pipeline.json");
		this.storage = join(cacheRoot, digest(root));
	}
	async config(): Promise<Config | undefined> {
		const text = await optionalText(this.configPath);
		return text === undefined ? undefined : validateConfig(JSON.parse(text));
	}
	async suiteCwd(suite: Prepare): Promise<string> {
		const cwd = await realpath(resolve(this.root, suite.cwd));
		if (!inside(this.root, cwd)) throw new Error("Suite working directory is outside the project");
		if (!(await stat(cwd)).isDirectory()) throw new Error("Suite cwd is not a directory");
		return cwd;
	}
	async acquire(): Promise<() => Promise<void>> {
		await mkdir(this.storage, { recursive: true, mode: 0o700 });
		const lock = join(this.storage, "lock");
		try { await mkdir(lock); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Pipeline busy (run or configuration review). If Pi crashed, verify no run remains before removing ${lock}`);
			throw error;
		}
		try { await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, root: this.root, startedAt: new Date().toISOString() })); }
		catch (error) { await rm(lock, { recursive: true, force: true }); throw error; }
		return () => rm(lock, { recursive: true, force: true });
	}
	private async approvalScope(): Promise<{ directory: string; description: string }> {
		let commonDir: string | undefined;
		try {
			const result = await exec("git", ["rev-parse", "--git-common-dir"], { cwd: this.root });
			commonDir = result.stdout.trim();
		} catch { /* Non-git projects retain directory-scoped approval. */ }
		const identity = commonDir === undefined ? await realpath(this.root) : await realpath(resolve(this.root, commonDir));
		return {
			directory: join(this.cacheRoot, "approvals", digest(JSON.stringify([commonDir === undefined ? "directory" : "git", identity]))),
			description: commonDir === undefined ? `Approval applies only to this project directory: ${identity}.` : `Approval applies to identical configurations in all worktrees of this repository (Git common directory: ${identity}).`,
		};
	}
	async isApproved(config?: Config): Promise<boolean> {
		const current = config ?? await this.config();
		if (!current) return false;
		const fingerprint = digest(JSON.stringify(current));
		const scope = await this.approvalScope();
		const shared = await optionalText(join(scope.directory, `${fingerprint}.json`));
		if (shared !== undefined && JSON.parse(shared).fingerprint === fingerprint) return true;
		// Legacy approvals remain worktree-local; never silently broaden their trust.
		const text = await optionalText(join(this.storage, "approval.json"));
		return text !== undefined && JSON.parse(text).fingerprint === fingerprint;
	}
	private async approve(config: Config) {
		const scope = await this.approvalScope();
		const fingerprint = digest(JSON.stringify(config));
		await mkdir(scope.directory, { recursive: true, mode: 0o700 });
		// Separate atomic records avoid lost approvals when different worktrees approve concurrently.
		await atomicJSON(join(scope.directory, `${fingerprint}.json`), { fingerprint, approvedAt: new Date().toISOString() });
	}
	async configure(input: unknown, confirm?: Confirm): Promise<boolean> {
		const proposal = validateConfig(input);
		for (const suite of [...Object.values(proposal.suites), ...(proposal.prepare ? [proposal.prepare] : [])]) await this.suiteCwd(suite);
		if (!confirm) throw new Error("User approval required: no interactive confirmation channel");
		const release = await this.acquire();
		try {
			const before = await optionalText(this.configPath);
			if (!await confirm(`Project: ${this.root}\n${(await this.approvalScope()).description}\nBefore: ${before ?? "(none)"}\nAfter: ${JSON.stringify(proposal, null, 2)}\nSuites with auto=after-agent may run after the next settled agent turn, once edits are quiet (2s), with a 60s cooldown. Saving does not immediately run tests.`)) return false;
			if (await optionalText(this.configPath) !== before) throw new Error("Configuration changed during review; request fresh approval");
			await mkdir(join(this.root, ".pi"), { recursive: true });
			if (!inside(this.root, await realpath(join(this.root, ".pi")))) throw new Error("Configuration directory is outside the project");
			await atomicJSON(this.configPath, proposal);
			await this.approve(proposal);
			return true;
		} finally { await release(); }
	}
	private async results(): Promise<Record<string, RunResult>> {
		const text = await optionalText(join(this.storage, "results.json"));
		return Object.assign(Object.create(null), text ? JSON.parse(text) : {});
	}
	private async preparation(): Promise<RunResult | undefined> {
		const text = await optionalText(join(this.storage, "prepare.json"));
		return text === undefined ? undefined : JSON.parse(text);
	}
	async status(): Promise<PipelineStatus> {
		const config = await this.config();
		if (!config) return { configured: false, suites: {} };
		const results = await this.results();
		const fingerprint = await sourceFingerprint(this.root, [this.cacheRoot]);
		const configFingerprint = digest(JSON.stringify(config));
		const suites: Record<string, SuiteStatus> = Object.create(null);
		for (const name of Object.keys(config.suites)) {
			const result = results[name];
			suites[name] = result ? { ...result, stale: result.changedDuringRun || result.sourceFingerprint !== fingerprint || result.configFingerprint !== configFingerprint } : { outcome: "never", stale: false };
		}
		const preparation = config.prepare ? await this.preparation() : undefined;
		return { configured: true, root: this.root, config, suites, sourceFingerprint: fingerprint, configFingerprint,
			...(config.prepare ? { prepare: { ...(preparation ?? { outcome: "never" as const }), stale: false } } : {}) };
	}
	async logs(name: string): Promise<{ logPath: string; output: string }> {
		const result = (await this.results())[name];
		if (!result) throw new Error(`No run for suite: ${name}`);
		const file = await open(result.logPath, "r");
		try {
			const size = (await file.stat()).size;
			const buffer = Buffer.alloc(Math.min(size, MAX_OUTPUT));
			await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
			return { logPath: result.logPath, output: buffer.toString("utf8") };
		} finally { await file.close(); }
	}
	async run(selection = "all", options: RunOptions = {}): Promise<RunResult[]> {
		if (options.signal?.aborted) throw new Error("Pipeline cancelled before execution");
		const release = await this.acquire();
		try {
			const config = await this.config();
			if (!config) { if (options.automatic) return []; throw new Error("No pipeline configuration"); }
			let automaticStatus: PipelineStatus | undefined;
			if (options.automatic) {
				if (!await this.isApproved(config)) return []; // Never prompt or grant approval in background work.
				automaticStatus = await this.status();
				if (automaticStatus.configFingerprint !== digest(JSON.stringify(config))) return [];
				if (options.expectedConfigFingerprint && automaticStatus.configFingerprint !== options.expectedConfigFingerprint) return [];
				if (options.expectedSourceFingerprint && automaticStatus.sourceFingerprint !== options.expectedSourceFingerprint) return [];
			}
			const names = options.automatic ? automaticSuites(automaticStatus, Date.now(), options.cooldownMs) : selection === "all" ? Object.keys(config.suites) : [selection];
			if (options.automatic && !names.length) return [];
			if (!names.length || names.some(name => !Object.hasOwn(config.suites, name))) throw new Error(`Unknown or empty suite selection: ${selection}`);
			if (!options.automatic) await this.ensureApproved(config, options.confirm ? async text => {
				if (options.signal?.aborted) return false;
				return await options.confirm!(text) && !options.signal?.aborted;
			} : undefined);
			const results = await this.results();
			const completed: RunResult[] = [];
			const runStep = async (name: string, step: Prepare, file: string, preparation = false): Promise<RunResult> => {
				if (JSON.stringify(await this.config()) !== JSON.stringify(config)) throw new Error("Configuration changed before execution; request fresh approval");
				const cwd = await this.suiteCwd(step);
				const fingerprint = await sourceFingerprint(this.root, [this.cacheRoot]);
				const result: RunResult = {
					suite: name, outcome: "running", startedAt: new Date().toISOString(), durationMs: 0, exitCode: null,
					logPath: join(this.storage, `${name}-${randomUUID()}.log`), output: "", sourceFingerprint: fingerprint,
					configFingerprint: digest(JSON.stringify(config)), changedDuringRun: false, pid: process.pid,
				};
				if (!preparation) results[name] = result;
				const persist = () => atomicJSON(join(this.storage, file), preparation ? result : results);
				await persist();
				options.onChange?.();
				try {
					if (options.signal?.aborted) result.outcome = "cancelled";
					else if (JSON.stringify(await this.config()) !== JSON.stringify(config)) throw new Error("Configuration changed before execution; request fresh approval");
					else await this.execute(step, cwd, result, options.signal);
				}
				catch (error) { result.outcome = "failed"; result.output = (result.output + String(error)).slice(-MAX_OUTPUT); }
				result.finishedAt = new Date().toISOString();
				result.durationMs = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
				try {
					const after = await sourceFingerprint(this.root, [this.cacheRoot]);
					result.changedDuringRun = fingerprint !== after;
					if (preparation && result.outcome !== "passed") {
						// Partial install artifacts must not create an automatic retry loop.
						result.sourceFingerprint = after;
						result.changedDuringRun = false;
					}
				}
				catch { result.changedDuringRun = true; }
				await persist();
				completed.push(result);
				options.onChange?.();
				return result;
			};
			if (config.prepare && (await this.preparation())?.outcome !== "passed") {
				const preparation = await runStep("prepare", config.prepare, "prepare.json", true);
				if (preparation.outcome !== "passed") return completed; // Never run tests after failed/cancelled setup.
				// Preparation may legitimately generate project inputs before the first test snapshot.
				if (automaticStatus) automaticStatus.sourceFingerprint = await sourceFingerprint(this.root, [this.cacheRoot]);
			}
			for (const name of names) {
				if (options.signal?.aborted) break;
				if (JSON.stringify(await this.config()) !== JSON.stringify(config)) throw new Error("Configuration changed before execution; request fresh approval");
				const suite = config.suites[name];
				const fingerprint = await sourceFingerprint(this.root, [this.cacheRoot]);
				if (options.automatic && fingerprint !== automaticStatus?.sourceFingerprint) break; // Edits resumed; wait for another quiet snapshot.
				if (options.signal?.aborted) break;
				await runStep(name, suite, "results.json");
			}
			if (options.signal?.aborted && !completed.some(result => result.outcome === "cancelled")) throw new Error("Pipeline cancelled before remaining suites could execute; completed results are available in pipeline_status");
			return completed;
		} finally { await release(); }
	}
	private async execute(suite: Prepare, cwd: string, result: RunResult, signal?: AbortSignal): Promise<void> {
		const log = createWriteStream(result.logPath, { mode: 0o600 });
		await once(log, "open");
		const child = spawn(suite.command[0], suite.command.slice(1), { cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
		let reason: "cancelled" | "timed-out" | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		const kill = (sig: NodeJS.Signals) => {
			if (!child.pid) return;
			try { if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {}); else process.kill(-child.pid, sig); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
		};
		const stop = (why: "cancelled" | "timed-out") => {
			if (reason) return;
			reason = why; kill("SIGTERM");
			escalation = setTimeout(() => kill("SIGKILL"), 250);
		};
		const abort = () => stop("cancelled");
		let logError: Error | undefined;
		const onLogError = (error: Error) => { logError = error; stop("cancelled"); };
		log.on("error", onLogError);
		for (const stream of [child.stdout, child.stderr]) {
			stream.pipe(log, { end: false });
			stream.on("data", (chunk: Buffer) => { result.output = (result.output + chunk.toString("utf8")).slice(-MAX_OUTPUT); });
		}
		const timer = setTimeout(() => stop("timed-out"), suite.timeoutSeconds * 1000);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		try {
			await new Promise<void>((done) => {
				child.on("error", error => { result.output = (result.output + String(error)).slice(-MAX_OUTPUT); log.write(`${error}\n`); });
				child.on("close", (code, sig) => {
					result.exitCode = code; result.signal = sig;
					result.outcome = reason ?? (code === 0 ? "passed" : "failed");
					done();
				});
			});
			if (!log.destroyed) { const finished = once(log, "finish"); log.end(); await finished; }
			if (logError) throw logError;
		} finally {
			clearTimeout(timer); if (escalation) clearTimeout(escalation);
			signal?.removeEventListener("abort", abort);
			kill("SIGKILL"); // also stop descendants after their parent exits
			log.destroy();
		}
	}
	async ensureApproved(config: Config, confirm?: Confirm): Promise<void> {
		if (await this.isApproved(config)) return;
		if (!confirm) throw new Error("User approval required: no interactive confirmation channel");
		const before = await optionalText(this.configPath);
		if (!await confirm(`Approve pipeline execution for ${this.root}?\n${(await this.approvalScope()).description}\n${JSON.stringify(config, null, 2)}`)) throw new Error("Pipeline execution approval rejected");
		if (await optionalText(this.configPath) !== before || JSON.stringify(await this.config()) !== JSON.stringify(config)) throw new Error("Configuration changed during review; request fresh approval");
		await this.approve(config);
	}
}
