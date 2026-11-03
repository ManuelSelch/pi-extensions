# Claude Code

[Pipeline overview](README.md)

## Claude Code


Keep the repository at `~/.pi/agent/extensions` and install its dependencies, then register the local Claude Code marketplace and install the pipeline plugin once:

```bash
cd ~/.pi/agent/extensions
npm ci
claude plugin marketplace add ~/.pi/agent/extensions
claude plugin install pipeline@pi-extensions --scope user
```

Restart Claude Code and use `/mcp` to check the connection. Claude copies the plugin configuration into its cache, but starts the MCP server from `~/.pi/agent/extensions/pipeline/claude/main.ts` using the checkout's `node_modules`. The checkout must remain at that path; run `npm ci` again when its dependencies change. No bundle or build step is needed. You can also load the plugin for one session with `claude --plugin-dir ~/.pi/agent/extensions/pipeline`.

If an earlier marketplace installation still references `server.bundle.mjs`, run `claude plugin update pipeline@pi-extensions` and restart Claude Code so it reads the new MCP configuration.

Claude gets the four pipeline MCP tools: configure, run, status and wait. Configuration and execution reviews use MCP form elicitation, including the configuration diff or command summary. The user must explicitly check the approval field and submit; rejection, cancellation, unavailable elicitation or a failed request never grants approval. A client's automated elicitation hooks can answer these requests, so only use trusted client settings.

Pi and Claude use the same `.pi/pipeline.yaml`, per-worktree results and preparation state, locks, and repository-scoped approvals, provided they use the same `PI_CODING_AGENT_DIR` (or both use its default). An approval in either host permits the identical configuration in the other; external configuration changes still require approval. The server resolves the project from `CLAUDE_PROJECT_DIR`, or its process working directory if unset.

The plugin also includes a Claude Code mod that shows local suites and GitHub Actions in the band above the prompt. It reads `pipeline_status` in the background every five seconds, without running suites or prompting the model. Empty status hides the widget; an unavailable status shows a warning rather than a stale success. The warning includes a best-effort category (`permission`, `timeout`, `invalid response`, or `connection`), never raw diagnostics; `connection` also covers unclassified errors. The monitor starts in an interactive terminal or when Claude Desktop attaches to a session, and stops when the last Desktop client detaches unless the terminal remains active. Claude Code can collapse the band with Ctrl+X, Ctrl+A. The mod requires Claude Code with mod support and a connected plugin MCP server; it does not add Pi's `/pipeline` command or after-agent scheduler.

MCP cancellation stops local running work and never cancels remote GitHub Actions. Claude Code can background long calls and applies its own MCP idle and wall-clock timeouts; configure those in Claude Code if needed. No model-facing progress updates are emitted by this adapter.
