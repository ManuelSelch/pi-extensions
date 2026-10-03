/**
 * Session Cleanup Extension
 *
 * Deletes OLD session files without a manual name (including auto-titled
 * sessions). Never touches manually named sessions or the active session.
 *
 * Deletion goes through the `trash` CLI first (recoverable) and only falls
 * back to a hard `unlink` if `trash` is not installed.
 *
 * Commands:
 *   /session-cleanup-now   -> delete old unnamed sessions
 *   /session-cleanup-dry   -> show what would be deleted
 *
 * Age threshold: PI_SESSION_CLEANUP_DAYS (positive integer, default 3).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const EXT_ID = "session-cleanup";
const DEFAULT_MAX_AGE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Age in days. Reads the advertised PI_SESSION_CLEANUP_DAYS (was previously ignored). */
function getMaxAgeDays(): number {
  const raw = process.env.PI_SESSION_CLEANUP_DAYS;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_AGE_DAYS;
}

interface CleanupStats {
  deleted: number;
  kept: number; // recent (within cutoff), unnamed
  protected: number; // manually named and/or current session — never deleted
  candidates: number; // unnamed + old (what a real run would delete)
  errors: number;
  dryRun: boolean;
}

/**
 * SessionInfo.name omits the name's source. Read the latest session_info
 * entry, just like pi-chat: only autoTitle === true denotes an automatic name.
 * Read failures propagate so cleanup reports an error rather than deleting.
 */
async function hasManualName(path: string): Promise<boolean> {
  let manual = false;
  const content = await readFile(path, "utf8");
  for (const line of content.split("\n")) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (value.type !== "session_info") continue;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    manual = name.length > 0 && value.autoTitle !== true;
  }
  return manual;
}

/**
 * Delete a session file, trying the `trash` CLI first (recoverable), then
 * falling back to a hard `unlink`. Mirrors pi's own session-picker behaviour.
 * Returns true when the file is gone.
 */
async function deleteSessionFile(path: string): Promise<boolean> {
  const trashArgs = path.startsWith("-") ? ["--", path] : [path];
  const result = spawnSync("trash", trashArgs, { encoding: "utf-8" });
  // `trash` not installed (error) or non-zero: fall through. If it reported
  // success or the file is gone, we are done.
  if (result.status === 0 || !existsSync(path)) return true;
  await unlink(path);
  return true;
}

async function cleanupSessions(
  dryRun: boolean,
  currentSessionPath: string | undefined,
): Promise<CleanupStats> {
  const maxAgeDays = getMaxAgeDays();
  const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
  const current = currentSessionPath ? resolve(currentSessionPath) : undefined;

  const sessions = await SessionManager.listAll();
  const stats: CleanupStats = {
    deleted: 0,
    kept: 0,
    protected: 0,
    candidates: 0,
    errors: 0,
    dryRun,
  };

  for (const session of sessions) {
    const path = resolve(session.path);
    try {
      // 1) Never delete the live session.
      if (current && path === current) {
        stats.protected++;
        continue;
      }
      // 2) Protect manual names; auto-titles are eligible for cleanup.
      if (await hasManualName(path)) {
        stats.protected++;
        continue;
      }
      // 3) Keep recent sessions.
      if (session.modified.getTime() >= cutoff) {
        stats.kept++;
        continue;
      }
      // 4) Old + unnamed -> candidate.
      stats.candidates++;
      if (!dryRun) {
        await stat(path); // ensure it still exists
        await deleteSessionFile(path);
        stats.deleted++;
      }
    } catch {
      stats.errors++;
    }
  }

  return stats;
}

export default function sessionCleanupExtension(pi: ExtensionAPI): void {
  pi.registerCommand("session-cleanup-now", {
    description:
      "Delete OLD unnamed/auto-titled session files (never manually named or current). Age via PI_SESSION_CLEANUP_DAYS (default 3).",
    handler: async (_args, ctx) => {
      const stats = await cleanupSessions(false, ctx.sessionManager.getSessionFile());
      ctx.ui.notify(
        `[${EXT_ID}] deleted ${stats.deleted} unnamed/auto-titled · kept ${stats.kept} recent · protected ${stats.protected} manual/current · errors ${stats.errors} (older than ${getMaxAgeDays()}d)`,
        stats.errors ? "warning" : "info",
      );
    },
  });

  pi.registerCommand("session-cleanup-dry", {
    description:
      "Dry run: show how many OLD unnamed/auto-titled sessions would be deleted (manual names + current are protected).",
    handler: async (_args, ctx) => {
      const stats = await cleanupSessions(true, ctx.sessionManager.getSessionFile());
      ctx.ui.notify(
        `[${EXT_ID}] dry-run: would delete ${stats.candidates} unnamed/auto-titled · protected ${stats.protected} manual/current · kept ${stats.kept} recent · errors ${stats.errors} (older than ${getMaxAgeDays()}d)`,
        stats.errors ? "warning" : "info",
      );
    },
  });
}
