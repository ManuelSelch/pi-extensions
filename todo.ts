/**
 * Todo extension
 *
 * A task list the model keeps while it works: the `todo` tool for the model,
 * `/todos` for you, and a widget above the editor so the current plan stays on
 * screen.
 *
 * It is written to work in any host, not just the terminal. Three rules do
 * that, and they are the whole design:
 *
 * 1. State lives in the tool result's `details`, never in a file. Pi rebuilds
 *    it by replaying the session branch, so it survives `/reload` and
 *    compaction and branches correctly with `/tree` without any code here.
 * 2. Output goes through `notify` and `setWidget` with plain string lines,
 *    which Pi's RPC protocol carries verbatim. `ui.custom()` and component
 *    factories are terminal-only and are not used, so Pi Chat renders this
 *    without knowing anything about todos.
 * 3. The UI context is never stored. Every callback uses the `ctx` it was
 *    handed, which is what makes a session replacement or a background session
 *    harmless: there is no stale reference to invalidate.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type TUnsafe } from "typebox";

/**
 * A plain `{ type: "string", enum: [...] }` schema.
 *
 * Pi ships this as `StringEnum` in `@earendil-works/pi-ai`, but 0.85.1 does not
 * export it from the package root, and the union form TypeBox builds instead
 * (`anyOf` of consts) is rejected by Google's API. Six lines here beat a
 * dependency on an unexported path.
 */
function stringEnum<const T extends readonly string[]>(values: T, description: string): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ type: "string", enum: values, description });
}

export const TOOL_NAME = "todo";
export const TODO_SNAPSHOT_ENTRY = "todo-state";
const WIDGET_KEY = "todos";
/** Long lists are for `/todos`; the widget stays a glance, not a screen. */
const WIDGET_MAX_ROWS = 8;

export type TodoStatus = "pending" | "doing" | "done";

export interface Todo {
  id: number;
  text: string;
  description?: string;
  status: TodoStatus;
}

export interface TodoState {
  todos: Todo[];
  nextId: number;
}

export const EMPTY: TodoState = { todos: [], nextId: 1 };

const MARK: Record<TodoStatus, string> = { pending: "○", doing: "◐", done: "✓" };

function cleanDescription(description: string | undefined): string | undefined {
  const trimmed = description?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTodo(todo: unknown): Todo {
  const value = todo as Partial<Todo>;
  const description = cleanDescription(value.description);
  return {
    id: typeof value.id === "number" ? value.id : 0,
    text: typeof value.text === "string" ? value.text : "",
    ...(description ? { description } : {}),
    status: value.status === "doing" || value.status === "done" ? value.status : "pending",
  };
}

function normalizeState(data: unknown): TodoState | undefined {
  const value = data as Partial<TodoState> | undefined;
  if (!Array.isArray(value?.todos) || typeof value.nextId !== "number") return undefined;
  return { todos: value.todos.map(normalizeTodo), nextId: value.nextId };
}

export function todoSnapshot(state: TodoState): TodoState {
  return { todos: state.todos.map(normalizeTodo), nextId: state.nextId };
}

function formatTodoLine(todo: Todo): string {
  const line = `${MARK[todo.status]} #${todo.id} ${todo.text}`;
  return todo.description ? `${line}\n  ${todo.description.replace(/\n/g, "\n  ")}` : line;
}

const TodoParams = Type.Object({
  action: stringEnum(
    ["add", "update", "list", "clear"],
    "add a task, update its status, list everything, or clear the list",
  ),
  text: Type.Optional(Type.String({ description: "Task text (add/update). Short and imperative." })),
  description: Type.Optional(
    Type.String({ description: "Longer task details, acceptance criteria, context, or review notes." }),
  ),
  id: Type.Optional(Type.Number({ description: "Task id (update)" })),
  status: Type.Optional(stringEnum(["pending", "doing", "done"], "New status (update)")),
});

export interface TodoParamsValue {
  action: "add" | "update" | "list" | "clear";
  text?: string;
  description?: string;
  id?: number;
  status?: TodoStatus;
}

export interface Applied {
  state: TodoState;
  message: string;
  /** A rejected call, e.g. an unknown id. The state is then unchanged. */
  failed?: boolean;
}

/**
 * The only place tasks change. Pure, so the tool, the tests, and any future
 * caller all agree on what an action means.
 */
export function applyAction(state: TodoState, params: TodoParamsValue): Applied {
  if (params.action === "add") {
    const text = params.text?.trim();
    if (!text) return { state, message: "add needs text.", failed: true };
    const description = cleanDescription(params.description);
    const todo: Todo = { id: state.nextId, text, ...(description ? { description } : {}), status: "pending" };
    return {
      state: { todos: [...state.todos, todo], nextId: state.nextId + 1 },
      message: `Added #${todo.id}: ${todo.text}`,
    };
  }

  if (params.action === "update") {
    if (params.id === undefined) return { state, message: "update needs an id.", failed: true };
    const nextText = params.text?.trim();
    const hasDescription = params.description !== undefined;
    const nextDescription = hasDescription ? cleanDescription(params.description) : undefined;
    if (!params.status && !nextText && !hasDescription) {
      return { state, message: "update needs a status, text, or description.", failed: true };
    }
    const target = state.todos.find((todo) => todo.id === params.id);
    if (!target) return { state, message: `No task #${params.id}.`, failed: true };
    const updated: Todo = {
      ...target,
      ...(nextText ? { text: nextText } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    if (hasDescription) {
      if (nextDescription) updated.description = nextDescription;
      else delete updated.description;
    }
    return {
      state: {
        ...state,
        todos: state.todos.map((todo) => (todo.id === target.id ? updated : todo)),
      },
      message: `Updated #${updated.id}: ${updated.text}`,
    };
  }

  if (params.action === "clear") {
    // nextId keeps counting: ids stay unique within a session, so an id in an
    // earlier message never silently refers to a different task later.
    return { state: { todos: [], nextId: state.nextId }, message: "Cleared the list." };
  }

  return { state, message: summary(state) };
}

/** One line per task, which is also what the model reads back. */
export function summary(state: TodoState): string {
  if (state.todos.length === 0) return "No tasks.";
  return state.todos.map(formatTodoLine).join("\n");
}

/**
 * Rebuilds the list by walking the current branch: the last `todo` result on it
 * wins. A branch only contains its own writes, so `/tree` and `/fork` get the
 * right list for free, and nothing has to be migrated or cleaned up.
 */
export function replayFromBranch(branch: Iterable<unknown>): TodoState {
  let state = EMPTY;
  for (const entry of branch) {
    const item = entry as {
      type?: string;
      customType?: string;
      data?: unknown;
      message?: { role?: string; toolName?: string; details?: unknown };
    };

    if (item.type === "custom" && item.customType === TODO_SNAPSHOT_ENTRY) {
      const snapshot = normalizeState(item.data);
      if (snapshot) state = snapshot;
      continue;
    }

    if (item.type !== "message") continue;
    const message = item.message;
    if (message?.role !== "toolResult" || message.toolName !== TOOL_NAME) continue;
    const snapshot = normalizeState(message.details);
    // Defensive: an older or truncated entry must not take the list down.
    if (snapshot) state = snapshot;
  }
  return state;
}

export function getTodoStateFromBranch(branch: Iterable<unknown>): TodoState {
  return replayFromBranch(branch);
}

/**
 * The widget lines, or `undefined` to clear it.
 *
 * Every task is listed, finished ones included: you are reading along, and a
 * plan whose completed steps vanish is a plan you cannot check. Ids are shown
 * so you can say "#3 is wrong" and the model knows which task you mean — they
 * are the same ids the tool takes. The header carries the count, and an empty
 * list removes the widget entirely.
 *
 * When the list outgrows the widget, completed tasks give up their rows first,
 * oldest first: they are the ones you are least likely to still be reading, and
 * what happens next has to stay on screen. `/todos` always shows everything.
 */
export function widgetLines(state: TodoState): string[] | undefined {
  if (state.todos.length === 0) return undefined;
  const done = state.todos.filter((todo) => todo.status === "done").length;
  const header = `Todos ${done}/${state.todos.length}`;

  const shown = [...state.todos];
  while (shown.length > WIDGET_MAX_ROWS) {
    const oldestDone = shown.findIndex((todo) => todo.status === "done");
    // Nothing left to drop but open work: truncate from the end instead, so the
    // tasks that come first stay visible.
    if (oldestDone === -1) break;
    shown.splice(oldestDone, 1);
  }

  const rows = shown.slice(0, WIDGET_MAX_ROWS).map((todo) => `${MARK[todo.status]} #${todo.id} ${todo.text}`);
  const hidden = state.todos.length - rows.length;
  return [header, ...rows, ...(hidden > 0 ? [`… ${hidden} more`] : [])];
}

/** `/todos` output. Markdown, because every host can render or print it. */
export function todosMarkdown(state: TodoState): string {
  if (state.todos.length === 0) return "**Todos**\n\nNothing on the list.";
  const done = state.todos.filter((todo) => todo.status === "done").length;
  const rows = state.todos.flatMap((todo) => {
    const row = `- ${MARK[todo.status]} **#${todo.id}** ${todo.text}`;
    return todo.description ? [row, `  ${todo.description.replace(/\n/g, "\n  ")}`] : [row];
  });
  return [`**Todos** — ${done}/${state.todos.length} done`, "", ...rows].join("\n");
}

/**
 * Live state per session id.
 *
 * A single process can hold several sessions at once — Pi Chat runs one per tab
 * — so a shared list would let one tab's tasks show up in another. Between
 * runs the branch is authoritative; this map only carries the list across the
 * calls within one run, where the current result is not on the branch yet.
 */
class Sessions {
  private readonly states = new Map<string, TodoState>();

  private static id(ctx: ExtensionContext): string {
    return ctx.sessionManager.getSessionId() ?? "";
  }

  get(ctx: ExtensionContext): TodoState {
    return this.states.get(Sessions.id(ctx)) ?? EMPTY;
  }

  set(ctx: ExtensionContext, state: TodoState): void {
    this.states.set(Sessions.id(ctx), state);
  }

  /** Re-derives one session's list from its branch and returns it. */
  reload(ctx: ExtensionContext): TodoState {
    const state = replayFromBranch(ctx.sessionManager.getBranch());
    this.set(ctx, state);
    return state;
  }

  forget(ctx: ExtensionContext): void {
    this.states.delete(Sessions.id(ctx));
  }
}

export default function todoExtension(pi: ExtensionAPI): void {
  const sessions = new Sessions();

  /**
   * Widgets are addressed by key and re-sent whole, so this is both the first
   * paint and every update. `undefined` clears, which is how an empty list
   * removes the panel instead of leaving a heading behind.
   */
  const paint = (ctx: ExtensionContext, state: TodoState): void => {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(WIDGET_KEY, widgetLines(state), { placement: "aboveEditor" });
  };

  // Resuming, branching, and compacting all change which writes are on the
  // branch, so each one re-derives rather than trusting what is in memory.
  const reload = async (_event: unknown, ctx: ExtensionContext): Promise<void> => {
    paint(ctx, sessions.reload(ctx));
  };
  pi.on("session_start", reload);
  pi.on("session_tree", reload);
  pi.on("session_compact", reload);

  pi.on("session_shutdown", async (_event, ctx) => sessions.forget(ctx));

  pi.registerTool({
    name: TOOL_NAME,
    label: "Todo",
    description:
      "Track multi-step work. Actions: add (text), update (id, status), list, clear. " +
      "Status is pending → doing → done.",
    promptSnippet: "Keep a task list while working through multi-step work",
    promptGuidelines: [
      "Use todo for work with three or more steps, or whenever the user hands you a list. Skip it for a single trivial change.",
      "Mark a task doing before starting it and done immediately after, one task doing at a time.",
      "Never mark a task done while tests fail or the change is partial: leave it doing and add a task for the blocker.",
      "Keep the text short and imperative, e.g. 'Forward details to the client'.",
    ],
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = applyAction(sessions.get(ctx), params as TodoParamsValue);
      sessions.set(ctx, result.state);
      paint(ctx, result.state);
      return {
        content: [{ type: "text", text: result.message }],
        // Every result carries the whole list: this is the record the next
        // session replays from, so a partial one would lose tasks.
        details: { todos: result.state.todos, nextId: result.state.nextId },
        ...(result.failed ? { isError: true } : {}),
      };
    },
  });

  pi.registerCommand("todos", {
    description: "Show the task list for this session",
    handler: async (_args, ctx) => {
      // The branch is authoritative and cheap to read, so the command reports
      // what the session actually recorded rather than what is in memory.
      const state = sessions.reload(ctx);
      paint(ctx, state);
      ctx.ui.notify(todosMarkdown(state), "info");
    },
  });
}
