#!/usr/bin/env node
// build.mjs - turn the dev userscript into a public build that bundles
// core/*.mjs and lib/*.mjs at build time so the resulting file is a
// single self-contained userscript.
//
// Usage:
//   node build.mjs                       # reads .build-meta.json, writes dist/
//   node build.mjs --version 1.2.3       # override version
//
// Pipeline:
//   1. Read linux-sb-suite.user.js (dev source with localhost @updateURL).
//   2. Inline core/*.mjs and lib/*.mjs via core/inliner.mjs, before the
//      IIFE body so the inlined symbols are in scope.
//   3. Strip dev-only metadata, inject public metadata, stamp a build
//      timestamp, write to dist/linux-sb-suite.user.js.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle, listLibFiles } from "./core/inliner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "linux-sb-suite.user.js");
const OUT_DIR = resolve(__dirname, "dist");
const OUT = resolve(OUT_DIR, "linux-sb-suite.user.js");
const CORE_DIR = resolve(__dirname, "core");
const LIB_DIR = resolve(__dirname, "lib");

function readMeta() {
  const metaPath = resolve(__dirname, ".build-meta.json");
  if (!existsSync(metaPath)) {
    return { version: "1.0.0", author: "vfhky", namespace: "https://github.com/vfhky/linux-sb-pro" };
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
    else if (args[i] === "--updateURL") out.updateURL = args[++i];
    else if (args[i] === "--downloadURL") out.downloadURL = args[++i];
    else if (args[i] === "--out") out.out = args[++i];
  }
  return out;
}

// Replace the existing @key line if present, otherwise insert @key after @description.
function setMetaLine(src, key, value) {
  const re = new RegExp(`^(\\/\\/ @${key}\\s+).*$`, "m");
  if (re.test(src)) {
    return src.replace(re, `$1${value}`);
  }
  return src.replace(/^(\/\/ @description\s+.*)$/m, `$1\n// @${key.padEnd(11)} ${value}`);
}

function main() {
  const meta = { ...readMeta(), ...parseArgs() };
  let src = readFileSync(SRC, "utf8");

  // 1. Inline core/*.mjs and lib/*.mjs before the IIFE start so their
  //    top-level symbols (createI18n, createRegistry, probeEndpoint, ...)
  //    are in the outer scope and the IIFE can use them.
  const coreBundle = bundle(listLibFiles(CORE_DIR));
  const libBundle = bundle(listLibFiles(LIB_DIR));
  const startMarker = "if (root.LSB && root.LSB.__booted) return;";
  const idx = src.indexOf(startMarker);
  if (idx < 0) throw new Error("Could not find IIFE start marker in linux-sb-suite.user.js");
  const insert = `\n;/* === core inlined === */\n${coreBundle}\n;/* === lib inlined === */\n${libBundle}\n;`;
  src = src.slice(0, idx) + insert + src.slice(idx);

  // 2. Strip dev-only @updateURL / @downloadURL lines (localhost pointing).
  src = src.replace(/^\/\/ @updateURL\s+.*$/gm, "");
  src = src.replace(/^\/\/ @downloadURL\s+.*$/gm, "");

  // 3. Replace or insert core metadata lines.
  src = src.replace(/^(\/\/ @version\s+).*$/m, `$1${meta.version}`);
  // Mirror the @version into the runtime version constant surfaced in the panel.
  src = src.replace(/(version:\s*)(["'`"])([^"'`"]+)\2/, `$1$2${meta.version}$2`);
  src = src.replace(/^(\/\/ @author\s+).*$/m, `$1${meta.author}`);
  src = src.replace(/^(\/\/ @namespace\s+).*$/m, `$1${meta.namespace}`);
  if (meta.description) src = setMetaLine(src, "description", meta.description);
  if (meta.license)     src = setMetaLine(src, "license",     meta.license);

  // 4. @updateURL / @downloadURL: only set when meta provides them.
  //    Greasy Fork exposes /scripts/<id>.meta.js and /scripts/<id>.user.js
  //    for auto-update.
  if (meta.updateURL)   src = setMetaLine(src, "updateURL",   meta.updateURL);
  if (meta.downloadURL) src = setMetaLine(src, "downloadURL", meta.downloadURL);

  // 5. Stamp a build-time header below the metadata block.
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
