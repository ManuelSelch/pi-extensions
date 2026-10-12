import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const DEFAULT_DAYS = 7;
export type CalendarEvent = Record<string, unknown> & { uid: string };

export function localDate(offsetDays = 0, from = new Date()): string {
	const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseEvents(json: string): CalendarEvent[] {
	const parsed: unknown = JSON.parse(json);
	const rows = Array.isArray(parsed) ? parsed.flat(Infinity) : [parsed];
	return rows.filter((row): row is CalendarEvent =>
		!!row && typeof row === "object" && typeof (row as CalendarEvent).uid === "string",
	);
}

function validDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

async function run(command: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync(command, args, { maxBuffer: 4 * 1024 * 1024 });
		return stdout;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${command} failed: ${detail}`);
	}
}

async function syncedEvents(start: string, end: string): Promise<CalendarEvent[]> {
	if (!validDate(start) || !validDate(end) || start > end) {
		throw new Error("Dates must be valid YYYY-MM-DD values with start on or before end.");
	}
	await run("vdirsyncer", ["sync"]);
	const output = await run("khal", ["list", "--json", "all", start, end]);
	return parseEvents(output);
}

const ListParams = Type.Object({
	start: Type.Optional(Type.String({ description: "Start date (YYYY-MM-DD); defaults to today" })),
	end: Type.Optional(Type.String({ description: "End date (YYYY-MM-DD); defaults to 7 days from today" })),
});
const ReadParams = Type.Object({
	uid: Type.String({ description: "Exact event UID returned by calendar_list" }),
	start: Type.String({ description: "Event start date (YYYY-MM-DD), from calendar_list" }),
	end: Type.String({ description: "Event end date (YYYY-MM-DD), from calendar_list" }),
});

export default function calendarExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "calendar_list",
		label: "List Calendar Events",
		description: "Sync all configured calendars and list events for a date range (defaults to today through 7 days ahead).",
		parameters: ListParams,
		async execute(_id, params) {
			try {
				const start = params.start ?? localDate();
				const end = params.end ?? localDate(DEFAULT_DAYS);
				const events = await syncedEvents(start, end);
				return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }], details: { events } };
			} catch (error) {
				return { content: [{ type: "text", text: `Calendar list failed: ${(error as Error).message}` }], isError: true, details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "calendar_read",
		label: "Read Calendar Event",
		description: "Sync all configured calendars and read one exact event by UID and its listed date range.",
		parameters: ReadParams,
		async execute(_id, params) {
			try {
				if (!params.uid.trim()) throw new Error("Event UID is required.");
				const events = await syncedEvents(params.start, params.end);
				const matches = events.filter((event) => event.uid === params.uid);
				if (matches.length === 0) throw new Error("No event with that UID was found in the supplied date range.");
				if (matches.length > 1) throw new Error("UID matched multiple event instances; narrow the date range.");
				const event = matches[0];
				return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }], details: { event } };
			} catch (error) {
				return { content: [{ type: "text", text: `Calendar read failed: ${(error as Error).message}` }], isError: true, details: undefined };
			}
		},
	});
}
