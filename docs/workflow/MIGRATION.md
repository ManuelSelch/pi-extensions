# Personal workflow migration checklist

This changes files outside the extensions repository and needs explicit user approval. No automatic migration runs when the extension loads.

## Proposed changes
1. Back up the source skill directories, developer skill, global workflow files if present, and workflow-related memory preferences under `<agent-dir>/backups/workflow-<timestamp>/`. Record each original location and keep a restore manifest. Refuse to overwrite an existing destination.
2. Install editable copies of the four repository [prompt templates](../../workflow/assets/prompts/) under `<agent-dir>/workflow/prompts/`. Create a global `workflow.json` from [workflow.default.json](../../workflow/workflow.default.json), with explicit enabled states and prompt/skill paths, without a version field. Fill omitted fields only when migrating an existing global configuration.
3. Move whole skill directories out of automatic scanning:
   - `skills/mockup-first/` → `workflow/skills/mockup-first/`
   - `skills/roles/analyst/` → `workflow/skills/roles/analyst/`
   - `skills/roles/design-writing/` → `workflow/skills/roles/design-writing/`
   Preserve names, frontmatter, `EXAMPLE.md`, and relative supporting references. Do not leave symlinks or duplicate discovered copies.
4. Keep the developer skill discoverable for implementation/TDD/architecture. Change its description to implementation-focused guidance; replace the unconditional Plan → Design gate with instructions to follow only enabled workflow gates or explicit user requests. Keep requirements/design documents as inputs when present, not mandatory artifacts. Preserve TDD, incremental work, architecture, tests, and unrelated safeguards.
5. In the moved design-writing skill, repair its link to the still-discovered developer skill. Remove automatic analyst invocation solely because requirements are absent; use direct clarification when planning is disabled. Existing design → analyst links remain valid for explicit planning requests, but do not create cross-step prerequisites.
6. Remove automatic-commit mandates from always-loaded memory preferences now owned by the commit prompt. Move mandatory analyst routing/handover guidance into the plan bundle rather than leaving stale original paths in system memory. Preserve unrelated Git safety preferences (task-only commits, no automatic push), folder casing, communication preferences, and memory policy. Update the existing architecture memory note to describe the new skill locations and optional gates, not a second conflicting note.
7. Global `AGENTS.md` has no workflow mandates and is unchanged. No global `SYSTEM.md`/`APPEND_SYSTEM.md` existed during inspection. Any client-supplied copy of the old skills or workflow rules needs a new session/reload or separate client configuration change; do not claim to remove higher-priority client instructions.

## Check before declaring migration complete
- Confirm the exact files in the backup/restore manifest and review only the intended changes.
- Parse the installed skills with native Pi; check their supporting references and descriptions, and ensure each skill is advertised once with all steps on.
- In isolated fresh Pi contexts using the installed personal assets, test all-off, each step alone, and default all-on. Confirm missing plan requirements do not force analyst invocation through the design/developer skills.
- The current conversation retains old instructions. Start a fresh real session after migration and inspect `/workflow status`; smoke tests verify configuration/discovery, not guaranteed model obedience.

## Local installation

Applied with explicit confirmation. The backup and restore manifest are at `<agent-dir>/backups/workflow-20261026-075751/manifest.json`. The three skills were moved, developer/design cross-step gates were separated, the four prompts were installed, all steps were enabled globally, and only workflow mandates were removed from always-loaded memory preferences. Global `AGENTS.md` and unrelated settings were unchanged.

Native Pi 1.4.0 checks using isolated copies of the installed personal assets passed for default all-on, all-off, and each step alone. Managed skill metadata loaded without diagnostics and moved skill references resolve. These are structural/discovery checks, not a guarantee of model obedience. The current conversation still retains old instructions; use a fresh session.

A separately approved defaults migration replaced TypeScript mappings with shipped `workflow/workflow.default.json` and expanded the existing global JSON without changing its selections. Its pre-expansion backup is `<agent-dir>/backups/workflow-json-defaults-20261026-081536/workflow.json`. Prompt/skill files were not moved or changed by this follow-up.

## Restore
After stopping edits/sessions, restore original directories and developer/memory content from the manifest, remove only migration-created workflow files, and reload/start a fresh session. Do not delete unrelated files added after migration.
