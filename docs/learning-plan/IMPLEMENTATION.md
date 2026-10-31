# Verification and activation

Implemented learning_plan tool, /learning-plan command, native string widget,
session-branch snapshot replay, and the teach skill integration. Todo, quiz,
Pi Chat, server and SDK production code are unchanged.

Checks run:
- Full extensions suite: 351 tests passed (including 19 new learning-plan tests).
- npm run typecheck: passed.
- Native extension discovery: passed against this repository's installed Pi and
  the Pi Chat installed Pi, including the new learning_plan tool and command.
- Git whitespace checks: passed.

Acceptance drivers use actual disk-backed SessionManager files and invoke the
registered extension callbacks. The compaction scenario invokes real
AgentSession.compact using a deterministic summary supplied by a test extension,
and verifies plan tool results have left model context while branch replay
still restores them. It does not call a model or test model-generated summaries.
Skill checks validate instruction text and the tracked/personal copy when
installed; they do not prove agent compliance or assessment accuracy.

No browser automation, screenshot comparison, real-model teaching run, or
visible native terminal interaction was performed. The existing Pi Chat widget
renderer is reused without changes. Native Pi/server sessions were not reloaded.
Use /reload in the intended Pi session before trying teaching with the new tool;
no server package update or web build is required for this string widget.

The updated personal teach skill is at ~/.pi/agent/skills/teach/SKILL.md.
Its installable copy is tracked at docs/learning-plan/teach/SKILL.md.
The approved temporary design and permanent executable scenarios are retained.
