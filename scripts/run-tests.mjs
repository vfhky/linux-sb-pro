#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const searchDirs = [join(root, "test"), join(root, "lib"), join(root, "core")];

// Recursively collect *.test.mjs (test/, test/unit/, lib/, core/).
function collectTests(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) collectTests(full, acc);
    else if (e.name.endsWith(".test.mjs")) acc.push(full);
  }
  return acc;
}

const files = searchDirs.flatMap((d) => collectTests(d));

let pass = 0, fail = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(f).href);
  try {
    await mod.default();
    console.log(`ok  ${f.replace(root, ".").replace(/\\/g, "/")}`);
    pass++;
  } catch (err) {
    console.error(`FAIL ${f}`);
    console.error(err);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
