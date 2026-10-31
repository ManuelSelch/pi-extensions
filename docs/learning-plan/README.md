# Session learning plans

The `learning-plan` extension provides an ordered milestone list for teaching.
It works in native Pi and Pi Chat using the existing plain-text widget API;
no Mermaid, browser feature, SDK or server changes are required.

## Usage

Reload Pi to discover the extension. Start a teaching session using the teach
skill. It retrieves an existing plan or creates a short agreed plan, activates
the current milestone, and records changed assessment evidence as teaching
continues.

`/learning-plan` shows all milestones, criteria and latest evidence. The
above-editor widget shows compact rows, including demonstrated milestones.
For plans over eight milestones, completed rows yield space first, the active
milestone remains visible, and a hidden count points to the full command.
Milestone titles are truncated to 40 display columns (including `…`) in the
widget, without splitting graphemes. Full titles remain stored and visible in
`/learning-plan` and tool results. This is a fixed display cap, not responsive
to the browser widget width. The tool guides agents to use 3–6 words, ideally
under 40 characters, and put detailed objectives in the criterion; the storage
limit remains 160 characters.

```text
TypeScript · 1/3
✓ #1 Explain unions
● #2 Apply narrowing
○ #3 Solve an independent task
```

Demonstrated means “demonstrated for now,” not permanent mastery or a knowledge
percentage. Unlike todos, milestones are completed by learner understanding,
not by the agent having explained a topic.

## Tool contract

One tool, `learning_plan`, exposes:

| Action | Input | Meaning |
|---|---|---|
| create | title, milestones: [{title, criterion}] | Create one plan, initially pending. Refuses overwrite. |
| get | — | Retrieve the full plan and evidence. No model assessment is performed. |
| update | updates: [{id, status?, evidence?}] | Atomically change statuses/evidence by stable milestone ID. |
| add | title, criterion | Append a pending milestone with a new ID. |

Statuses: `pending`, `active`, `demonstrated`. At most one may be active.
To demonstrate a milestone or reopen demonstrated understanding, provide a
nonempty assessment evidence summary. Other assessment changes can update
evidence without changing status. The tool checks evidence presence, not its truth.
Complete one and activate the next in the same update batch.
Invalid batches change neither the plan nor its widget.

There is one plan per session, at most 50 milestones. Titles are at most
160 characters, criteria 1000, evidence 2000. A different overall objective
uses a new session; reset/replacement and graph dependencies are not implemented.
There is no scoring, scheduling, cross-session profile, or automatic quiz grading.

## State ownership

Every successful tool result includes a complete plan snapshot in `details`.
Pi records that result in session history. The extension reconstructs state
from successful results on the active branch at start, tree navigation and
compaction, and drops its session-keyed cache at shutdown. It does not scan
abandoned branches, use external storage or keep a UI context.
Compaction shortens model context, not the recorded branch; branch replay
continues to recover the snapshots. Native Pi may defer writing a session file
until an assistant response materializes history, as with the todo extension.
The widget is repainted from that state; missing UI does not prevent tool use.

## Teaching integration

The personal [teach skill](../../../skills/teach/SKILL.md) is outside this Git
repository. Its current installable source is preserved as
[teach/SKILL.md](teach/SKILL.md); copy it into the personal teach skill directory
when installing elsewhere. The skill retrieves on start/resume,
activates before teaching, and updates changed assessments before asking the
next question. Completion requires sound explanation plus materially different
independent application; hints, lucky selections and cancellation do not count.
On pause it preserves incomplete milestones; later contradictory evidence can
reopen a milestone with a reason. Learning milestones use this tool, not todo.

These update points are instructions to the agent, not a deterministic grading
engine. A missing tool or failed mutation must be disclosed without claiming
persistence. Quiz collection and its cancellation/minimize behavior are unchanged.

## Verification boundary

[Acceptance scenarios](../../learning-plan/tests/integration/learning-plan.test.cjs)
exercise the registered tool and lifecycle callbacks with real disk-backed Pi
SessionManager history; compaction calls real AgentSession.compact with a
deterministic extension-provided summary and no model request. Widget assertions
inspect emitted lines, not browser pixels. Skill checks verify the tracked instructions and their equality to the personal
installation when present, not real-model compliance. Unit tests cover validation, replay and formatting.
