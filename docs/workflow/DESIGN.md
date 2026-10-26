# Workflow Extension — Design

## Overview
A small `workflow/` extension resolves four configurable instruction bundles: short workflow prompts plus optional native Pi skills. Prompts refresh before each agent run; skill discovery happens only at startup and `/reload`. All steps default on, and project overrides belong to the session working directory, as agreed in the [requirements](REQUIREMENTS.md).

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| `workflow/index.ts` | Native extension entry | New, proposed | Register `/workflow`, `resources_discover`, and `before_agent_start`; wire adapters |
| `workflow/Domain/` | Configuration resolver and composer | New, proposed | Validate values, merge fields with provenance, parse commands, order prompt contributions; pure logic |
| `workflow/App/` | Workflow controller | New, proposed | Coordinate reads/writes and own the runtime's last-discovered skill selection; reset on runtime replacement |
| `workflow/Infra/` | Filesystem and Pi adapters | New, proposed | Resolve paths, read prompts/configuration, write safely, publish command output and native resources |
| Agent/project configuration | `workflow.json`, prompts, skill directories | New / moved, proposed | Durable user-owned settings and instruction content outside extension source |
| Pi | Native resource loader and structured prompt builder | Reused | Advertise skills, expand `/skill:name`, load skill bodies on demand, track prompt changes |
| Existing personal guidance | Mock/analyst/design skills, developer gates, memory preferences | Changed only after separate migration approval | Remove duplicate mandates while retaining non-workflow guidance |

No custom UI, Middleware layer, filesystem watcher, or shared utility package is needed. Configuration is authoritative on disk; only discovery bookkeeping lives in memory. Domain has no filesystem or SDK dependencies. Tests mirror these layers under `workflow/tests/`, with integration drivers in a separate `Integration/Support/` directory, following the existing [test runner](../../scripts/test.cjs).

## Runtime flow
1. At `resources_discover`, the controller reads global configuration from `getAgentDir()` and, only when `ctx.isProjectTrusted()` is true, `.pi/workflow.json` directly beneath `ctx.cwd`. No Git or ancestor lookup occurs.
2. The resolver merges built-in defaults → global fields → explicit project fields, resolving each path relative to its declaring configuration file. The filesystem adapter validates enabled resources. The controller returns unique absolute `SKILL.md` paths through `skillPaths` and records the submitted selection. Pi performs native parsing, advertises descriptions, and retains its own diagnostics; submitted does not mean successfully loaded.
3. At `before_agent_start`, the controller rereads configuration and enabled prompt files, composes them in mock → plan → design → commit order, and assigns only `event.systemPromptOptions.sections.workflow`. With no prompt contributions, it deletes that key. It does not replace the full system prompt or mutate Pi's skills list.
4. `/workflow on|off <step> [--global]` acquires the destination configuration lock, rereads and validates the file, changes only `enabled`, writes atomically, and reports the persisted scope. Default scope is project. `/workflow reset <step>` removes that project's entire step override, restoring inheritance. JSON edits manage prompt and skill associations initially.
5. Status compares current desired skill paths with the runtime's last-discovered selection. A changed selection requires `/reload`; no reload is performed automatically. Prompts update on the next run, but previously advertised/read skills may remain until reload or in conversation history afterward. Recommend a fresh session for a clean context.

On invalid configuration or unreadable enabled resources, report the exact path and do not silently fall back to defaults or last-good instructions. Discovery contributes no workflow skills on failure. Before-agent failures replace the workflow section with an explicit unavailability diagnostic, not partial workflow instructions; Pi may continue the run. Commands reject invalid writes. This is instruction management, not an execution barrier.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| `workflow.json` → resolver | No schema → JSON object with `version: 1`, optional `steps`, and four known step keys | New schema; invalid versions/types rejected |
| Step configuration → resolver | No bundle → optional `enabled` boolean, `prompt` path or null, `skills` array of `SKILL.md` paths | Omitted fields inherit; false disables, null removes a prompt, `[]` removes skills; arrays replace, never concatenate |
| Extension → Pi discovery | No workflow contribution → deduplicated absolute `skillPaths` | Additive native discovery; disabling cannot suppress copies registered independently elsewhere |
| Extension → Pi prompt builder | No workflow section → replaceable `sections.workflow` string | Other sections/tools/skills untouched; no raw system-prompt fallback |
| `/workflow` → user | No command → status, `preview`, `on`, `off`, `reset` | TUI/RPC use normal notification/message output, not custom terminal components; headless runs still inject/discover normally |

- Built-in defaults enable all four steps and reference `<agent-dir>/workflow/prompts/<step>.md`. Default skill selections are `<agent-dir>/workflow/skills/mockup-first/SKILL.md`, `roles/analyst/SKILL.md`, and `roles/design-writing/SKILL.md` for mock, plan, and design respectively; commit selects none. These are proposed installed assets, not files already present. Explicit setup must provision them before normal use; startup never creates or moves personal files.
- Project paths live under `<cwd>/.pi/`; its optional content convention is `workflow/prompts/` and `workflow/skills/`. Absolute paths are accepted; relative paths are resolved once at their source, so inheriting a global path never rebases it to the project. No environment/shell interpolation.
- Status shows field-level provenance, resolved resource paths, configured versus last-discovered skill selections, and diagnostics. Preview prints the exact proposed workflow-section content, not all Pi instructions or lazy skill bodies. Unsupported versions and invalid known fields are errors; unrelated JSON properties are preserved by writes.
- Writes use an exclusive adjacent lock directory, a same-directory temporary file and atomic rename; always release owned locks. Recheck the source bytes before replacing to detect intervening manual edits. Contention or stale locks produce actionable errors; never steal a lock automatically. Project reads and writes are refused when untrusted; global scope remains usable.

## Decisions & Trade-offs
- Use native discovery rather than injecting skill bodies or building a skill loader. The shipped [dynamic-resources example](../../../git/pi-chat/node_modules/@earendil-works/pi-coding-agent/examples/extensions/dynamic-resources/index.ts) demonstrates `skillPaths`. Inspected loader code rebuilds base resources on reload before adding extension paths, allowing previously contributed skills to disappear. Deduplicate canonical paths shared by enabled steps; native name-collision diagnostics remain visible.
- Managed skills live outside scanned directories. Move whole directories/subtrees to preserve assets and links; repair links crossing into the still-discovered developer skill. Remove unconditional plan/design gates from that skill and workflow mandates from memory/client guidance only with an approved, backed-up source checklist. Do not create symlinks or duplicate skills in scanned locations. Disabling is not a filesystem access restriction or a ban on explicit user requests.
- Target structured-prompt-capable Pi, with compatibility acceptance against the inspected SDK 1.0.2 and installed CLI 1.4.0. The repository's [SDK dependency](../../package.json) is 0.85.1: discovery/trust APIs exist, but structured `sections` do not. Use a narrow local structural capability adapter so existing extensions need no repository-wide dependency upgrade; report unsupported runtime clearly instead of replacing the full prompt. Another extension forcing an opaque full prompt can supersede structured sections and is outside this extension's control.
- Keep commands intentionally small. Association editing stays in JSON/Markdown; no interactive prompt manager, model-callable toggle tool, approval tracker, automatic commits, or automatic reload. A later UI can consume the same resolved status without changing persistence.

## Verification
- Domain: all-on defaults, explicit false, partial field inheritance and provenance, null/empty resource selections, list replacement, stable composition, and command validation.
- Infra: source-relative paths, canonical deduplication, disabled missing resources, unreadable enabled resources, invalid JSON/version, unknown-property preservation, atomic writes, lock contention, and intervening-edit detection in temporary directories.
- Driven Pi integration: startup advertisement, native skill diagnostics, lazy bodies and `/skill:name`, reload addition/removal, shared skills, live prompt edits, all-off section removal, repeated runs without duplication, unrelated-section preservation, untrusted project files never read, and clear configured/discovered mismatch. Verify error handlers do not leave last-good workflow content silently active.
- Run focused tests, typecheck, and full repository tests. Extend the existing [layout driver](../../scripts/tests/Support/layout-driver.cjs) and test inventory for the new module. Exercise native loading with SDK 1.0.2 and CLI 1.4.0, plus a negative unsupported-runtime case; never modify installed dependencies.
- Separately approve and back up personal migration, then verify fresh-session all-off and individual-step cases, preserved relative references, and no duplicate skill discovery. Read-only API/source inspection is complete; these behavioral checks have not yet run.

## Open Questions
None.
