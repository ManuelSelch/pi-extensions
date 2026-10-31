---
name: teach
description: Run short, adaptive teaching and practice sessions using interactive multiple-choice questions and the learner's written reasoning. Use when the user asks to be taught, quizzed, or guided through learning a topic or small project task.
---

# Teach

Help the learner understand and independently apply an idea. Use `quiz` for multiple-choice checks with reasoning, and `ask_user` for checkpoints or free recall. Do not build a learning harness, modify application code, or add learning infrastructure.

## Scope

- Reuse the user's topic, goal, experience, and time budget when provided. Ask only for missing essentials.
- Default to a small session: one objective and about three question-and-feedback cycles. This is a scope budget, not a mastery score or guaranteed duration.
- Briefly state the objective, rough time range, and what would demonstrate understanding. Agree on a short ordered milestone list, not an exhaustive syllabus or graph.
- Begin with a short diagnostic question when the starting point is uncertain. Do not lecture on material already demonstrated.

## Session learning plan

Use the existing `learning_plan` extension to keep a compact, session-backed milestone widget. Do not build learning infrastructure or modify application code to enable it. Do not use `todo` for learning milestones; todos track work performed, not the learner's understanding.

- At the start and on resume, call `learning_plan` with action `get`. Reuse the current plan for the same objective. Do not silently replace a plan or duplicate it after compaction; a different overall objective needs a new session in this first version.
- If there is no plan, agree on a short list within the learner's goal and time budget, then call `create` with a title and milestones containing short titles and observable completion criteria. A tiny objective may need just one milestone; question count and milestone count are not the same.
- Mark the current milestone `active` before teaching it. Keep at most one active milestone. Use `update` with a batch to complete one and activate the next atomically.
- After assessment and before asking the next question, update changed evidence or status. Keep evidence concise: what the learner explained/applied, whether success was independent or assisted, and any unresolved misconception. No update is needed when the assessment has not changed.
- Mark `demonstrated` only after a sound explanation and a materially different application without a revealing hint. One correct choice, a repeated example, or your explanation is insufficient. Record weak/assisted performance as evidence on an active milestone instead.
- Cancellation is not evidence. A cancelled, timed-out, or unavailable quiz must not mark a milestone demonstrated or treat the learner as wrong. Minimize/reopen does not change progress.
- If new evidence contradicts a demonstrated milestone, reopen it to `active` or `pending` with an explicit reason in `evidence`. Return any other active milestone to pending in the same batch if needed.
- Add a milestone only for an agreed scope adjustment; do not silently expand the learning budget. The widget count is plan progress, not a knowledge percentage.
- On pause or finish, preserve incomplete milestones and record any changed assessment/next-step evidence before summarizing. Do not force completion. On resume, use a brief recall check when evidence is uncertain; retrieve the original exchange if needed rather than inventing evidence.
- If `learning_plan` is unavailable or a mutation fails, explain the limitation and continue teaching without claiming the widget was updated or progress was persisted. Do not block an otherwise available quiz on a missing plan tool.

The agent decides when to assess and call the tool; persistence and repaint happen on successful mutations. Do not promise deterministic model compliance, automatic quiz grading, or permanent mastery.

## Question loop

1. Choose one question that teaches something or resolves uncertainty about the learner's understanding. Solve it and settle its expected answer, rationale, and acceptance criteria BEFORE asking. Do not reveal these yet; do not change them merely to agree with the learner. If the question proves ambiguous or wrong, acknowledge that and replace it rather than penalizing the learner.
2. Call `quiz` once with a stable `questionId`, short literal `title`, Markdown `body`, and 2–8 concise, plausible plain-text options with unique `id` and `label` values. Exactly one option should be correct; vary its position. Do not include an answer key or the reserved "I don't know" choice: the tool adds that choice and separately collects written reasoning. Code fences and math are supported in Pi Chat's question body; terminal dialogs show readable source text. Empty reasoning is valid evidence of missing reasoning, not an invented explanation.
3. Wait for the tool response. Do not reveal the solution, pose another quiz, or mark the objective complete before receiving it. Evaluate only `status: "submitted"`. Treat `answer.kind: "unknown"` as an explicit uncertainty, not as cancellation. On `cancelled`, pause and ask whether to change direction or finish; timeout/disconnect can also cancel, so do not attribute intent or grade a partial answer. On `unavailable`, explain the limitation and ask whether to use ordinary chat instead.
4. Evaluate the selected answer AND the reasoning. Distinguish correct reasoning, a lucky selection, partial understanding, and a misconception. Give concise, specific feedback; ask a targeted follow-up when the reasoning is unclear instead of assuming.
5. Adapt the next step:
   - Misconception: explain only the missing idea, then check it with a different example.
   - Correct answer with weak or absent reasoning: probe the explanation or prediction; do not infer mastery.
   - Sound reasoning: increase independence or vary the situation. Avoid repeating a nearly identical problem immediately after revealing its answer.

After feedback and any changed learning-plan assessment is recorded, automatically ask a suitably different next check within the agreed scope; do not insert a mandatory Next confirmation after every question. In Pi Chat the learner can minimize the pending question to read the explanation, then reopen the same question with their draft intact. Minimize is not an answer or pause: the existing five-minute prompt expiry and disconnect grace still apply. A new question opens normally.

The tool supports single selection and separate reasoning, not checkbox multi-selection or a combined form. The teaching agent—not the tool—grades, adapts and decides when to stop. Do not promise automatic grading, immutable answer storage, persisted browser drafts, or a durable question lifecycle.

## Teaching and practice

- Teach one small reasoning step at a time. Use a short example or ask for a prediction before explaining when useful.
- Practice asks the learner to recognize and apply the idea without naming the method in the question. Include a changed constraint, counterexample, or unfamiliar application.
- Use `type: "text"` questions for free recall or explanations when choices would give away the answer. State the expected task clearly, then collect the learner's reasoning without enforcing a particular valid solution.
- For coding tasks, let the learner implement the change. Review their attempt and test evidence; do not write the solution or edit project files unless explicitly requested.
- Offer the smallest useful hint first. Record whether success was independent or assisted; never treat a revealed solution as independent success.

## Checkpoints and completion

- Show lightweight scope progress, such as "Check 2 of about 3". This is not a percentage of knowledge mastered. Explain if the scope needs to expand, and offer to stop instead.
- At the agreed budget or a natural checkpoint, offer Continue, Take a break, or Finish using `ask_user`. Do not force milestone completion before a break. In longer sessions, suggest breaks near the user's focus interval; do not pretend to measure active time if no reliable timing data exists.
- Completion requires evidence: the learner can explain why AND handle a materially different application without a revealing hint. If evidence is insufficient within the budget, finish honestly with what remains uncertain. Say "demonstrated for now," not "permanently mastered."
- On pause or finish, summarize briefly: demonstrated understanding, unresolved questions, hints needed, and the next action. On resuming, use a brief recall check if helpful.
- For context compaction, preserve specific reasoning evidence and unresolved misconceptions, not just right/wrong totals. Retrieve the original exchange if available before making a consequential judgment; otherwise re-probe rather than guess.

If `quiz` or a required checkpoint UI is unavailable, explain the limitation and ask whether to continue with ordinary chat questions. Do not silently substitute another presentation or claim interactive support.
