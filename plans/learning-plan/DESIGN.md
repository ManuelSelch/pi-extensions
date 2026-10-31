# Learning plan — Design

## Overview
Add a standalone learning-plan extension and update the personal teach skill. Reuse native string widgets and session persistence; no Pi Chat, SDK, quiz, or todo behavior changes. The selected list mockup is the visual baseline.

## Decisions & Trade-offs
- Proposed slice: learning-plan/index.ts wires the extension; domain/ owns pure state/actions, ui/ owns pure string formatting, app/ owns session lifecycle and tool orchestration. No cross-imports from todo internals or new dependencies.
- One ordered plan per session: title, stable milestone IDs, completion criteria, pending/active/demonstrated status, and brief latest evidence. At most one active milestone. IDs are never reused within a plan.
- One learning_plan tool exposes create, get, update and add. Create rejects an existing plan; replacing/resetting is not included in this version. Update accepts a batch so completing one milestone and activating another is atomic. Validate the full batch before mutation. Evidence is required for demonstration and for reopening demonstrated understanding. The extension validates presence, not truth, of evidence.
- Tool-result details hold complete snapshots on successful mutations, following todo. Rebuild from the current branch on session start/tree/compaction; preserve a custom checkpoint if needed for real Pi compaction. Verify rather than assume Pi retains custom entries. Transient caches are session-scoped and never store UI contexts.
- Render a learning-plan widget aboveEditor using title/count and short ID/status rows. Keep demonstrated milestones visible for short plans; cap at eight rows for long plans, prioritizing active/pending rows and indicating hidden count. /learning-plan and get expose all criteria/evidence. No model turn is triggered by rendering.
- The skill retrieves on start/resume, creates a short agreed plan, activates before teaching, and updates after assessment before the next question when evidence/status changes. It records independent versus assisted performance, never grades cancellation, preserves unfinished work on pause, and rechecks uncertain understanding. Replace the current “avoid a syllabus or graph” wording with short ordered milestone guidance. Teaching milestones use learning_plan rather than todo.
- Auto-updates are agent tool calls guided by skill/tool instructions; no claim of deterministic LLM compliance or automatic grading. Quiz remains evidence collection. Missing tool support is disclosed and ordinary teaching may continue without pretending persistence.
- Native personal skill is outside Git; preserve its current quiz instructions and make targeted edits. Tests can verify instruction contracts, not real-model teaching behavior.
- Existing todo/quiz journeys are preserved. New learning plans add no wire contract or frontend support. No legacy migration or compatibility shim.

## Verification
[Acceptance scenarios](../../learning-plan/tests/integration/learning-plan.test.cjs) define create/render, atomic assessment updates, invalid mutations, reopening/extension, real Pi compaction/resume/tree restoration, session isolation and skill integration.
Drivers are explicitly throwing scaffolds until approval. After approval, implement drivers and meaningful failing checks before production implementation. Add pure domain tests, real installed Pi persistence probes, active extension discovery, full repository tests and typecheck. Report fake widget checks separately from real browser verification; no browser automation requested.

## Open Questions
None. Changing an existing plan's overall objective/replacing it is intentionally not part of the approved small first version.
