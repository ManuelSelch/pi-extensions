import { homedir } from "node:os";
import { sep } from "node:path";

/** Abbreviate home paths for display only; never change operational paths. */
export function displayPath(file: string): string {
 const home = homedir();
 if (file === home) return "~";
 const prefix = home.endsWith(sep) ? home : home + sep;
 return file.startsWith(prefix) ? "~" + sep + file.slice(prefix.length) : file;
}
