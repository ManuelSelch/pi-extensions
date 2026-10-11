# Open Commands Extension — Requirements

## Goal
Provide configurable Pi commands that open the current working directory (cwd) in user-selected applications such as a terminal or VS Code.

## Scope
### In Scope
- A Pi extension that registers one `/open` command for all configured apps.
- Configuration of executable and argument templates, with cwd available as a substitution.
- Documented presets/examples for commonly used applications.

### Out of Scope
- Installing or locating applications automatically.
- Arbitrary shell command evaluation, GUI configuration, or opening individual files.

## Requirements
- Register one `/open` slash command with a required opener argument and argument completion for configured opener names.
- The example configuration includes `finder`, `terminal`, and `code`; users can add/remove any app by editing the JSON.
- Invoking `/open <name>` launches its configured executable with arguments and the current Pi cwd as the working directory and/or substituted argument, according to configuration.
- Arguments are passed as an argv array (not interpolated into a shell command), preventing shell interpretation of paths.
- Missing/invalid configuration, executable launch failures, and nonzero exit errors are reported clearly to the user.
- The command always opens the current Pi cwd; no path override is accepted.
- `~/.pi/agent/pi-open.json` is the source of truth for the supported app list; the extension must not hardcode app names or presets.
- Each configured app entry defines its command name, executable, and argument template. `/open` argument completion is derived from this list.
- The extension file is named `pi-open.ts` and registers `/open`.
- Document example JSON entries for Finder, Apple Terminal, and VS Code (`code`), including platform/executable prerequisites.
- Follow the repository's TypeScript/no-build conventions and pass its typecheck and Pi extension smoke test.

## Assumptions
- This is a local user extension in the existing extensions repository.
- Openers are launched detached so Pi remains interactive.
- The configuration file is named `pi-open.json`; the extension is `pi-open.ts`. Supported apps and their definitions come solely from JSON.

## Implementation Plan
### 1. Define JSON configuration and opener behavior
Description: Specify `~/.pi/agent/pi-open.json` as the sole source of supported app names and definitions, with executable, argv, cwd handling, and process lifecycle/error behavior. Include example entries for Finder, Apple Terminal, and VS Code. Verify the contract preserves paths containing spaces.

### 2. Implement `/open` with argument completion
Description: Load the JSON configuration without hardcoded app names, register a single `/open` command with completion derived from configured app names, and safely spawn executable plus argv without a shell, always targeting the current Pi cwd. Verify selection/completion, cwd, and argument boundaries with focused tests or mocked spawn.

### 3. Document presets and validate integration
Description: Document example configurations for Finder, Apple Terminal, and VS Code, including platform/executable prerequisites and customization. Run repository typecheck and the Pi extension smoke test; verify command registration and user-facing failures.

## Open Questions
None.
