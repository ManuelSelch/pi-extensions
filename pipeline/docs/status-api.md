# TypeScript status API

[Pipeline overview](README.md)

## TypeScript status API


Other extensions in this repository can import the public `pipeline/core/api.ts` module instead of calling slash commands or reading private cache files:

```typescript
import { PipelineStatusReader, type PipelineStatus } from "./pipeline/core/api.ts";

const reader = new PipelineStatusReader();
try {
  const status: PipelineStatus = await reader.read("/path/to/checkout");
  // status.suites: latest local outcomes
  // status.github: optional remote workflows, jobs and errors
} finally {
  reader.stop();
}
```

- Own a reader for your consumer's lifecycle to reuse its per-worktree GitHub cache across requests. Stop it on session replacement/shutdown/reload; create a new reader for the next lifecycle. There is no global singleton or automatic polling. `readRemote(cwd, options)` reads only GitHub through the same cache when a consumer needs to render local status independently; `read()` still waits for both.
- `read(cwd)` canonicalizes a checkout or subdirectory to its worktree root. Different worktrees retain separate local results and remote readers. Existing non-Git directories use their own directory as the root; missing paths reject.
- `read` is read-only: it never executes suites/preparation, changes configuration or approvals, registers UI, or creates local result caches. It does use the existing read-only Git/`gh` status queries. No active Pi session in the target repository is needed.
- Local status is recomputed per call and retains the latest outcome regardless of later source or configuration changes. Remote requests reuse the 60-second cache, in-flight deduplication and branch invalidation. Use `read(cwd, { force: true })` to bypass the remote TTL; an in-flight fetch is still shared, and the result updates the same cache. Independent reader instances have independent caches. Local configuration/read errors reject; a remote refresh failure returns `status.github.error` and `errorKind` with no retained workflow snapshot. Non-GitHub or unsupported branch selections omit `github`.
- `stop()` is idempotent, aborts remote requests and releases remote readers. Further reads and in-flight reads that reach their completion after disposal reject with a stopped-reader error. Local filesystem status reads already underway are not cancellable, but their late results are discarded.
- Grouped local suites expose an aggregate outcome and a `jobs` mapping of per-job results; command-only suite status is unchanged. Aggregate precedence and job execution are described in [configuration](configuration.md#results-and-automatic-scheduling). The API does not combine local and remote outcomes into a single pass/fail policy. The pipeline tool, slash command and widget use this same API.
