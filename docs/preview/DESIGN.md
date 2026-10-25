# Preview OSC 8 Links — Design

## Overview
Replace the preview widget's Markdown link with an OSC 8 hyperlink. The confirmed cause is that previewWidgetLines emits Markdown into a plain terminal widget.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| preview | [previewWidgetLines](../../preview/index.ts) | Changed | Produce a sanitized name enclosed in an OSC 8 hyperlink |
| preview | paint | Reused | Publish widget lines; preserve visibility and placement |

No new state or dependencies.

## Runtime flow
1. Preview startup/restoration calls paint with the current preview.
2. previewWidgetLines emits an OSC 8 open sequence, preview name and explicit closing sequence for active previews.
3. Stopped/failed previews remain hidden. Missing or unsafe URLs fall back to a plain name.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| previewWidgetLines → setWidget | Markdown link → OSC 8 link | Same string-array shape; terminal escape content replaces Markdown syntax |

Tool results, persisted configuration, lifecycle and commands remain unchanged.

## Decisions & Trade-offs
- Keep names literal, without Markdown escaping; normalize newlines to spaces and remove terminal controls.
- Allow HTTP/HTTPS destinations only, rejecting control characters and credentials before emitting OSC 8. Unsafe destinations render a plain name.
- Reuse the existing widget publication path; no separate Markdown renderer or new dependency.

## Verification
- Update Markdown assertions to OSC 8 assertions, including restored sessions and real-server integration.
- Cover literal brackets/backslashes, terminal-control sanitization, unsafe URLs, visible text and explicit link closure.
- Run preview tests, repository tests and typecheck.

## Open Questions
None.
