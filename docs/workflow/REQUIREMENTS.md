# Workflow Extension — Requirements

## Goal
Give the user independent control over the mock, plan, design, and commit workflow instructions. Extract those instructions from always-present guidance into editable prompt files, activated through a small Pi extension with global configuration and per-project overrides.

## Requirements
- **R1** — Support independently enabling and disabling `mock`, `plan`, `design`, and `commit`. Multiple steps may be enabled together; these are instruction switches, not an automatically advancing state machine. Disabled means no requirement to perform that step, not a prohibition on an explicit user request.
- **R2** — Read global `workflow.json` and an optional project `workflow.json`. Project settings override only explicitly supplied fields; omitted fields inherit, and explicit `false` disables an inherited step. Document defaults, lookup boundaries, and precedence.
- **R3** — Keep prompt text in ordinary editable Markdown files outside extension source. Configuration associates each step with its prompt file and enabled state. Resolve relative paths against the configuration file declaring them. A project may override a step's enabled state, prompt file, or both without copying unrelated settings.
- **R4** — Provide a `/workflow` command to inspect and change step settings, with a scope-explicit way to save global or project settings and restore project inheritance. Show effective enabled states, configuration provenance, and resolved prompt paths. Command arguments must work without a custom terminal UI.
- **R5** — Provide a way to inspect the exact composed workflow instructions before use. Editing a prompt or configuration takes effect on the next agent run without restarting Pi. Define a stable composition order and include each enabled prompt once; repeated runs must not accumulate duplicate instructions.
- **R6** — Update only the extension-owned workflow prompt section, preserving Pi's other instructions and other extensions' sections. Turning a step off removes it from subsequent active workflow injection; it cannot erase previously read instructions, conversation history, or higher-priority instructions.
- **R7** — Inventory and migrate existing workflow mandates so they are not still injected or automatically reintroduced elsewhere when a step is disabled. Preserve specialist guidance that is not a workflow gate. In particular, separate mandatory plan/design gates from developer implementation guidance and review skill descriptions and cross-links, not only skill bodies. Migration of personal files requires explicit approval and a reversible backup.
- **R8** — Diagnose malformed configuration, unsupported versions, and missing/unreadable enabled prompts with the responsible path. Never overwrite invalid configuration or silently use a conflicting fallback. Disabled prompts need not exist. Reject invalid command writes without modifying files; valid writes preserve unrelated settings and avoid partial files or lost concurrent updates.
- **R9** — Respect Pi's project-trust boundary before loading project configuration or project-selected prompt content. Prompts are trusted instructions, not executable templates. Do not evaluate code or interpolate shell commands.
- **R10** — Keep the initial extension limited to prompt selection, composition, inspection, and settings management. Do not add approval tracking, automatic stage transitions, tool blocking, autonomous commits, or a general workflow engine. An enabled commit prompt guides the agent; toggling it never directly executes Git commands.

## Assumptions
- Proposed global location: `<agent-dir>/workflow.json`, normally `~/.pi/agent/workflow.json`; proposed project location: `<project>/.pi/workflow.json`. Honor Pi's configured agent directory rather than hard-coding the home directory.
- Proposed prompt locations: `<agent-dir>/workflow/prompts/` and optional project `.pi/workflow/prompts/`. These are not Pi's slash-command prompt-template directory and are not automatically discovered skills.
- Proposed initial lookup uses the session working directory as the project boundary, with no ancestor search. Repository-root lookup remains a decision in Q2.
- Proposed initial interface is `/workflow` for inspection plus subcommands for settings and composed-prompt preview; no custom editor or dashboard is necessary.
- Proposed composition order is mock → plan → design → commit. Prompts describe when each enabled step applies; enabling mock does not require mockups for unrelated backend tasks.
- Current inspected sources include `skills/mockup-first/SKILL.md`, `skills/roles/analyst/SKILL.md`, `skills/roles/developer/SKILL.md`, and `skills/roles/design-writing/SKILL.md` under the agent directory. The inspected global `AGENTS.md` contains memory instructions, not workflow gates; no global `SYSTEM.md` or `APPEND_SYSTEM.md` was found. Additional system-level instructions may come from the invoking client.
- Stored user preferences also contain mandatory planning-skill guidance and automatic-commit guidance. These are migration inputs, not instructions the extension can simply override. Selectively moving workflow mandates out of memory must preserve unrelated preferences and follow memory-edit policies.
- The inspected installed Pi documentation supports structured prompt sections through `before_agent_start`. This repository declares an older SDK range; compatibility must be checked during design rather than assuming identical APIs.

## Implementation Plan
### S1 — Configuration and prompt files
Description: Implement R1–R3 and configuration validation from R8 after resolving Q1–Q3. Define the versioned schema, defaults, field-level override semantics, path resolution, and project boundary. Verify inheritance, explicit false, partial overrides, relative paths, malformed files, and absent optional configuration with isolated fixtures. No live personal prompts are changed.

### S2 — Prompt composition and injection
Description: After S1, implement R5, R6, R9, and the R10 runtime boundary. Compose enabled prompts in a stable order and update only the workflow-owned prompt section at the next agent-run boundary. Verify repeated runs, prompt edits, disabling/removing all prompts, preservation of unrelated sections, trusted versus untrusted projects, and enabled-prompt read failures against the supported Pi runtime. Do not introduce a legacy SDK fallback unless a supported-runtime decision requires it.

### S3 — Workflow controls
Description: After S1 and S2, implement R4 and settings writes from R8. Add status, explicit-scope on/off changes, project inheritance reset, and exact prompt preview through command arguments, usable in TUI and RPC without custom terminal components. Verify provenance, scope isolation, invalid-write protection, concurrent-write behavior, and next-run activation. No model-callable settings tool is required for the initial version.

### S4 — Prompt extraction and migration
Description: After S2 and S3, implement R7 with an approved source-by-source migration checklist and backups. Extract workflow mandates into the four prompt files, remove duplicate automatic triggers and conflicting cross-step gates from their original sources, and preserve useful specialist content. Reconcile workflow-related memory preferences and any client-supplied instructions with the user. Verify all-off and individual-step configurations in fresh sessions so previously loaded skill text does not mask migration failures; document existing-session limitations and manual invocation. Do not claim a step is fully optional while another active source still mandates it.

## Open Questions
- **Q1** — Which steps should be enabled globally by default? Recommendation: preserve your current behavior initially, then disable steps per project.
- **Q2** — Should project configuration resolve from the session working directory or the Git repository root when Pi starts in a subdirectory? Recommendation: Git repository root, falling back to the working directory outside Git.
- **Q3** — Should `/workflow` toggles persist to project configuration by default, or apply only to the current session unless explicitly saved? Recommendation: persist to project configuration with explicit global scope available; omit session-only state initially.
