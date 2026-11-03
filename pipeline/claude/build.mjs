import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./main.ts", import.meta.url));
const output = fileURLToPath(new URL("./server.bundle.mjs", import.meta.url));
const built = await build({
  entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node20",
  minify: true, legalComments: "inline", write: false,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
const contents = built.outputFiles[0].contents;
if (process.argv.includes("--check")) {
  const existing = await readFile(output);
  if (!existing.equals(contents)) throw new Error("Pipeline MCP bundle is stale; run npm run build:pipeline-claude");
} else await writeFile(output, contents);
