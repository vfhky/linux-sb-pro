#!/usr/bin/env node
// build.mjs - turn the dev userscript (with localhost @updateURL) into a
// public build that can be submitted to Greasy Fork or served from GitHub
// raw.  The dev workflow (this repo) is unchanged: edit the dev file,
// run `node chrome-cdp.mjs tm-update` to push to the local install.
//
// Usage:
//   node build.mjs                    # reads .build-meta.json, writes dist/
//   node build.mjs --version 1.2.3    # override version
//
// .build-meta.json example:
//   { "version": "1.0.0",
//     "author": "myss",
//     "namespace": "https://github.com/myss/linux-sb-script",
//     "description": "..." }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "linux-sb-suite.user.js");
const OUT_DIR = resolve(__dirname, "dist");
const OUT = resolve(OUT_DIR, "linux-sb-suite.user.js");

function readMeta() {
  const metaPath = resolve(__dirname, ".build-meta.json");
  if (!existsSync(metaPath)) {
    return { version: "1.0.0", author: "myss", namespace: "https://github.com/yourname/linux-sb-script" };
  }
  return JSON.parse(readFileSync(metaPath, "utf8"));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version") out.version = args[++i];
    else if (args[i] === "--author") out.author = args[++i];
    else if (args[i] === "--namespace") out.namespace = args[++i];
    else if (args[i] === "--out") out.out = args[++i];
  }
  return out;
}

function main() {
  const meta = { ...readMeta(), ...parseArgs() };
  let src = readFileSync(SRC, "utf8");

  // Strip dev-only @updateURL / @downloadURL lines pointing at localhost.
  src = src.replace(/^\/\/ @updateURL\s+.*$/gm, "");
  src = src.replace(/^\/\/ @downloadURL\s+.*$/gm, "");

  // Inject / replace the @version, @author, @namespace lines.
  src = src.replace(/^(\/\/ @version\s+).*$/m, `$1${meta.version}`);
  src = src.replace(/^(\/\/ @author\s+).*$/m, `$1${meta.author}`);
  src = src.replace(/^(\/\/ @namespace\s+).*$/m, `$1${meta.namespace}`);
  if (meta.description) {
    src = src.replace(/^(\/\/ @description\s+).*$/m, `$1${meta.description}`);
  }

  // Stamp a build-time header below the metadata block.
  const stamp = `\n/*\n * linux.sb Suite  -- public build\n * built: ${new Date().toISOString()}\n * source: ${meta.namespace}\n */\n`;
  const blockEnd = src.indexOf("==/UserScript==");
  if (blockEnd < 0) throw new Error("Could not find ==/UserScript==");
  const insertAt = blockEnd + "==/UserScript==".length;
  src = src.slice(0, insertAt) + stamp + src.slice(insertAt);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outPath = meta.out ? resolve(__dirname, meta.out) : OUT;
  writeFileSync(outPath, src, "utf8");
  console.log(`Wrote ${outPath} (${src.length} bytes, version=${meta.version})`);
}

main();