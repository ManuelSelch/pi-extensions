/**
 * PDF Extension
 *
 * Provides a /pdf command to convert PDF files to text using pdftotext.
 *
 * Usage:
 *   /pdf file.pdf              → Converts to file.txt in the same directory
 *   /pdf /path/to/file.pdf     → Converts to /path/to/file.txt
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve, dirname, basename, extname, join } from "node:path";

export default function pdfExtension(pi: ExtensionAPI) {
	pi.registerCommand("pdf", {
		description: "Convert PDF to text (pdftotext)",
		handler: async (args, ctx) => {
			const filePath = args.trim();

			// Validate input
			if (!filePath) {
				ctx.ui.notify("Usage: /pdf <file.pdf>", "error");
				return;
			}

			// Remove wrapping quotes (important fix)
			const cleanedPath = filePath.replace(/^["']|["']$/g, "");


			// Resolve to absolute path
			const absolutePath = resolve(ctx.cwd, cleanedPath);

			// Validate it's a PDF file
			const ext = extname(absolutePath).toLowerCase();
			if (ext !== ".pdf") {
				ctx.ui.notify(`Error: File must be a PDF (got ${ext || "no extension"})`, "error");
				return;
			}

			// Determine output path (same name but .txt)
			const dir = dirname(absolutePath);
			const baseName = basename(absolutePath, ".pdf");
			const outputPath = join(dir, `${baseName}.txt`);

			// Notify user of conversion
			ctx.ui.notify(`Converting: ${basename(absolutePath)} → ${basename(outputPath)}...`, "info");

			try {
				// Execute pdftotext command
				const result = await pi.exec("pdftotext", [absolutePath, outputPath], {
					timeout: 30000, // 30 second timeout
				});

				if (result.code !== 0) {
					ctx.ui.notify(`Conversion failed: ${result.stderr || "Unknown error"}`, "error");
					return;
				}

				// Success
				ctx.ui.notify(`✓ Converted to: ${outputPath}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Error: ${message}`, "error");
			}
		},
	});
}
