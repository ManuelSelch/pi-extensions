import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPipelineServer } from "./server.ts";

const server = createPipelineServer({ cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
await server.connect(new StdioServerTransport());
