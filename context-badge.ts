import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Shows how full the model's context window is, as a status label.
 *
 * Everything comes from Pi itself: `ctx.getContextUsage()` is the same number
 * the terminal footer shows, and `ctx.ui.setStatus` is the host-agnostic way to
 * pin a short label next to it. Whatever front end is attached decides where
 * that lands — the terminal footer, or Pi Chat's composer footer — so this
 * needs no knowledge of any particular UI.
 */

/** Where a filling window stops being background information and becomes a warning. */
const WARN_PERCENT = 70;
const CRITICAL_PERCENT = 90;

/** One label per session, so a second session's status replaces nothing of this one's. */
const statusKey = (sessionId: string) => `context-badge.${sessionId}`;

/** 1_234 → "1.2k". A status is a few characters wide; exact digits are in `/session`. */
function compact(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * Pi reports `tokens: null` when the fill is not known yet — right after
 * compaction, before the next model response. That is not zero, so the label
 * drops out rather than claiming an empty context.
 */
function labelFor(usage: ContextUsage | undefined): { text: string; percent: number } | undefined {
  if (!usage || usage.tokens === null || usage.contextWindow <= 0) return undefined;
  const percent = usage.percent ?? (usage.tokens / usage.contextWindow) * 100;
  return { text: `${compact(usage.tokens)} / ${compact(usage.contextWindow)} · ${percent.toFixed(0)}%`, percent };
}

/**
 * The terminal colours a status through its own theme; a browser front end
 * renders the text and drops the escape sequences. Colour is therefore an
 * accent, never the thing that carries the meaning — the percentage already
 * says how full the window is, in either host.
 */
function paint(ctx: ExtensionContext, text: string, percent: number): string {
  const theme = (ctx.ui as { theme?: { fg?(color: string, text: string): string } }).theme;
  if (!theme?.fg) return text;
  if (percent >= CRITICAL_PERCENT) return theme.fg("error", text);
  if (percent >= WARN_PERCENT) return theme.fg("warning", text);
  return text;
}

export default function contextBadge(pi: ExtensionAPI): void {
  /**
   * `getContextUsage()` hangs off the event context, which the extension
   * factory never sees, so the label can only be written once an event has
   * handed one over. Writing again is free: the key replaces the previous
   * label rather than adding a second one.
   */
  const update = (_event: unknown, ctx: ExtensionContext) => {
    const key = statusKey(ctx.sessionManager.getSessionId());
    const label = labelFor(ctx.getContextUsage());
    ctx.ui.setStatus(key, label ? paint(ctx, label.text, label.percent) : undefined);
  };

  // The session opening, and every turn or compaction that can change the fill.
  pi.on("session_start", update);
  pi.on("agent_settled", update);
  pi.on("session_compact", update);

  // A closed session leaves no label behind in a host that outlives it.
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus(statusKey(ctx.sessionManager.getSessionId()), undefined);
  });
}
