# Pipeline Headings — Design

## Proposed Design
- Update the existing pure renderer in `pipeline/widget.ts`; keep data fetching and status ownership unchanged.
- Replace accent-colored `## Local` and `## GitHub` headings with muted plain `Local` and `GitHub` labels, reducing their visual prominence without Markdown heading markers.
- Show `Local` only when local rows and a visible GitHub section coexist. GitHub workflows or an unavailable/error message count as a visible GitHub section.
- Omit `Local` when GitHub data is absent or has neither workflows nor an error. Preserve all suite, preparation, workflow and job rows.

## Decisions & Trade-offs
- Reuse the current GitHub-section visibility condition for both labels; add no configuration, dependencies or new UI abstraction.
- Terminal text has no font-size control; plain muted labels provide a compact presentation while also avoiding large Markdown headings in web clients.
- Retain section labels during GitHub errors so the warning remains clearly separate from local results.

## Verification
- Add renderer regression coverage for absent and empty GitHub data, mixed local/remote results, remote-only results and GitHub errors.
- Assert both labels use muted styling and contain no heading markers.
- Update existing widget/integration expectations and run focused pipeline tests, full tests and typecheck.

## Open Questions
None.
