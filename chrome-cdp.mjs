#!/usr/bin/env node
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const CDP_URL = process.env.LSB_CDP_URL || "http://127.0.0.1:9444";
const DEFAULT_PATTERN = "linux.sb";

function usage() {
  console.log("chrome-cdp.mjs - Chrome control via CDP");
  console.log("Usage:");
  console.log("  node chrome-cdp.mjs list");
  console.log("  node chrome-cdp.mjs tabs");
  console.log("  node chrome-cdp.mjs current [pattern]");
  console.log("  node chrome-cdp.mjs goto <url> [pattern]");
  console.log("  node chrome-cdp.mjs html [pattern] [outFile]");
  console.log("  node chrome-cdp.mjs text <selector> [pattern]");
  console.log("  node chrome-cdp.mjs attr <selector> <attr> [pattern]");
  console.log("  node chrome-cdp.mjs all <selector> [pattern]");
  console.log("  node chrome-cdp.mjs eval <js> [pattern]");
  console.log("  node chrome-cdp.mjs screenshot [pattern] [outFile]");
  console.log("  node chrome-cdp.mjs cookies [pattern]");
  console.log("  node chrome-cdp.mjs storage <local|session> [pattern]");
  console.log("  node chrome-cdp.mjs tm-update");
  process.exit(0);
}

async function connect() {
  try { return await chromium.connectOverCDP(CDP_URL); }
  catch (err) { console.error("Cannot connect: " + err.message); process.exit(1); }
}

async function findPage(browser, pattern) {
  const needle = pattern ?? DEFAULT_PATTERN;
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().includes(needle)) return p;
  return null;
}

async function allPages(browser) {
  const out = [];
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) out.push(p);
  return out;
}

function notFound(p) { console.error("No tab matches: " + (p ?? DEFAULT_PATTERN)); process.exitCode = 2; }

async function cmdList() {
  const b = await connect();
  try {
    const out = [];
    for (const p of await allPages(b)) out.push({ url: p.url(), title: await p.title().catch(() => "(no title)") });
    console.log(JSON.stringify(out, null, 2));
  } finally { await b.close(); }
}

async function cmdTabs() {
  const b = await connect();
  try { for (const p of await allPages(b)) console.log(p.url()); } finally { await b.close(); }
}

async function cmdCurrent(pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    console.log(JSON.stringify({ url: p.url(), title: await p.title().catch(() => "(no title)"), viewport: p.viewportSize() }, null, 2));
  } finally { await b.close(); }
}

async function cmdGoto(url, pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log(p.url());
  } finally { await b.close(); }
}

async function cmdHtml(pattern, outFile) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    const html = await p.content();
    if (outFile) { await writeFile(outFile, html, "utf8"); console.error("Wrote " + html.length + " bytes"); }
    else process.stdout.write(html);
  } finally { await b.close(); }
}

async function cmdText(selector, pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    const text = await p.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.textContent : null; }, selector);
    if (text == null) { console.error("No element matches: " + selector); process.exitCode = 2; return; }
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
  } finally { await b.close(); }
}

async function cmdAttr(selector, attr, pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    const value = await p.evaluate(({ sel, a }) => { const el = document.querySelector(sel); return el ? el.getAttribute(a) : null; }, { selector, attr });
    if (value == null) { console.error("No element matches: " + selector); process.exitCode = 2; return; }
    console.log(value);
  } finally { await b.close(); }
}

async function cmdAll(selector, pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    const texts = await p.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent), selector);
    console.log(JSON.stringify(texts, null, 2));
  } finally { await b.close(); }
}

async function cmdEval(expression, pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    const result = await p.evaluate(expression);
    if (typeof result === "string") console.log(result); else console.log(JSON.stringify(result, null, 2));
  } finally { await b.close(); }
}

async function cmdScreenshot(pattern, outFile) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    if (!outFile) outFile = "screenshot-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
    await p.screenshot({ path: outFile, fullPage: true });
    console.error("Saved " + outFile); console.log(outFile);
  } finally { await b.close(); }
}

async function cmdCookies(pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    console.log(JSON.stringify(await p.context().cookies(), null, 2));
  } finally { await b.close(); }
}

async function cmdStorage(kind, pattern) {
  const b = await connect();
  try {
    const p = await findPage(b, pattern);
    if (!p) return notFound(pattern);
    const target = kind === "session" ? "sessionStorage" : "localStorage";
    const data = await p.evaluate((t) => { const o = {}; for (let i = 0; i < window[t].length; i++) { const k = window[t].key(i); o[k] = window[t].getItem(k); } return o; }, target);
    console.log(JSON.stringify(data, null, 2));
  } finally { await b.close(); }
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") usage();
async function cmdTmUpdate() {
  const b = await connect();
  const TM_EXT = "chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo";
  const SCRIPT_NAME = "linux.sb Suite";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) Find a TM page (dashboard) or open one.
  const ctxs = b.contexts();
  let tm = null;
  for (const c of ctxs) for (const p of c.pages()) {
    if (p.url().startsWith(TM_EXT) && p.url().includes("nav=dashboard")) { tm = p; break; }
  }
  if (!tm) {
    tm = await ctxs[0].newPage();
    await tm.goto(TM_EXT + "/options.html#nav=dashboard", { waitUntil: "domcontentloaded", timeout: 15000 });
  } else {
    await tm.bringToFront();
    if (!tm.url().includes("nav=dashboard")) {
      await tm.goto(TM_EXT + "/options.html#nav=dashboard", { waitUntil: "domcontentloaded", timeout: 15000 });
    }
  }
  await tm.waitForSelector("tr.scripttr", { timeout: 10000 }).catch(() => null);

  // 2) Click the script-row checkbox.
  const sel = await tm.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll("tr.scripttr"));
    const row = rows.find(r => {
      const n = r.querySelector(".script_name")?.textContent || "";
      return n.trim() === name || n.includes(name);
    });
    if (!row) return { ok: false, reason: "row not found" };
    const cb = row.querySelector("td.script_sel input[type=checkbox]");
    if (!cb) return { ok: false, reason: "checkbox not found" };
    if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    return { ok: true, rowId: row.id };
  }, SCRIPT_NAME);
  if (!sel.ok) { console.error("select failed:", sel.reason); await b.close(); return; }
  console.log("Selected row:", sel.rowId);

  // 3) Pick "Trigger Update" in the bulk dropdown.
  const act = await tm.evaluate(() => {
    const sel = document.querySelector("select[name=select]") || document.querySelector("select");
    if (!sel) return { ok: false, reason: "select not found" };
    const opt = Array.from(sel.options).find(o => /trigger.*update/i.test(o.textContent));
    if (!opt) return { ok: false, reason: "no trigger-update option" };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.textContent };
  });
  if (!act.ok) { console.error("action failed:", act.reason); await b.close(); return; }
  console.log("Action:", act.text);

  // 4) Click Start.
  const started = await tm.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("input.action_button, input[type=button]"))
      .find(b => /start/i.test(b.value || ""));
    if (!btn) return { ok: false, reason: "start button not found" };
    btn.click();
    return { ok: true };
  });
  if (!started.ok) { console.error("start failed:", started.reason); await b.close(); return; }
  console.log("Started check.");

  // 5) Wait for an ask.html update dialog to appear, then click Update.
  let updateClicked = false;
  for (let attempt = 0; attempt < 30 && !updateClicked; attempt++) {
    await sleep(500);
    const r = await tm.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll("iframe")).map(f => {
        try { return f.contentDocument?.URL || ""; } catch { return ""; }
      });
      // Find any tab whose URL is an ask.html with our script
      // The actual page is in a tab, not a frame, so we look at the document title.
      if (document.title === "Userscript update") {
        const btn = document.getElementById("input_VXBkYXRlX3Vua25vd24_bu");
        if (btn) { btn.click(); return { clicked: "update" }; }
      }
      return { noop: true, title: document.title };
    });
    if (r.clicked) { updateClicked = true; console.log("Clicked Update button."); }
  }
  if (!updateClicked) { console.error("Update dialog never appeared (script may already be up to date)."); await b.close(); return; }

  // 6) Wait for the reinstall dialog and click Reinstall.
  let reinstallClicked = false;
  for (let attempt = 0; attempt < 30 && !reinstallClicked; attempt++) {
    await sleep(500);
    const r = await tm.evaluate(() => {
      if (document.title === "Userscript re-installation") {
        const btn = document.getElementById("input_UmVpbnN0YWxsX3Vua25vd24_bu");
        if (btn) { btn.click(); return { clicked: "reinstall" }; }
      }
      return { noop: true, title: document.title };
    });
    if (r.clicked) { reinstallClicked = true; console.log("Clicked Reinstall button."); }
  }
  if (!reinstallClicked) { console.error("Reinstall dialog never appeared."); await b.close(); return; }

  // 7) Give TM a moment to finalize, then refresh the linux.sb page to pick up the new code.
  await sleep(1500);
  for (const c of ctxs) for (const p of c.pages()) {
    if (p.url().includes("linux.sb")) {
      try { await p.reload({ waitUntil: "domcontentloaded", timeout: 30000 }); }
      catch (e) { console.error("reload failed:", e.message); }
    }
  }
  console.log("Update flow complete.");
  await b.close();
}

  switch (cmd) {
    case "list": return cmdList();
    case "tabs": return cmdTabs();
    case "current": return cmdCurrent(rest[0]);
    case "goto": return cmdGoto(rest[0], rest[1]);
    case "html": return cmdHtml(rest[0], rest[1]);
    case "text": return cmdText(rest[0], rest[1]);
    case "attr": return cmdAttr(rest[0], rest[1], rest[2]);
    case "all": return cmdAll(rest[0], rest[1]);
    case "eval": return cmdEval(rest[0], rest[1]);
    case "screenshot": return cmdScreenshot(rest[0], rest[1]);
    case "cookies": return cmdCookies(rest[0]);
    case "storage": return cmdStorage(rest[0], rest[1]);
    case "tm-update": return cmdTmUpdate();
    default: console.error("Unknown: " + cmd); process.exit(1);
  }
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
