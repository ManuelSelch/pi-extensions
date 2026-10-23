import { mkdirSync, readFileSync, statSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyCatalogue, validateCatalogue, type Catalogue } from "../Domain/catalogue.ts";

const MAX_BYTES = 1024 * 1024;
function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
export function readCatalogue(file: string): Catalogue {
  let source: string;
  try {
    if (statSync(file).size > MAX_BYTES) throw new Error("Projects catalogue exceeds 1 MiB.");
    source = readFileSync(file, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return emptyCatalogue();
    throw error;
  }
  return validateCatalogue(JSON.parse(source));
}

/** Cross-process lock covers the whole read/modify/write window, not just publication. */
export function updateCatalogue(file: string, change: (data: Catalogue) => void): void {
  mkdirSync(dirname(file), { recursive: true });
  const lock = file + ".lock";
  try { mkdirSync(lock); }
  catch (error) {
    if (hasCode(error, "EEXIST")) throw new Error(`Projects catalogue is locked. Retry; if a process crashed, remove ${lock} only after checking no writer is active.`);
    throw error;
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const data = readCatalogue(file);
    change(data);
    validateCatalogue(data);
    const source = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(source) > MAX_BYTES) throw new Error("Projects catalogue exceeds 1 MiB.");
    writeFileSync(temp, source, { flag: "wx", mode: 0o600 });
    renameSync(temp, file);
  } finally {
    try { unlinkSync(temp); }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    finally { rmdirSync(lock); }
  }
}
