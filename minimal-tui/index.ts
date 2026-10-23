/**
 * Minimal TUI Extension
 *
 * Trims Pi's TUI chrome:
 * - suppresses the interactive "Package Updates Available" startup banner
 *   (by forcing startup into offline mode for this Pi process)
 * - hides noisy footer stats like `↑38 ↓5.7k R2.0M W234k CH99.9% $3.481`
 *
 * Note: /update (manual-updates) explicitly unsets PI_OFFLINE for its child
 * process, so manual updates still work.
 */

import { FooterComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

/** Footer stats to remove. Add/remove patterns here to tune the footer. */
const HIDDEN_FOOTER_STATS: RegExp[] = [
	/↑[\d.]+[kM]?/gu, // input tokens
	/↓[\d.]+[kM]?/gu, // output tokens
	/R[\d.]+[kM]?/gu, // cache read
	/W[\d.]+[kM]?/gu, // cache write
	/CH[\d.]+%/gu, // cache hit rate
	/\$[\d.]+(?: \(sub\))?/gu, // cost
	/(?:[\d.]+%|\?)\/[\d.]+[kM]?(?: \(auto\))?/gu, // context usage
];

function stripHiddenStats(line: string): string {
	let result = line;
	for (const pattern of HIDDEN_FOOTER_STATS) result = result.replace(pattern, "");
	// Collapse the gaps left behind, but keep the leading/trailing ANSI wrappers intact.
	return result.replace(/ {2,}(?=\S)/gu, (match, offset: number) => (offset === 0 ? "" : match));
}

/** Re-right-aligns the model name after stats were removed. */
function realign(line: string, width: number): string {
	const currentWidth = visibleWidth(line);
	if (currentWidth >= width) return line;
	const gap = /[ ]{2,}/gu;
	let lastGapEnd = -1;
	for (const match of line.matchAll(gap)) lastGapEnd = match.index + match[0].length;
	if (lastGapEnd < 0) return line;
	const padding = " ".repeat(width - currentWidth);
	return line.slice(0, lastGapEnd) + padding + line.slice(lastGapEnd);
}

function hideNoisyFooterStats(): void {
	const proto = FooterComponent.prototype as unknown as {
		render(width: number): string[];
	};
	const originalRender = proto.render;
	proto.render = function (width: number): string[] {
		const lines = originalRender.call(this, width);
		// lines[0] is cwd/branch, lines[1] is the stats + model line.
		if (lines.length < 2) return lines;
		const stripped = stripHiddenStats(lines[1]);
		if (stripped === lines[1]) return lines;
		lines[1] = realign(stripped, width);
		return lines;
	};
}

function suppressStartupPackageNotification(): void {
	// Pi's interactive startup package-update banner is skipped when PI_OFFLINE is set.
	if (!process.env.PI_OFFLINE) process.env.PI_OFFLINE = "1";
}

export default function minimalTuiExtension(_pi: ExtensionAPI): void {
	suppressStartupPackageNotification();
	hideNoisyFooterStats();
}
