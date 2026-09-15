import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPiChatExtensionRegistry, type PiChatBadge } from "../git/pi-chat/src/server/extension-registry.js";

/**
 * Shows how full the model's context window is, in the Pi Chat session header.
 *
 * Everything comes from Pi itself: `ctx.getContextUsage()` is the same number
 * the terminal footer shows, so this needs nothing from Pi Chat beyond a badge
 * slot. Pi loads extensions once per open session, so each load owns exactly
 * one session's badge and says nothing about the others.
 */

/** Where a filling window stops being background information and becomes a warning. */
const WARN_PERCENT = 70;
const CRITICAL_PERCENT = 90;

/** 1_234 → "1.2k". A badge is a few characters wide; exact digits are in `/session`. */
function compact(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * Pi reports `tokens: null` when the fill is not known yet — right after
 * compaction, before the next model response. That is not zero, so the badge
 * drops out rather than claiming an empty context.
 */
function badgeFor(usage: ContextUsage | undefined, sessionId: string): PiChatBadge | undefined {
  if (!usage || usage.tokens === null || usage.contextWindow <= 0) return undefined;
  const percent = usage.percent ?? (usage.tokens / usage.contextWindow) * 100;
  return {
    id: `context-badge.${sessionId}`,
    slot: "session.status",
    label: `${compact(usage.tokens)} / ${compact(usage.contextWindow)} · ${percent.toFixed(0)}%`,
    tone: percent >= CRITICAL_PERCENT ? "red" : percent >= WARN_PERCENT ? "yellow" : "neutral",
  };
}

export default function piChatContextBadge(pi: ExtensionAPI): void {
  const chat = getPiChatExtensionRegistry();

  /**
   * `getContextUsage()` hangs off the event context, which the extension
   * factory never sees, so the badge can only be registered once an event has
   * handed one over. Re-registering is free: the owner key replaces the
   * previous badge rather than adding a second one.
   *
   * The context is asked at snapshot time, not here, so the badge shows the
   * fill as it is now rather than as it was when the turn ended. The session id
   * is checked because badges are server-wide: without it this session's fill
   * would show up in every other session's header too.
   */
  const show = (_event: unknown, ctx: ExtensionContext) => {
    const sessionId = ctx.sessionManager.getSessionId();
    chat.registerBadge(
      (snapshot) => (snapshot.sessionId === sessionId ? badgeFor(ctx.getContextUsage(), sessionId) : undefined),
      { owner: `context-badge.${sessionId}` },
    );
  };

  // The session opening, and every turn or compaction that can change the fill.
  // Pi Chat rebuilds a snapshot after each prompt settles, so the badge follows
  // without polling.
  pi.on("session_start", show);
  pi.on("agent_settled", show);
  pi.on("session_compact", show);
}
