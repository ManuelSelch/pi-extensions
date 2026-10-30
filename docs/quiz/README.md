# Quiz

`quiz` collects one multiple-choice answer and written reasoning in separate native select/editor dialogs. The teaching agent prepares the solution privately, evaluates the response and chooses the next check. The tool neither grades nor loops.

```json
{
  "questionId": "powers-1",
  "title": "Powers of two",
  "body": "What is `2 ** 3`?\n\n$$2^3$$",
  "options": [
    { "id": "a", "label": "6" },
    { "id": "b", "label": "8" }
  ]
}
```

- Provide 2–8 unique plain-text choices. The tool adds **I don't know**; its label and ID `__unknown__` are reserved.
- Question Markdown supports code and math in Pi Chat. Native terminal dialogs include the readable source body in the title. No custom terminal/browser component is loaded.
- Results contain `status: submitted`, the original question/options, `answer: {kind: option, optionId, label}` or `{kind: unknown}`, and verbatim `reasoning`, including an empty string. Content and structured details contain the same evidence.
- Cancellation at either dialog reports `cancelled` with `stage`, not a partial answer. Expiry/disconnect can also cancel; do not infer learner intent. Missing interactive UI or an unsupported hosted context reports `unavailable`.
- Pi Chat's Minimize/Reopen preserves selection and text locally through tab switches and transient reconnects. It sends no response. Refresh does not preserve drafts; the server's five-minute expiry and 60-second disconnect grace are unchanged.
- A pending question disables message submission, not transcript reading/navigation or explicit Stop. Escape while minimized does not cancel or abort it.

## Local adoption

The extensions package, server and Chat consume coordinated local SDK/server snapshots because publication and live rollout were not requested. Run `npm ci` in this repository to install the helper dependency; reload/restart Pi separately when ready. Hosted prompts require the updated server and browser assets—an old host does not silently fall back.

The native `teach` skill at `~/.pi/agent/skills/teach/SKILL.md` sequences adaptive checks and offers Continue / Take a break / Finish at natural checkpoints. That file is outside this repository's Git ownership.

See [requirements](REQUIREMENTS.md), [approved design](DESIGN.md), and [verification](IMPLEMENTATION.md).
