// Build-time inliner for lib/*.mjs.  Lists files in alphabetical order
// (deterministic), strips the `export` keyword so the result runs as
// a script body, and concatenates with `;\n` between files.
import { readdirSync, readFileSync } from "node:fs";

export function listLibFiles(libDir) {
  return readdirSync(libDir)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort()
    .map((f) => `${libDir}/${f}`);
}

export function bundle(files) {
  return files
    .map((f) => readFileSync(f, "utf8"))
    .map((src) => src.replace(/^export\s+/gm, ""))
    .join("\n;\n")
    .trim();
}
