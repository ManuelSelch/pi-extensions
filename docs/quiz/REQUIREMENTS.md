# Quiz extension — Requirements

## Goal
Provide a small, dedicated question-and-reasoning interaction for the existing teach skill. Replace its generic two-question ask_user sequence without building a learning platform. The extension collects evidence; the agent remains the teacher.

## Requirements
- **R1** — Add an agent-callable `quiz` tool through a native `quiz/index.ts` extension in this repository. Each call handles exactly one question and waits for submission or cancellation; it does not generate or launch subsequent questions automatically.
- **R2** — Support single-choice questions with stable option identifiers and one selected answer. Include a distinct “I don't know” response that is not cancellation. Reject empty prompts, empty or duplicate option labels/identifiers, and otherwise malformed questions before opening UI. The agent must prepare exactly one correct option and vary its position; the tool cannot establish semantic correctness.
- **R3** — Collect optional multiline reasoning alongside the answer using the prompt “Explain how you reached your answer. What assumptions or uncertainties do you have?” Preserve the learner's submitted text; an empty explanation remains empty and is never synthesized.
- **R4** — Return a structured result identifying the question, displayed options, selected option or “I don't know”, reasoning, and explicit submitted/cancelled status. Cancelled drafts must not be represented as submitted evidence. Cancellation, unavailable UI, and invalid input must remain distinguishable.
- **R5** — Do not reveal a solution or correctness indicator in the question interaction. The teach skill must settle its expected answer, rationale, and acceptance criteria before asking, wait for the result, then evaluate answer and reasoning together. This is an instruction-level commitment, not secret or tamper-proof answer storage.
- **R6** — Keep teaching policy in the teach skill: default to one objective and about three cycles; distinguish sound reasoning, lucky selections, partial understanding, and misconceptions; adapt examples and hints; require explanation and a materially different application before claiming understanding. Cancellation is never graded as wrong, and revealed solutions are not independent success.
- **R7** — Make supported interaction modes explicit. Never silently substitute ordinary chat, claim a combined form when using separate dialogs, or interpret missing/unsupported UI as learner cancellation. Final TUI/RPC scope and form behavior are governed by Q1 and Q2.
- **R8** — Keep submitted evidence in ordinary Pi tool results and their structured details. Do not add a database, cross-session learner profile, scores, mastery percentages, question bank, timers, background processes, or durable pending-question lifecycle. A reload or process exit need not resume an unfinished interaction; do not promise otherwise.
- **R9** — Update the existing teach skill to use `quiz` for supported single-choice checks and accurately describe its limitations. Retain generic ask_user interactions for session setup, Continue/Take a break/Finish checkpoints, and free-recall questions. If quiz is unavailable, disclose this and ask whether to use the existing ask_user sequence; do not fall back silently. Do not modify ask-user itself.
- **R10** — Verify question validation, answer/option identity, empty and multiline reasoning, “I don't know”, cancellation, unavailable UI, abort cleanup, and absence of solution disclosure. Include native extension registration and a manual interaction check for each supported mode. Terminal-specific UI must additionally be checked with keyboard-only navigation, narrow widths, resizing, Unicode, and focus restoration.

## Assumptions
- The existing teach skill at `~/.pi/agent/skills/teach/SKILL.md` is the behavioral source of truth. Its current prohibition on building learning infrastructure concerns ordinary teaching sessions; this explicit extension-planning request authorizes planning a narrowly scoped replacement interaction, not implementing it yet.
- Recommended first version: a combined terminal form containing the question, choices, optional reasoning, and explicit Submit/Cancel actions. Draft answers remain editable until submission. This recommendation is unconfirmed; see Q1.
- Single-choice checks are sufficient for the first version. Free recall continues through ask_user; multi-select, automatic grading, slash commands, and hint buttons are outside the MVP.
- The agent does not pass an answer key to the collection tool. It retains the prepared solution in its own reasoning/context; no secrecy, immutable rubric, or secure examination guarantee is implied.
- Existing repository folder, test inventory, and shared dependency conventions apply. Installed Pi and repository SDK versions must be checked rather than assumed identical.

## Implementation Plan
### S1 — Confirm interaction and approve design
Description: Resolve Q1 and Q2, specify the smallest tool input/result contract and cancellation behavior for R1–R5 and R7–R8, and write the proportional DESIGN.md beside this file. Review an isolated interaction mockup before production UI work and obtain explicit design/interaction approval. Completion is a reviewed contract and approved interaction with no unsupported mode promises; this planning request alone does not authorize implementation.

### S2 — Implement the question collection tool
Description: After S1 approval, add the extension and narrowly scoped module-local tests implementing R1–R5, R7–R8, and R10. Keep grading and teaching policy out of the extension. Verify validation and result semantics automatically, native registration against the actual Pi runtime, and the supported UI interactions manually. Register intentional new tests in the repository test inventory; do not alter unrelated extensions or add compatibility shims.

### S3 — Integrate the teach skill
Description: After S2, update the existing teach skill and repository extension documentation for R6 and R9. Remove obsolete claims that only generic two-dialog collection exists, without overstating quiz capabilities. Verify a short teaching session covers an explained answer, absent reasoning, “I don't know”, targeted follow-up, cancellation, and a checkpoint; confirm feedback occurs only after submission. Document tool availability and supported mode behavior. The skill resides outside this repository, so review and report its changes separately rather than implying the extension repository commit contains it.

## Open Questions
- **Q1** — Should the MVP use a combined answer-and-reasoning form with explicit submission (recommended), or keep separate choice and reasoning dialogs behind the dedicated tool?
- **Q2** — Is terminal-only support sufficient for the MVP, or must RPC clients also work? Combined custom TUI is not supported by Pi's standard RPC dialog protocol; RPC would need an explicitly accepted separate-dialog interaction or separately scoped client/protocol work.
