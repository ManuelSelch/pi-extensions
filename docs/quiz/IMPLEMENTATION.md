# Quiz — implementation and verification

The approved design is implemented locally. No packages were published, project commits pushed, or live services restarted.

## Delivery

- `quiz/index.ts` registers the sequential `quiz` tool. It collects exactly one standard select followed by one standard editor, using public SDK presentation helpers. It adds the unknown choice, validates unique identities/labels, preserves verbatim/empty reasoning, and returns submitted/cancelled/unavailable results. No answer key, grading loop or custom UI component is introduced.
- `~/.pi/agent/skills/teach/SKILL.md` now uses `quiz` for evidence, evaluates reasoning, automatically sequences adaptive checks, and keeps explicit pause/finish checkpoints. That native skill is outside any Git repository; it was updated in place, not included in the extensions commit.
- Pi Chat supports explicit Markdown/code/math prompt content, explicit select submission, minimize/reopen with browser-local drafts, connection/ownership guards and duplicate-answer prevention. Reading/navigation and explicit Stop remain available while message submission waits. Drafts are not persisted across refresh.
- Server metadata is isolated with AsyncLocalStorage around existing dialogs. Stop also reaches pending command dialogs outside the agent loop. Existing five-minute prompt timeout and 60-second disconnect grace remain unchanged.
- Swift imports the matching authoritative schemas/fixtures and tests its own decoder and real-server compatibility. Its conversation API still does not support interactive structured questions.

## Package adoption

| Repository | Local commit(s) |
|---|---|
| TypeScript SDK | `5b747dd` |
| pi-server | `05c3fdd`, packed-consumer fix `c9749eb`, pending-dialog Stop fix `df9dd1b` |
| Pi Chat | `9d6601b` |
| Swift SDK | `5759241` |

Extensions and Chat pin the SDK archive `vendor/pi-sdk-0.1.1-prompts-5b747dd.tgz`. Chat and Swift integration pin server `pi-server-0.1.2-prompts-df9dd1b.tgz`. Package lockfiles retain integrity. The server bundles the matching SDK; its source receipt/lock pin actual bytes, and its dependency version remains valid in installed consumers. These coordinated snapshots are not a compatibility shim for older hosts.

## Verification

- Extensions: typecheck; **315 tests pass**, including eight quiz cases and normal native discovery/registration. Discovery also passed against Chat's installed Pi version. Native dialog behavior uses real SDK helpers with test UI methods; visible terminal key-by-key interaction was not automated.
- TypeScript SDK: typecheck and **225 tests pass** at the helper/contract commit; regenerated protocol artifacts and package exports.
- Server final source: **457 tests / 64 files pass**, **17 compiled package tests pass**, and the same **17 installed-consumer scenarios pass** with compiled public types/exports and matching SDK byte checks. Real Pi runner presentation integration is included.
- Chat final serial verification: typecheck/build; **844 unit/DOM tests / 101 files pass**; **51 Chromium tests pass, one existing skip**. New desktop/390px scenarios exercise explicit choice, code/math safety, minimize/reopen, retained selection/reasoning, tab switching, reading feedback during the next check, empty reasoning, literal menus and Stop. Isolated production lifecycle smoke passes.
- Swift: imported artifact drift check; **34 Swift Testing tests plus six XCTest probe tests pass**; four integration-runner prerequisite tests pass; two URLSession/server integration scenarios pass against the final local server snapshot.
- Dependency validation (`npm ls`) passes for the coordinated server/SDK packages. No npm audit upgrades were made. Existing advisories remain (Chat 18, server 5, extensions 3, Swift integration 3).
- One existing lazy Markdown DOM wait failed during concurrent cross-repository checks; the complete Chat suite passed on serial rerun without changing the unrelated test.

## Activation boundary

Source implementation is complete, but the current running agent/server does not automatically adopt it. Install the committed dependencies in fresh checkouts, then reload/restart the relevant native Pi and deploy matching server/browser assets when desired. No live rollout was performed. Real-model adaptive teaching quality and full Swift UI parity are not claimed.

See [usage](README.md) and Chat's `docs/quiz-prompts/IMPLEMENTATION.md` for runtime behavior and browser evidence.
