#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const searchDirs = [join(root, "test"), join(root, "lib"), join(root, "core")];

const files = [];
for (const d of searchDirs) {
  try {
    for (const f of readdirSync(d)) {
      if (f.endsWith(".test.mjs")) files.push(join(d, f));
    }
  } catch {}
}

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
