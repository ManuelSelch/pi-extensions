# Calendar Tool Extension — Requirements

## Goal
Provide a small Pi extension for reading and managing calendar entries through the installed `khal` and `vdirsyncer` CLIs, with synchronization handled automatically and user confirmation before any create or edit is applied.

## Scope
### In Scope
- A Pi tool for listing calendar entries.
- A Pi tool for reading an individual entry.
- Creating and editing entries, with a Pi TUI confirmation prompt showing a concise summary of the proposed operation before it is applied.
- Automatic synchronization with `vdirsyncer` as part of calendar operations.
- Clear reporting of command errors and synchronization failures.

### Out of Scope
- Deleting calendar entries.
- Applying create or edit operations without explicit user confirmation.
- Replacing or modifying the user's khal/vdirsyncer configuration.

## Requirements
- The extension must use the installed `khal` and `vdirsyncer` command-line tools rather than implementing calendar protocol handling itself.
- Listing and reading entries must synchronize all configured vdirsyncer collections before returning calendar data; no collection selector is required in the initial version.
- Creating and editing entries must synchronize before preparing the change, show the user a summary in a Pi TUI confirmation prompt, then apply and synchronize the change only if confirmed.
- A cancelled or unavailable confirmation prompt must leave the calendar unchanged.
- The extension must not expose a delete operation or permit delete through its tool interface.
- The list operation must use a simple default window of today through the next 7 days and return concise, structured event details suitable for Pi agent use, including each event's khal event identifier.
- The list operation must expose khal's `uid` as the event identifier. The read tool must accept that UID plus the listed event date range and return only an exact UID match.
- Tool input must be validated and passed to child processes without shell interpolation.
- Command failures, invalid input, unavailable executables, and sync failures must be reported clearly; a failed pre-operation sync must prevent subsequent reads or writes.
- The extension must follow this repository's TypeScript/no-build conventions and be discoverable as a Pi extension.

## Assumptions
- The extension is a local extension in the existing Pi extensions repository.
- The user has installed and configured `khal` and `vdirsyncer` and has a working vdirsyncer collection/account setup.
- Pi's interactive TUI is the supported context for modifying operations because they require confirmation.
- `khal list --json uid` exposes event UIDs in the installed khal 0.14.1. However, the installed `khal edit` accepts only an interactive search string and has no UID option, so direct UID-based editing is not available through that CLI command. A safe, non-interactive way to resolve and modify an event by UID must be selected before implementing edit; do not invoke interactive edit or risk matching the wrong event.
- Sync means running the appropriate vdirsyncer sync operation; exact collection selection and CLI arguments depend on the user's configuration.

## Implementation Plan
### 1. Verify CLI and confirmation contracts
Description: Inspect the installed khal and vdirsyncer versions/help and existing Pi TUI confirmation APIs. The installed tools are khal 0.14.1 and vdirsyncer 0.21.0; `vdirsyncer sync` with no arguments syncs all configured pairs, and `khal list --json uid` exposes event UIDs. The installed `khal edit` is interactive and search-based, with no UID selector, so determine a safe UID-targeted edit strategy before implementing modification. Verify assumptions with CLI help and safe read-only checks.

### 2. Implement synchronized read tools
Description: Add the extension's tool registration and safe process wrapper, then implement list and individual-entry read flows with pre-read sync, validation, and clear errors. Verify command construction and behavior with focused tests or mocked subprocesses.

### 3. Implement confirmed create and edit
Description: Add create/edit inputs and a user-visible summary confirmation. Apply changes only after affirmative confirmation, then sync; reject cancellation and non-interactive use without modifying the calendar. Verify both accepted and cancelled paths and ensure no delete interface exists.

### 4. Validate and document the extension
Description: Document setup, supported operation schemas, sync behavior, and CLI prerequisites. Run typecheck, focused tests, and Pi extension load smoke test; verify no delete operation is registered.

## Open Questions
1. What safe, non-interactive approach should edit a specific event by UID? The installed `khal edit` is interactive and search-based, so it cannot reliably satisfy UID-targeted edits as-is.
