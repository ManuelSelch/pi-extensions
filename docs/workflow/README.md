# Workflow

## Use
- `/workflow` opens the project selection popup: select a row to toggle it, then Save. Cancel/Escape writes nothing.
- `/workflow global` edits global defaults without project overrides.
- `/workflow status` shows settings, provenance, resource paths, and pending skill discovery.
- `/workflow preview` shows exactly the workflow prompt contribution, not full skill bodies.
- Project popup: Restore inherited enablement removes local enabled fields without deleting custom prompts/skills; changes are staged until Save.

All four steps default on. Settings persist to `<agent-dir>/workflow.json` and `<session-cwd>/.pi/workflow.json`. There is no version field, ancestor lookup, Git-root lookup, or session-only state. Project configuration requires project trust. Scope is shown in the popup title.

## Setup / personal migration
The extension does not create or move personal files on startup. Until setup is approved and applied, the defaults refer to missing personal assets; `/workflow` is usable, but injection/discovery report these paths as unavailable. The local installation was migrated with explicit approval; see [the migration record](MIGRATION.md#local-installation). See the source checklist in [MIGRATION.md](MIGRATION.md). The repository's prompt templates are under [workflow/assets/prompts](../../workflow/assets/prompts/); install editable copies under `<agent-dir>/workflow/prompts/`. Managed skills belong under `<agent-dir>/workflow/skills/`, not normally scanned skill directories.

Default managed skill paths (relative to `<agent-dir>/workflow/skills/`):
- mock: `mockup-first/SKILL.md`
- plan: `roles/analyst/SKILL.md`
- design: `roles/design-writing/SKILL.md`
- commit: none

## Configure resources
Edit JSON and Markdown directly; the popup changes enablement only. Example global override:

```json
{
  "steps": {
    "mock": { "enabled": true, "prompt": "workflow/prompts/mock.md", "skills": ["workflow/skills/mockup-first/SKILL.md"] },
    "commit": { "enabled": false }
  }
}
```

Omitted fields inherit (built-ins → global → explicit project values). `false` disables; `prompt: null` selects no prompt; `skills: []` selects no skills. Skill lists replace inherited lists. Relative paths are anchored to the file declaring them; absolute paths are accepted. Skills must name `SKILL.md` files. No shell/environment interpolation occurs. Unknown unrelated fields survive writes; malformed known fields are rejected.

## Activation and limits
Prompts refresh on the next agent run. Skills are submitted through native Pi discovery at startup or `/reload`; full bodies remain lazy-loaded. Native Pi diagnostics handle malformed skills and name collisions. Reload rebuilds available skills, but cannot erase instructions already read into the conversation: start a fresh session for a clean reset. Independently discovered copies, client-supplied instructions, and old memory mandates can still require disabled steps until migration removes them.

Native selection dialogs work in TUI and RPC; no custom terminal widget is used. Headless sessions still discover/inject, but cannot edit through a popup. Structured prompt sections are required; there is no full-system-prompt replacement fallback. Another extension forcing an opaque full prompt can supersede structured sections.

Writes use an exclusive adjacent `.lock` directory, conflict checks, a same-directory temporary file, and atomic rename. If a process crashes, verify no writer remains before manually removing the reported lock. Manual edits that ignore the lock still have a narrow final check/rename race; do not edit a file while saving its popup.

## Verification
Run `npm test -- workflow`, `npm run typecheck`, and `npm test`. Native integration tests use locally available SDK 1.0.2 and installed Pi 1.4.0 when present; set `PI_WORKFLOW_SDK_ENTRIES` to a path-delimited list of SDK `dist/index.js` files elsewhere. Fixtures use temporary agent/project directories and make no model calls.
