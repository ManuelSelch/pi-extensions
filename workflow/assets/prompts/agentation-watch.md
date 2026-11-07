# Agentation watch workflow

When the user asks to watch Agentation feedback, use the Agentation MCP watch tool in a loop. Do not start watching solely because this workflow is enabled.

For each annotation, read its context and thread, acknowledge actionable feedback, ask about ambiguity, and make the requested change. Verify the result before resolving with a summary; leave questions, rejected changes, and unverified work unresolved. Report MCP errors rather than claiming a status change. Continue until the user stops, the watch times out, or the call is cancelled. Follow applicable approval and browser-automation rules; obtain permission when required before visual browser checks.

## Development-only integration

When asked to add Agentation to a React application, install `agentation` as a development dependency and render it once near the app root only in development, with `endpoint="http://localhost:4747"` for the local MCP server. For Vite use `import.meta.env.DEV`; for React builds that replace `process.env.NODE_ENV`, use its development check. In Next.js App Router place the toolbar in a client component and render it from the root layout; in Pages Router render it from `pages/_app`. Use the project's build conventions. A render guard alone does not guarantee exclusion from production bundles: verify this separately when required. The browser must be able to reach the configured endpoint; avoid sensitive data in annotations.

The MCP server is configured separately in Pi and need not be installed in each app. Follow the project's scenario and UI approval requirements before modifying a real app.
