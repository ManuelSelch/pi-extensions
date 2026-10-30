# Pipeline Widget — Requirements

## Goal
Make local test outcomes and freshness visible in Pi, so tests are not forgotten while working across small projects.

## Scope
### In Scope
- A global Pi extension with versionless per-project `.pi/pipeline.yaml` configuration; no JSON fallback.
- Named suites such as unit, integration and e2e; manual execution and persistent results.
- Agent tools to configure, run and inspect pipelines.
- Compact widget and optional automatic execution while Pi is open.

### Out of Scope
- Remote GitHub/GitLab CI status, always-on scheduling and test-framework installation.
- Inferring successful pipeline runs from arbitrary terminal commands.

## Requirements
- Hide the widget completely when no pipeline config exists; no setup reminder.
- Display configured suites with last-run age, outcome and freshness. Distinguish never run, running, passed, failed, cancelled and timed out; a previous pass on changed code must not appear current.
- Show test status only: no approval-required text in the widget. Automatic-run progress and outcomes only refresh the widget; do not notify or send messages to the agent.
- Any project source change marks all suite results stale in the first version; no per-suite input paths. Exclude generated results/logs and other non-source artifacts from source-change detection.
- Configuration defines executable/arguments, optional project-relative working directory, timeout and automatic-run mode per suite; results never expire solely with age. Commands run once, not in watch mode.
- `pipeline_configure` proposes suite additions, updates and removals, validates them and requests approval using Pi's native confirmation popup before writing. Show compact name/command/timeout rows for creation and execution approval; focused, normalized field-level `-`/`+` diffs for updates, grouped by suite/preparation, plus shared-suite execution-order changes. Ignore formatting/default-expansion noise; unchanged proposals say so. Use distinct changes/execution titles, a short project/scope header, and no root-cwd or automation footer sentences. Non-root cwd remains visible; cwd/automation changes appear in diffs. Rejection changes nothing; saving does not run tests.
- Approval is local and tied to the exact project/configuration, not committed with configuration. If configuration changes during review, request fresh approval. External execution-affecting changes require confirmation before execution; automatic runs remain paused until approved, without repeatedly opening popups.
- Without an interactive approval channel, refuse configuration changes or unapproved execution and return a clear tool error.
- `pipeline_run` and `pipeline_status`, plus `/pipeline` actions for run, details/logs and cancellation, use the same runner and state.
- Keep Pi responsive during execution, capture bounded output plus full logs, enforce timeouts and stop child processes on cancellation/shutdown/reload.
- Persist results separately from configuration, isolated per project/worktree. Record timestamps, duration, exit status and tested source/configuration fingerprints, including uncommitted changes. Changes during a run make its result stale.
- Serialize runs by default and prevent duplicate execution across Pi sessions in the same worktree.
- Optional automation runs approved cheap suites after the agent settles and edits have stopped, with cooldown and unchanged-code skipping. Integration/e2e remain manual unless explicitly enabled. Automation operates only while Pi is open.
- Verify configuration/approval, runner outcomes, freshness, widget visibility and scheduler lifecycle with focused tests, repository typecheck and Pi smoke tests.

## Assumptions
- Implement as a local TypeScript Pi extension in this repository; no build step.
- Prefer executable/argument arrays over shell strings; complex workflows can use project scripts.
- Default to manual execution and introduce automation only after the manual workflow is verified.

## Implementation Plan
### 1. Configuration and approval
Description: Define and validate versionless `.pi/pipeline.yaml`; implement `pipeline_configure` and local approval tracking with the native confirmation popup. Verify acceptance, rejection, external changes and concurrent edits without executing tests.

### 2. Manual runner and results
Description: Add `pipeline_run`, `pipeline_status` and `/pipeline` run/log/cancel actions using approved configuration. Persist worktree-isolated outcomes/logs and source fingerprints, with locking, timeouts and process cleanup. Verify passing, failing, cancelled, timed-out and duplicate runs using fixture commands.

### 3. Compact status widget
Description: Render suite outcomes, ages and freshness beside the existing git widget. Hide it when config is absent; never display approval state. Verify any source change makes all suites stale, changes during runs, session restart and narrow terminal widths.

### 4. Optional automatic runs
Description: After slices 1–3, add opt-in after-agent scheduling with cooldown, change detection and lifecycle cleanup. Verify unchanged code is skipped, unapproved commands never execute, automatic outcomes only refresh the widget without agent notifications, sessions do not duplicate runs and shutdown/reload leaves no timers or processes.

## Open Questions
None.
