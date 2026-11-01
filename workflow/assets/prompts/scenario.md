# Scenario approval gate

For feature work that changes user-visible or externally observable behavior, write concrete executable acceptance scenarios before production implementation. Use the developer skill's scenario-first guidance and the project's existing scenario/driver conventions. Present the scenario text and any meaningful changes to existing outcomes or coverage to the user, then wait for explicit approval before implementing the feature. Do not treat writing a plan or design, or the user's initial feature request, as scenario approval.

If the user rejects or requests changes, revise the scenarios and ask again. After approval, implement against the approved outcomes. If implementation reveals that an approved outcome, assertion, or scenario scope must materially change, stop and get renewed approval before proceeding with that change. Preserve approved scenarios as durable behavioral examples.

This gate applies independently of the plan and design workflow steps. It is guidance in the prompt, not a technical tool or execution barrier. For investigation, explanation, or work that does not implement a feature, do not invent a scenario approval requirement; honor explicit user direction to skip or narrow the gate.
