// ==UserScript==
// @name         linux.sb Suite
// @namespace    https://github.com/vfhky/linux-sb-pro
// @version      1.0.1
// @description  Compact floating panel for linux.sb: shows logged-in user, daily check-in status, and an auto-signin toggle. Modular core (logger/storage/events/http/dom) plus a UI module that can be extended for more forum features.
// @downloadURL https://update.greasyfork.org/scripts/590905.user.js
// @updateURL   https://update.greasyfork.org/scripts/590905.meta.js
// @license     Apache-2.0
// @author       vfhky
// @match        https://linux.sb/*
// @match        https://www.linux.bi/*


// @icon         https://linux.sb/app/assets/index.svg
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
/*
 * linux.sb Suite  -- public build
 * built: 2026-08-12T01:22:45.081Z
 * source: https://github.com/vfhky/linux-sb-pro
 */


/*
 * linux.sb Suite
 * --------------
 * Architecture overview
 *
 *   LSB  (root namespace, the only global)
 *     |
 *     +-- core/      (always loaded, no dependencies on modules)
 *     |     config   static configuration, paths, feature flags
 *     |     logger   leveled logger (debug/info/warn/error) with module tag
 *     |     utils    DOM helpers, url parsing, formatters
 *     |     storage  GM_* wrapper with versioned keys, JSON, TTL
 *     |     http     fetch wrapper, xhr fallback, cookie-aware
 *     |     events   tiny pub/sub used by modules
 *     |     dom      waitForElement, onRouteChange, scrape helpers
 *     |
 *     +-- modules/   (each module is independent, registers itself)
 *     |     user     extract logged-in user info from the page (this module)
 *     |     signin   (placeholder) detect / trigger sign-in
 *     |     ...
 *     |
 *     +-- api/       forum-specific helpers
 *     |     linuxSb  selectors, URL patterns, response shape
 *     |
 *     +-- ui/        (optional, lazy)
 *           panel    small floating panel showing user info
 *
 *   Each module exports a single object via LSB.register("name", factory).
 *   Modules declare their dependencies by name. The bootstrap resolves
 *   them in topological order, then calls each module factory.
 *
 *   To add a new feature:
 *     LSB.register("myFeature", function (api) {
 *       const { config, logger, dom, user } = api;
 *       return { name: "myFeature", init() { ... } };
 *     });
 *
 *   To toggle features: edit LSB.config.modules below.
 */

(function (root) {
  "use strict";

  // ----- guard: run once per page ---------------------------------------
  
;/* === core inlined === */
// Generate CSS rules for the floating panel position + theme.  Keeping
// the rule emission in one place means adding a new position or theme
// is a single config edit; the public build is data-driven end to end.

function panelPositionCss(positions) {
  const sides = ["top", "right", "bottom", "left"];
  return Object.entries(positions)
    .map(([pos, off]) => {
      const decls = sides.map((s) => `${s}:${off[s] != null ? off[s] + "px" : "auto"};`).join("");
      return `#lsb-panel[data-pos="${pos}"]{${decls}}`;
    })
    .join("\n");
}

function panelThemeCss(palettes) {
  return Object.entries(palettes)
    .map(([name, p]) => {
      const decls = [
        `--lsb-bg:${p.bg}`,
        `--lsb-fg:${p.fg}`,
        `--lsb-border:${p.border || "transparent"}`,
        `--lsb-shadow:${p.shadow || "none"}`,
      ].join(";");
      return `#lsb-panel[data-theme="${name}"]{${decls};}`;
    })
    .join("\n");
}

;
// Tiny registry of "panel sections".  Each module can contribute a
// section to the expanded panel; the registry returns them in order.
// Sections are pure: they receive the current state and return an
// element descriptor; ui renders them.
function createSectionRegistry() {
  const sections = new Map();

  function register(name, def) {
    if (!name || typeof def !== "object" || typeof def.render !== "function") {
      throw new Error("dom-sections: bad def for " + name);
    }
    sections.set(name, { order: def.order || 0, render: def.render, hidden: def.hidden || (() => false) });
  }
  function unregister(name) { sections.delete(name); }
  function list() { return Array.from(sections.entries()).sort((a, b) => a[1].order - b[1].order); }
  function render(ctx) {
    let innerHTML = "";
    for (const [, def] of list()) {
      if (def.hidden(ctx)) continue;
      const r = def.render(ctx);
      if (r && r.innerHTML != null) innerHTML += r.innerHTML;
    }
    return { innerHTML };
  }
  return { register, unregister, list, render };
}

;
// Minimal i18n helper.  Locale fallback chain: exact match -> language
// root (zh-CN -> zh) -> explicit fallback locale -> en -> key itself.
function createI18n({ locale = "en", fallback = "en" } = {}) {
  const table = {};
  function add(map) { Object.assign(table, map); }
  function setLocale(loc) { locale = loc; }
  function pick(strings, loc) {
    if (!strings) return null;
    if (strings[loc] != null) return strings[loc];
    const root = loc.split("-")[0];
    if (strings[root] != null) return strings[root];
    if (strings[fallback] != null) return strings[fallback];
    if (strings.en != null) return strings.en;
    return null;
  }
  function t(key, loc) {
    const useLoc = loc || locale;
    const v = pick(table[key], useLoc);
    return v != null ? v : key;
  }
  return { add, setLocale, t, get locale() { return locale; } };
}

;
// Build-time inliner for lib/*.mjs.  Lists files in alphabetical order
// (deterministic), strips the `export` keyword so the result runs as
// a script body, and concatenates with `;\n` between files.
import { readdirSync, readFileSync } from "node:fs";

function listLibFiles(libDir) {
  return readdirSync(libDir)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort()
    .map((f) => `${libDir}/${f}`);
}

function bundle(files) {
  return files
    .map((f) => readFileSync(f, "utf8"))
    .map((src) => src.replace(/^export\s+/gm, ""))
    .join("\n;\n")
    .trim();
}

;
// Theme palettes.  Add a new theme here + a matching CSS rule and it
// works everywhere automatically.  "auto" is a meta-theme resolved by
// the ui module against prefers-color-scheme.
const PALETTES = {
  light: { bg: "#ffffff", fg: "#1f2937", border: "rgba(0,0,0,0.08)", shadow: "0 8px 24px rgba(0,0,0,0.12)" },
  dark:  { bg: "rgba(20,22,28,0.94)", fg: "#eee", border: "rgba(255,255,255,0.08)", shadow: "0 8px 24px rgba(0,0,0,0.35)" },
};

const THEMES = ["light", "dark", "auto"];

function listThemes() { return THEMES.slice(); }

function getPalette(name) {
  if (name === "auto") throw new Error("palettes: auto is a meta-theme, resolve via ui");
  if (!PALETTES[name]) throw new Error("palettes: unknown theme " + name);
  return PALETTES[name];
}

;
// Generic poller: tick at a fixed interval while the document is visible,
// with an optional backoff after N consecutive errors.  Inject the
// `document` object so tests can run without a real DOM.
function makePoller({ name, onTick, intervalMs = 60_000, backoffAfter = 3, backoffMs = 5 * 60_000, document: doc = (typeof document !== "undefined" ? document : null) } = {}) {
  if (typeof onTick !== "function") throw new Error("makePoller: onTick must be a function");
  if (!(intervalMs > 0)) throw new Error("makePoller: intervalMs must be > 0");
  if (!name) throw new Error("makePoller: name required");

  const poller = {
    name,
    state: "stopped",
    start, stop, tick,
    get currentInterval() { return backoffUntil > Date.now() ? backoffMs : intervalMs; },
  };

  let timer = null;
  let errors = 0;
  let backoffUntil = 0;
  let runningTick = false;
  let visibilityHandler = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runOnce, poller.currentInterval);
  }

  async function runOnce() {
    if (poller.state !== "running") return;
    if (doc && doc.hidden) { schedule(); return; }
    if (runningTick) { schedule(); return; }
    runningTick = true;
    try {
      await onTick();
      errors = 0;
      backoffUntil = 0;
    } catch (err) {
      errors++;
      if (errors >= backoffAfter) backoffUntil = Date.now() + backoffMs;
      if (typeof console !== "undefined") console.warn(`[${name}] tick failed (${errors})`, err);
    } finally {
      runningTick = false;
      schedule();
    }
  }

  function start() {
    if (poller.state === "running") return;
    poller.state = "running";
    if (doc && doc.addEventListener) {
      visibilityHandler = () => { if (!doc.hidden) runOnce(); };
      doc.addEventListener("visibilitychange", visibilityHandler);
    }
    runOnce();
  }

  function stop() {
    if (poller.state === "stopped") return;
    poller.state = "stopped";
    if (timer) { clearTimeout(timer); timer = null; }
    if (doc && doc.removeEventListener && visibilityHandler) {
      doc.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
  }

  async function tick() { await runOnce(); }

  return poller;
}

;
// Tiny settings registry.  Each registered setting gets a getter and a
// setter with type-aware validation, plus a pub/sub for change events.
// Backed by GM_getValue / GM_setValue (so values persist across reloads).
function createRegistry() {
  const defs = new Map();
  const listeners = new Set();
  const keyListeners = new Map();

  function validate(def, v) {
    if (def.type === "boolean") return typeof v === "boolean" ? v : null;
    if (def.type === "enum") return def.options.includes(v) ? v : null;
    if (def.type === "string") return typeof v === "string" ? v : null;
    if (def.type === "number") return Number.isFinite(v) ? v : null;
    return null;
  }

  function get(key) {
    const def = defs.get(key);
    if (!def) throw new Error("settings.get: unknown key " + key);
    let value = def.default;
    const raw = typeof GM_getValue === "function" ? GM_getValue(def.storageKey, null) : null;
    const v = validate(def, raw);
    if (v !== null) value = v;
    const set = (next) => {
      if (validate(def, next) === null) throw new Error("settings: invalid value for " + key + ": " + next);
      value = next;
      if (typeof GM_setValue === "function") GM_setValue(def.storageKey, next);
      for (const fn of keyListeners.get(key) || []) { try { fn(next); } catch (e) { if (typeof console !== "undefined") console.warn(e); } }
      for (const fn of listeners) { try { fn({ key, value: next }); } catch (e) { if (typeof console !== "undefined") console.warn(e); } }
    };
    const subscribe = (fn) => {
      if (!keyListeners.has(key)) keyListeners.set(key, new Set());
      keyListeners.get(key).add(fn);
      return () => keyListeners.get(key).delete(fn);
    };
    return { get: () => value, set, subscribe, def };
  }

  function register(def) {
    if (!def || !def.key) throw new Error("settings.register: key required");
    if (!def.type) throw new Error("settings.register: type required for " + def.key);
    def.storageKey = def.storageKey || ("lsb:setting:" + def.key);
    def.group = def.group || "general";
    def.label = typeof def.label === "string" ? { en: def.label } : (def.label || { en: def.key });
    defs.set(def.key, def);
  }

  function list() {
    return Array.from(defs.values()).sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.key.localeCompare(b.key);
    });
  }
  function groups() { return Array.from(new Set(list().map((d) => d.group))); }
  function on(event, fn) {
    if (event !== "change") throw new Error("settings.on: only change supported");
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { register, get, list, groups, on };
}
;/* === lib inlined === */
// Generate HTML fixtures for notif parser tests.  Variants cover the
// site layouts we know about, plus a few edges (malformed, empty,
// overflow).  Kept pure so it runs anywhere (node, browser, etc).
function renderItem({ id, mention, href, title, age }) {
  return (
    `<li data-id="${id}" data-mention="${mention ? "true" : "false"}">` +
    `<a href="${href}">${title}</a>` +
    (age ? `<time>${age}</time>` : "") +
    `</li>`
  );
}

function buildFixture({ items = [], unread = 0, mode = "list" } = {}) {
  if (mode === "empty") {
    return `<!doctype html><html><body>` +
      `<h1>通知中心</h1>` +
      `<ul class="notif-list"></ul>` +
      `<span class="notif-unread-count">0</span>` +
      `</body></html>`;
  }
  if (mode === "malformed") return "<html></html>";
  return `<!doctype html><html><body>` +
    `<h1>通知中心</h1>` +
    `<ul class="notif-list">${items.map(renderItem).join("")}</ul>` +
    `<span class="notif-unread-count">${unread}</span>` +
    `</body></html>`;
}

const DEFAULT_ITEMS = [
  { id: 1, mention: true,  href: "/topic/100#reply-1", title: "@vfhky 在【测试主题】回复了你", age: "2 分钟前" },
  { id: 2, mention: false, href: "/topic/101",        title: "你关注的主题【新主题】有新回复", age: "10 分钟前" },
  { id: 3, mention: true,  href: "/topic/102#reply-5", title: "@other 在【另一主题】提到了你", age: "1 小时前" },
];

;
// Parse a linux.sb notifications page into { unread, list }.
// Pure: takes HTML text, returns a plain object.  MAX_LIST caps the
// returned list size; unread is reported as the raw count even when
// the list is capped (the panel can show "5 of N").
const MAX_LIST = 5;

function extractUnread(html) {
  const m = html.match(/class\s*=\s*["'][^"']*notif-unread-count["'][^>]*>\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function extractList(html) {
  const block = html.match(/<ul[^>]*class\s*=\s*["'][^"']*\bnotif-list\b[^"']*["'][\s\S]*?<\/ul>/i);
  if (!block) return [];
  const items = [];
  const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(block[0])) !== null) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    const idMatch = attrs.match(/data-id\s*=\s*["']([^"']+)/i);
    const mention = /data-mention\s*=\s*["']true/i.test(attrs);
    const aMatch = body.match(/<a\b[^>]*href\s*=\s*["']([^"']+)[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) continue;
    const url = aMatch[1];
    const title = aMatch[2].replace(/<[^>]+>/g, "").trim();
    items.push({ id: idMatch ? idMatch[1] : url, url, title, isMention: mention });
    if (items.length >= MAX_LIST) break;
  }
  return items;
}

function parseNotifications(html) {
  if (typeof html !== "string" || !html) return { unread: 0, list: [] };
  return { unread: extractUnread(html), list: extractList(html) };
}

;
// Try each candidate URL in order.  Return the first one whose HTML body
// contains either a notification-shaped heading or a list-shaped element.
// Pure: depends only on the http adapter the caller injects.
const HEADING_RE = /<h\d[^>]*>\s*(?:通知(?:中心)?|提醒|消息|inbox|notifications?)\s*</i;
const LIST_CLASS_RE = /class\s*=\s*["'][^"']*\b(?:notif|notice|inbox|message)-?list\b/i;

function isNotifPage(html) {
  return HEADING_RE.test(html) || LIST_CLASS_RE.test(html);
}

async function probeEndpoint(http, apiBase, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const base = String(apiBase || "").replace(/\/+$/, "");
  for (const path of candidates) {
    const url = base + path;
    const html = await http.getHtml(url);
    if (isNotifPage(html || "")) return url;
  }
  return null;
}

;
// Storage adapter for the floating panel's position and theme.  Pure:
// takes a tiny { get, set } adapter (so tests can pass a Map-backed
// stub) and a key prefix; returns getters and setters with validation.
const POS = new Set(["TL", "TR", "BL", "BR"]);
const THEME = new Set(["light", "dark", "auto"]);

const DEFAULT_POS = "BR";
const DEFAULT_THEME = "auto";

function validatePos(v) { return POS.has(v) ? v : null; }
function validateTheme(v) { return THEME.has(v) ? v : null; }

function makeStore(gm, prefix) {
  const POS_KEY = prefix + "pos";
  const THEME_KEY = prefix + "theme";
  return {
    getPos() { return validatePos(gm.get(POS_KEY)) || DEFAULT_POS; },
    setPos(v) {
      if (!validatePos(v)) throw new Error("invalid pos: " + v);
      gm.set(POS_KEY, v);
    },
    getTheme() { return validateTheme(gm.get(THEME_KEY)) || DEFAULT_THEME; },
    setTheme(v) {
      if (!validateTheme(v)) throw new Error("invalid theme: " + v);
      gm.set(THEME_KEY, v);
    },
  };
}
;if (root.LSB && root.LSB.__booted) return;
  const LSB = (root.LSB = { __booted: true, version: "1.0.1" });

  // =====================================================================
  // core/config
  // =====================================================================
  LSB.config = Object.freeze({
    site: {
      host: "linux.sb",
      altHosts: ["www.linux.bi"],
      apiBase: "https://linux.sb",
    },
    storage: {
      prefix: "lsb:",
      version: 1,         // bump to invalidate all stored keys
      defaultTTL: 24 * 60 * 60 * 1000, // 24h
    },
    http: {
      timeoutMs: 15000,
      retries: 1,
    },
    modules: {
      user: true,         // extract logged-in user info
      signin: true,       // placeholder, not implemented yet
      ui: true,           // floating panel showing collected info
      debug: false,       // verbose console
    },
    ui: {
      panelPosition: "bottom-right", // bottom-right | bottom-left | top-right | top-left
      panelCollapsible: true,
      // Data-driven: add a new theme by adding to this list + a matching
      // palette in core/palettes.mjs.  Add a new position by adding to
      // the positions map below; CSS is generated from it.
      themes: ["light", "dark", "auto"],
      positions: {
        BR: { bottom: 12, right: 12 },
        BL: { bottom: 12, left: 12 },
        TR: { top: 12, right: 12 },
        TL: { top: 12, left: 12 },
      },
    },
    notif: {
      // Endpoint candidates; first one that returns a notif-shaped page wins.
      // Add or remove paths here when the site changes.
      candidates: ["/notifications", "/notice", "/user/notifications"],
      // Polling config (passed to core/poller.mjs).
      intervalMs: 60_000,
      backoffAfter: 3,
      backoffMs: 5 * 60_000,
    },
    i18n: { defaultLocale: "zh-CN", fallbackLocale: "en" },
    signin: {
      autoSignin: false, // when true, automatically sign in if pending
    },
  });

  // =====================================================================
  // core/logger
  // =====================================================================
  LSB.logger = (function () {
    const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
    const threshold = () => (LSB.config.modules.debug ? LEVELS.debug : LEVELS.info);
    function make(tag) {
      return {
        debug: (...a) => log("debug", tag, a),
        info:  (...a) => log("info",  tag, a),
        warn:  (...a) => log("warn",  tag, a),
        error: (...a) => log("error", tag, a),
      };
    }
    function log(level, tag, args) {
      if (LEVELS[level] < threshold()) return;
      const fn = console[level === "debug" ? "log" : level] || console.log;
      const t = new Date().toISOString().slice(11, 23);
      fn.call(console, `[${t}][lsb][${level}][${tag}]`, ...args);
    }
    return { make };
  })();

  // =====================================================================
  // core/utils
  // =====================================================================
  LSB.utils = {
    isString(v) { return typeof v === "string"; },
    isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); },
    isFunction(v) { return typeof v === "function"; },
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
    now() { return Date.now(); },
    safeJSON(s, fallback) {
      try { return JSON.parse(s); } catch { return fallback; }
    },
    parseUrl(href) {
      try { return new URL(href, location.origin); } catch { return null; }
    },
    pick(obj, keys) {
      const out = {};
      keys.forEach((k) => { if (k in obj) out[k] = obj[k]; });
      return out;
    },
    hashString(s) {
      // FNV-1a 32-bit; small, deterministic, no crypto needed.
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h.toString(16);
    },
  };

  // =====================================================================
  // core/storage  (GM_* backed, with versioning, JSON, TTL)
  // =====================================================================
  LSB.storage = (function () {
    const { prefix, version, defaultTTL } = LSB.config.storage;
    const k = (name) => `${prefix}v${version}:${name}`;
    function get(name) {
      const raw = GM_getValue(k(name), null);
      if (raw == null) return null;
      const rec = LSB.utils.safeJSON(raw, null);
      if (!rec || typeof rec !== "object") return null;
      if (rec.expiresAt && rec.expiresAt < LSB.utils.now()) {
        GM_deleteValue(k(name));
        return null;
      }
      return rec.value;
    }
    function set(name, value, ttlMs) {
      const rec = {
        value,
        expiresAt: ttlMs ? LSB.utils.now() + ttlMs : 0,
        storedAt: LSB.utils.now(),
      };
      GM_setValue(k(name), JSON.stringify(rec));
    }
    function del(name) { GM_deleteValue(k(name)); }
    return { get, set, del };
  })();

  // =====================================================================
  // core/events  (tiny pub/sub)
  // =====================================================================
  LSB.events = (function () {
    const subs = new Map();
    return {
      on(event, fn) {
        if (!subs.has(event)) subs.set(event, new Set());
        subs.get(event).add(fn);
        return () => subs.get(event).delete(fn);
      },
      emit(event, payload) {
        const set = subs.get(event);
        if (!set) return;
        for (const fn of set) {
          try { fn(payload); } catch (err) {
            (LSB.logger.make("events")).error("handler threw for", event, err);
          }
        }
      },
    };
  })();

  // =====================================================================
  // core/http  (fetch with timeout, JSON convenience, GM fallback)
  // =====================================================================
  LSB.http = {
    async fetch(url, opts = {}) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || LSB.config.http.timeoutMs);
      try {
        const res = await fetch(url, {
          credentials: "include",
          signal: ctrl.signal,
          ...opts,
        });
        return res;
      } finally { clearTimeout(t); }
    },
    async text(url, opts) { const r = await this.fetch(url, opts); return r.text(); },
    async json(url, opts) { const r = await this.fetch(url, opts); return r.json(); },
    async getHtml(url) { return this.text(url, { headers: { Accept: "text/html" } }); },
  };

  // =====================================================================
  // core/dom  (wait for selector, onRouteChange, scrape helpers)
  // =====================================================================
  LSB.dom = {
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
    text(el) { return el ? (el.textContent || "").trim() : ""; },
    attr(el, name) { return el ? el.getAttribute(name) : null; },
    href(el) { return el ? (el.getAttribute("href") || "") : ""; },
    src(el) { return el ? (el.src || el.getAttribute("src") || "") : ""; },
    absUrl(href) {
      try { return new URL(href, location.origin).toString(); } catch { return href; }
    },
    async waitFor(selector, { timeout = 10000, root = document } = {}) {
      const start = LSB.utils.now();
      while (LSB.utils.now() - start < timeout) {
        const el = root.querySelector(selector);
        if (el) return el;
        await LSB.utils.sleep(80);
      }
      return null;
    },
    onRouteChange(cb) {
      let lastHref = location.href;
      const tick = () => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          try { cb(lastHref); } catch (err) {
            (LSB.logger.make("dom")).error("route handler threw", err);
          }
        }
      };
      // History API
      const wrap = (name) => {
        const orig = history[name];
        return function () { const r = orig.apply(this, arguments); tick(); return r; };
      };
      history.pushState = wrap("pushState");
      history.replaceState = wrap("replaceState");
      window.addEventListener("popstate", tick);
      // Fallback poll, since the SPA may use other routers.
      setInterval(tick, 500);
    },
  };

  // =====================================================================
  // api/linuxSb  (selectors, URL patterns, response shape)
  // =====================================================================
  // =====================================================================
  // core/i18n, core/settings, core/palettes, core/css, core/dom-sections
  // (inlined at build time from core/*.mjs; the symbols are in the
  // outer scope so this block can use them directly).
  // =====================================================================
  LSB.i18n = (typeof createI18n === "function")
    ? createI18n({ locale: LSB.config.i18n.defaultLocale, fallback: LSB.config.i18n.fallbackLocale })
    : { t: (k) => k, add: () => {}, setLocale: () => {} };
  LSB.i18n.add({
    "panel.title":         { zh: "面板",     en: "Panel" },
    "panel.settings":      { zh: "设置",     en: "Settings" },
    "panel.close":         { zh: "关闭",     en: "Close" },
    "panel.pos":           { zh: "位置",     en: "Position" },
    "panel.theme":         { zh: "主题",     en: "Theme" },
    "panel.pos.BR":        { zh: "右下",     en: "Bottom-right" },
    "panel.pos.BL":        { zh: "左下",     en: "Bottom-left" },
    "panel.pos.TR":        { zh: "右上",     en: "Top-right" },
    "panel.pos.TL":        { zh: "左上",     en: "Top-left" },
    "panel.theme.auto":    { zh: "跟随系统", en: "Follow system" },
    "panel.theme.light":   { zh: "浅色",     en: "Light" },
    "panel.theme.dark":    { zh: "深色",     en: "Dark" },
    "notif.title":         { zh: "通知",     en: "Notifications" },
    "notif.empty":         { zh: "暂无通知", en: "No notifications" },
    "signin.status.signed":   { zh: "已签到",  en: "Signed in" },
    "signin.status.unsigned": { zh: "未签到",  en: "Not signed in" },
    "signin.status.guest":    { zh: "请先登录", en: "Please sign in" },
    "signin.status.unknown":  { zh: "状态不明", en: "Unknown" },
    "signin.auto":         { zh: "自动签到",  en: "Auto sign-in" },
  });
  LSB.settings = (typeof createRegistry === "function") ? createRegistry() : null;
  LSB.sections = (typeof createSectionRegistry === "function") ? createSectionRegistry() : null;

  if (LSB.settings) {
    LSB.settings.register({
      key: "panel.pos", type: "enum", group: "panel",
      label: { zh: "位置", en: "Position" },
      default: "BR", options: Object.keys(LSB.config.ui.positions),
    });
    LSB.settings.register({
      key: "panel.theme", type: "enum", group: "panel",
      label: { zh: "主题", en: "Theme" },
      default: "auto", options: LSB.config.ui.themes,
    });
    LSB.settings.register({
      key: "signin.auto", type: "boolean", group: "signin",
      label: { zh: "自动签到", en: "Auto sign-in" },
      default: false,
    });
  }

    LSB.api = LSB.api || {};
  LSB.api.linuxSb = {
    isHome(href) {
      const u = LSB.utils.parseUrl(href || location.href);
      if (!u) return false;
      return (LSB.config.site.host === u.host || LSB.config.site.altHosts.includes(u.host))
          && (u.pathname === "/" || u.pathname === "/index.php");
    },
    isUserPage(href) {
      const u = LSB.utils.parseUrl(href || location.href);
      return !!u && /^\/user\/\d+/.test(u.pathname);
    },
    isLoginPage(href) {
      const u = LSB.utils.parseUrl(href || location.href);
      return !!u && u.pathname === "/login";
    },
    selectors: {
      navMine:        "a.nav-mine",            // top-right user area (login or profile)
      avatarLink:     "a.avatar-profile-link", // any avatar linking to a user
      title:          "title",
      // Home page sign-in card (varies between states)
      signinCard:     ".signin-card, .daily-signin, [class*=\"signin\"], [class*=\"checkin\"]",
      signinButton:   "button[class*=\"signin\"], button[class*=\"checkin\"], a[class*=\"signin\"]",
      // Right sidebar user card (logged-in home page)
      userCard:       ".sidebar-card.user-card",
      userNameLink:   ".sidebar-card.user-card .user-name",
      userAvatar:     ".sidebar-card.user-card .user-avatar-big img.avatar-img",
      userRank:       ".sidebar-card.user-card .user-rank",
      // Home page sidebar daily checkin card
      dailyCheckinCard:  ".sidebar-card.daily-checkin",
      dailyCheckinStatus: ".daily-checkin-sub",
      // Checkin page form
      checkinForm:      'form.post-action-form[action="/daily_checkin"]',
      checkinBtn:       'form.post-action-form[action="/daily_checkin"] button[type=submit]',
    },
    avatarUrl: {
      // DiceBear bottts-neutral style, ID is hashed via FNV to match site format.
      dicebearForUserId(id) {
        const seed = LSB.utils.hashString(String(id));
        return `https://linux.sb/app/avatars/bottts-neutral_${seed}.svg`;
      },
      // Real uploaded avatar URL — extracted from <img> when present.
      extractFromImg(img) { return img ? (img.src || img.getAttribute("src")) : null; },
    },
  };

  // =====================================================================
  // module registry  (topological init)
  // =====================================================================
  const _registry = new Map();       // name -> { factory, deps, instance, enabled }
  const _pendingInit = [];           // modules whose deps are not yet resolved

  LSB.register = function (name, factory, deps = []) {
    if (_registry.has(name)) {
      (LSB.logger.make("register")).warn("duplicate module:", name);
      return;
    }
    if (!LSB.utils.isFunction(factory)) {
      throw new Error(`LSB.register("${name}"): factory must be a function`);
    }
    _registry.set(name, { factory, deps, instance: null, enabled: true });
  };

  // Resolve a dep name: registry first, then LSB[name] (core namespace).
  function _resolveOne(name, stack) {
    if (stack.has(name)) throw new Error(`circular dependency: ${[...stack, name].join(" -> ")}`);
    stack.add(name);
    const entry = _registry.get(name);
    if (entry) {
      const resolved = {};
      for (const dep of entry.deps) {
        const r = _resolveOne(dep, stack);
        Object.assign(resolved, r.resolved);
      }
      stack.delete(name);
      if (entry.instance) return { resolved: { [name]: entry.instance } };
      return { resolved: { [name]: _initOne(name, entry, resolved) } };
    }
    if (name in LSB) {
      stack.delete(name);
      return { resolved: { [name]: LSB[name] } };
    }
    stack.delete(name);
    (LSB.logger.make("register")).warn(`unknown dependency: ${name}; passing undefined`);
    return { resolved: {} };
  }

  function _initOne(name, entry, deps) {
    try {
      const inst = entry.factory(deps);
      entry.instance = inst;
      (LSB.logger.make("register")).info("initialized", name);
      return inst;
    } catch (err) {
      (LSB.logger.make("register")).error("init failed:", name, err);
      return null;
    }
  }

  function _bootAll() {
    const enabled = LSB.config.modules || {};
    for (const [name, entry] of _registry) {
      entry.enabled = enabled[name] !== false;
    }
    for (const [name, entry] of _registry) {
      if (!entry.enabled) continue;
      try { _resolveOne(name, new Set()); }
      catch (err) { (LSB.logger.make("register")).error(err.message); }
    }
  }

  // =====================================================================
  // module: user  (extract logged-in user info)
  // =====================================================================
  LSB.register("user", function ({ config, dom, events }) {
    const log = LSB.logger.make("user");

    /**
     * Read the current user info from the live DOM.
     * Returns null if not logged in or DOM is not yet rendered.
     * Result shape:
     *   { id, nickname, avatarUrl, avatarIsDicebear, profileUrl, isLoggedIn, source }
     *   source ∈ "nav-mine" | "avatar-link" | "user-page" | "stored"
     */
    async function readFromDom() {
      // 1. nav-mine in top bar (tells us logged-in state and user id).
      const navMine = dom.$("a.nav-mine");
      if (navMine) {
        const text = dom.text(navMine);
        const href = dom.attr(navMine, "href") || "";
        if (/\/login\b/.test(href) || /登录/.test(text)) {
          return null;
        }
        const id = _userIdFromHref(href);
        // The top-bar link only carries a literal label, not the real nickname.
        // Pull nickname / avatar / rank from the right sidebar card.
        const card = dom.$(LSB.api.linuxSb.selectors.userCard);
        const nameEl = card ? dom.$(LSB.api.linuxSb.selectors.userNameLink, card) : null;
        const avatarEl = card ? dom.$(LSB.api.linuxSb.selectors.userAvatar, card) : null;
        const rankEl = card ? dom.$(LSB.api.linuxSb.selectors.userRank, card) : null;
        const nickname = nameEl ? dom.text(nameEl) : null;
        const avatarUrl = avatarEl ? dom.src(avatarEl) : null;
        return {
          id: id || null,
          nickname: nickname || null,
          avatarUrl: avatarUrl || null,
          avatarIsDicebear: !!avatarUrl && /dicebear|\/avatars\//i.test(avatarUrl),
          profileUrl: href ? dom.absUrl(href) : null,
          rank: rankEl ? dom.text(rankEl) : null,
          isLoggedIn: true,
          source: "user-card",
        };
      }
      // 2. any avatar-profile-link on page (post author etc.)
      const link = dom.$("a.avatar-profile-link");
      if (link) {
        const href = dom.attr(link, "href") || "";
        const img = dom.$("img", link);
        const id = _userIdFromHref(href);
        if (id) {
          return {
            id,
            nickname: dom.attr(img, "alt") || null,
            avatarUrl: dom.src(img) || null,
            avatarIsDicebear: !!img && /dicebear/i.test(dom.src(img) || ""),
            profileUrl: dom.absUrl(href),
            isLoggedIn: false, // unknown from here
            source: "avatar-link",
          };
        }
      }
      return null;
    }

    /**
     * Fetch the user page and parse richer info (signin count, joined date, etc.).
     * Only used as a fallback if DOM is incomplete.
     */
    async function readFromUserPage(userId) {
      if (!userId) return null;
      const url = `${config.site.apiBase}/user/${userId}`;
      try {
        const html = await LSB.http.getHtml(url);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const title = dom.text(doc.querySelector("title"));
        const nickname = (title || "").split(" - ")[0].trim() || null;
        const img = doc.querySelector("img");
        return {
          id: userId,
          nickname,
          avatarUrl: dom.src(img) || LSB.api.linuxSb.avatarUrl.dicebearForUserId(userId),
          avatarIsDicebear: /dicebear/i.test(dom.src(img) || ""),
          profileUrl: url,
          isLoggedIn: true,
          source: "user-page",
          raw: { title },
        };
      } catch (err) {
        log.warn("user page fetch failed", err);
        return null;
      }
    }

    function _userIdFromHref(href) {
      const m = (href || "").match(/\/user\/(\d+)/);
      return m ? Number(m[1]) : null;
    }

    /**
     * Public API: get the current user.
     * Caches to GM_* for cross-page consistency (TTL 1h by default).
     * On every call, also re-reads the DOM to capture updates (nickname change, etc).
     * Emits user:changed only when the value actually changes, to avoid feedback loops
     * with subscribers (e.g. ui.refresh) that re-invoke getCurrent.
     */
    let _lastEmittedKey = null;
    async function getCurrent() {
      let fromDom = null;
      try { fromDom = await readFromDom(); } catch (err) { log.warn("dom read failed", err); }
      const cached = LSB.storage.get("user.current");
      if (fromDom) {
        // Persist a normalized version.
        const normalized = normalize(fromDom);
        LSB.storage.set("user.current", normalized, LSB.config.storage.defaultTTL);
        const key = JSON.stringify(normalized);
        if (key !== _lastEmittedKey) {
          _lastEmittedKey = key;
          events.emit("user:changed", normalized);
        }
        return normalized;
      }
      if (cached) return cached;
      // Last resort: nothing on the page yet. Return null and let caller decide.
      return null;
    }

    function isLoggedIn() {
      const navMine = dom.$("a.nav-mine");
      if (!navMine) return false;
      const href = dom.attr(navMine, "href") || "";
      return !/\/login\b/.test(href) && !/登录/.test(dom.text(navMine));
    }

    function normalize(info) {
      if (!info) return null;
      return LSB.utils.pick(info, [
        "id", "nickname", "avatarUrl", "avatarIsDicebear",
        "profileUrl", "isLoggedIn", "source", "rank",
      ]);
    }

    // Re-emit when route changes (user might log in/out in another tab, etc).
    dom.onRouteChange(async () => {
      const u = await getCurrent();
      events.emit("user:route-changed", u);
    });

    return {
      name: "user",
      getCurrent,
      isLoggedIn,
      readFromDom,
      readFromUserPage,
    };
  }, ["config", "dom", "events"]);

  // =====================================================================
  // module: signin  (detect / trigger daily checkin)
  // =====================================================================
  LSB.register("signin", function ({ config, dom, events, http, user }) {
    const log = LSB.logger.make("signin");
    const CHECKIN_URL = `${config.site.apiBase}/daily_checkin`;

    /** Heuristic status detection from a DOM context. */
    function _statusFromNode(node) {
      if (!node) return null;
      const text = dom.text(node);
      if (/\u4eca\u5929\u5f85\u7b7e\u5230|\u672a\u7b7e\u5230/.test(text)) return "not-signed-in";
      if (/\u5df2\u7b7e\u5230|\u5df2\u8fde\u7eed\u7b7e\u5230|\u4eca\u65e5\u5df2\u7b7e/.test(text)) return "signed-in";
      if (/\u8bf7\u5148\u767b\u5f55/.test(text)) return "guest";
      return null;
    }

    /** Read status from the current page if possible. */
    function _statusFromCurrentPage() {
      // 1) checkin page itself
      if (/\/daily_checkin(?:$|\?|#)/.test(location.pathname)) {
        const btn = dom.$(LSB.api.linuxSb.selectors.checkinBtn);
        if (btn) {
          const t = dom.text(btn);
          if (/\u5df2\u7b7e\u5230/.test(t)) return { status: "signed-in", source: "checkin-page" };
          if (/\u7b7e\u5230/.test(t)) return { status: "not-signed-in", source: "checkin-page" };
        }
        // Fallback: look for the page-level status block.
        const sub = document.querySelector(".daily-checkin-sub");
        if (sub) {
          const s = _statusFromNode(sub);
          if (s) return { status: s, source: "checkin-page" };
        }
      }
      // 2) home page sidebar card
      const sub = dom.$(LSB.api.linuxSb.selectors.dailyCheckinStatus);
      if (sub) {
        const s = _statusFromNode(sub);
        if (s) return { status: s, source: "home-sidebar" };
      }
      return null;
    }

    /** Fetch /daily_checkin and parse status + csrf. */
    async function _fetchStatus() {
      const html = await LSB.http.getHtml(CHECKIN_URL);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const sub = doc.querySelector(".daily-checkin-sub");
      const s = sub ? _statusFromNode({
        textContent: sub.textContent,
      }) : null;
      const btn = doc.querySelector(LSB.api.linuxSb.selectors.checkinBtn);
      const csrfInput = doc.querySelector(`form[action="/daily_checkin"] input[name="_csrf"]`);
      return {
        status: s || "unknown",
        source: "http-fetch",
        csrf: csrfInput ? csrfInput.getAttribute("value") : null,
        hasForm: !!btn,
      };
    }

    /** Public: get current signin status. */
    async function getStatus() {
      const cur = _statusFromCurrentPage();
      if (cur) return cur;
      try {
        return await _fetchStatus();
      } catch (err) {
        log.warn("status fetch failed", err);
        return { status: "unknown", reason: err.message };
      }
    }

    /** Public: perform a signin. Returns { ok, status, ... }. */
    async function performSignin() {
      // Already on the checkin page? Just click the button.
      if (/\/daily_checkin(?:$|\?|#)/.test(location.pathname)) {
        const btn = dom.$(LSB.api.linuxSb.selectors.checkinBtn);
        if (btn) {
          const t = dom.text(btn);
          if (/\u5df2\u7b7e\u5230/.test(t)) {
            return { ok: true, status: "signed-in", source: "already-on-page" };
          }
          btn.click();
          return { ok: true, status: "submitted", source: "clicked" };
        }
      }
      // Otherwise fetch the checkin page, grab the CSRF, POST it.
      const fetched = await _fetchStatus();
      if (fetched.status === "signed-in") {
        return { ok: true, status: "signed-in", source: fetched.source };
      }
      if (!fetched.csrf) {
        return { ok: false, status: fetched.status, reason: "no-csrf-token" };
      }
      const body = new URLSearchParams({ _csrf: fetched.csrf }).toString();
      const res = await LSB.http.fetch(CHECKIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      // We can't always read the response body (it may redirect). Check current status.
      const after = await _fetchStatus();
      return {
        ok: res.ok || after.status === "signed-in",
        status: after.status,
        source: "http-post",
        httpStatus: res.status,
      };
    }

    /** Public: check status, sign in if pending. Returns the action taken. */
    async function ensureSignedIn() {
      const s = await getStatus();
      if (s.status === "signed-in") {
        events.emit("signin:status-changed", s);
        return { ok: true, status: "signed-in", action: "none" };
      }
      if (s.status === "guest") {
        events.emit("signin:status-changed", s);
        return { ok: false, status: "guest", reason: "not-logged-in" };
      }
      if (s.status === "not-signed-in") {
        const r = await performSignin();
        events.emit("signin:status-changed", r);
        return { ...r, action: "signed-in" };
      }
      events.emit("signin:status-changed", { status: s.status });
      return { ok: false, status: s.status, reason: "unknown" };
    }

        /** Public: read the persisted auto-signin preference. */
    function getAutoSignin() {
      const v = LSB.storage.get("signin.autoSignin");
      if (v === true || v === false) return v;
      return !!config.signin.autoSignin;
    }
    function setAutoSignin(on) {
      LSB.storage.set("signin.autoSignin", !!on, 0);
      events.emit("signin:auto-changed", !!on);
    }

    // Auto signin: run on user:changed whenever the toggle is on. No _autoRan
    // guard so each page refresh can re-check (user wants this).
    events.on("user:changed", async (u) => {
      if (!u || !u.isLoggedIn) return;
      if (!getAutoSignin()) return;
      try {
        const r = await ensureSignedIn();
        log.info("auto signin result", r);
        events.emit("signin:auto", r);
      } catch (err) { log.warn("auto signin failed", err); }
    });

    return {
      name: "signin",
      getStatus,
      performSignin,
      ensureSignedIn,
      getAutoSignin,
      setAutoSignin,
    };
  }, ["config", "dom", "events", "http", "user"]);

    // module: ui  (floating panel showing user info)
  // =====================================================================
  LSB.register("panelStyle", function ({ config, events }) {
    const log = LSB.logger.make("panelStyle");
    if (!LSB.settings) {
      log.warn("settings registry unavailable; panelStyle no-op");
      return { name: "panelStyle", init() {} };
    }
    const pos = LSB.settings.get("panel.pos");
    const theme = LSB.settings.get("panel.theme");

    LSB.panelStyle = {
      get pos() { return pos.get(); },
      get theme() { return theme.get(); },
      set(patch) {
        if (patch && patch.pos != null) pos.set(patch.pos);
        if (patch && patch.theme != null) theme.set(patch.theme);
        events.emit("panel:reapply", { pos: this.pos, theme: this.theme });
      },
    };

    pos.subscribe((v) => events.emit("panel:reapply", { pos: v, theme: theme.get() }));
    theme.subscribe((v) => events.emit("panel:reapply", { pos: pos.get(), theme: v }));

    return {
      name: "panelStyle",
      init() { events.emit("panel:reapply", { pos: pos.get(), theme: theme.get() }); },
    };
  });

  LSB.register("notif", function ({ config, http, events, user }) {
    const log = LSB.logger.make("notif");
    if (typeof makePoller !== "function" || typeof probeEndpoint !== "function" || typeof parseNotifications !== "function") {
      log.warn("lib not inlined; notif disabled");
      return { name: "notif", init() {} };
    }

    const state = { unread: 0, list: [], endpoint: null, lastFetchAt: 0, lastError: null };
    LSB.notif = { state, start, stop, refresh };

    let poller = null;
    let userBound = false;

    function isLoggedIn() { return !!(user && user.info && user.info.id); }

    async function discoverEndpoint() {
      if (state.endpoint) return state.endpoint;
      const cached = (typeof GM_getValue === "function") ? GM_getValue("lsb:notif:endpoint", null) : null;
      if (cached) { state.endpoint = cached; return cached; }
      const endpoint = await probeEndpoint(http, config.site.apiBase, config.notif.candidates);
      if (endpoint) {
        state.endpoint = endpoint;
        if (typeof GM_setValue === "function") GM_setValue("lsb:notif:endpoint", endpoint);
      }
      return endpoint;
    }

    async function refresh() {
      const endpoint = await discoverEndpoint();
      if (!endpoint) return;
      const html = await http.getHtml(endpoint);
      const { unread, list } = parseNotifications(html);
      state.unread = unread;
      state.list = list;
      state.lastFetchAt = Date.now();
      state.lastError = null;
      events.emit("notif:updated", { unread, list });
      log.debug("refreshed", unread, list.length);
    }

    function bindUser() {
      if (userBound) return;
      userBound = true;
      events.on("user:changed", () => { if (isLoggedIn()) start(); else stop(); });
      if (isLoggedIn()) start();
    }

    function start() {
      if (poller) return;
      poller = makePoller({ name: "notif", onTick: refresh, intervalMs: config.notif.intervalMs, backoffAfter: config.notif.backoffAfter, backoffMs: config.notif.backoffMs });
      poller.start();
      log.info("started");
    }
    function stop() {
      if (!poller) return;
      poller.stop();
      poller = null;
      state.unread = 0; state.list = []; state.lastError = null;
      events.emit("notif:updated", { unread: 0, list: [] });
      log.info("stopped");
    }

    if (LSB.sections) {
      LSB.sections.register("notif", {
        order: 0,
        hidden: () => !isLoggedIn(),
        render: () => ({
          innerHTML:
            `<div class="lsb-section lsb-notif" data-lsb="notif-section">` +
            `<div class="lsb-section-title">${LSB.i18n.t("notif.title")} (<span data-lsb="notif-count">0</span>)</div>` +
            `<ul class="lsb-notif-list" data-lsb="notif-list"></ul>` +
            `</div>`,
        }),
      });
    }

    return { name: "notif", init: bindUser };
  });

  LSB.register("ui", function ({ config, dom, events, user, signin }) {
    const log = LSB.logger.make("ui");
    const log_user = LSB.logger.make("ui/user");
    const log_signin = LSB.logger.make("ui/signin");

    GM_addStyle(`
      #lsb-panel {
        position: fixed; z-index: 2147483646;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: #eee;
        background: rgba(20, 22, 28, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        user-select: none;
        max-width: 280px;
        min-width: 140px;
        overflow: hidden;
      }
      #lsb-panel.lsb-pos-br { bottom: 12px; right: 12px; }
      #lsb-panel.lsb-pos-bl { bottom: 12px; left: 12px; }
      #lsb-panel.lsb-pos-tr { top: 12px; right: 12px; }
      #lsb-panel.lsb-pos-tl { top: 12px; left: 12px; }

      #lsb-panel .lsb-compact {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 10px 6px 8px;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      #lsb-panel .lsb-compact:hover { background: rgba(255, 255, 255, 0.04); }
      #lsb-panel .lsb-avatar {
        width: 22px; height: 22px; border-radius: 50%;
        background: #2a2d35; flex: none;
        object-fit: cover;
      }
      #lsb-panel .lsb-name {
        font-weight: 600; font-size: 13px;
        max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #lsb-panel .lsb-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #555; flex: none;
        transition: background 0.2s ease;
      }
      #lsb-panel .lsb-dot.lsb-loading  { background: #666; }
      #lsb-panel .lsb-dot.lsb-signed   { background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.45); }
      #lsb-panel .lsb-dot.lsb-unsigned { background: #fbbf24; box-shadow: 0 0 6px rgba(251, 191, 36, 0.45); }
      #lsb-panel .lsb-dot.lsb-guest    { background: #6b7280; }
      #lsb-panel [hidden] { display: none !important; }
      #lsb-panel .lsb-chevron {
        margin-left: auto; opacity: 0.5; font-size: 11px;
        transition: transform 0.2s ease;
      }
      #lsb-panel.lsb-open .lsb-chevron { transform: rotate(180deg); }

      #lsb-panel .lsb-details {
        display: none;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        padding: 10px 12px 8px;
        font-size: 12px;
      }
      #lsb-panel.lsb-open .lsb-details { display: block; }

      #lsb-panel .lsb-row { display: flex; align-items: center; gap: 8px; }
      #lsb-panel .lsb-row + .lsb-row { margin-top: 8px; }
      #lsb-panel .lsb-meta { color: #9ca3af; font-size: 11px; }
      #lsb-panel .lsb-signin-row {
        display: flex; align-items: center; justify-content: center;
        min-height: 28px; margin-top: 4px;
      }
      #lsb-panel .lsb-signed-text {
        color: #4ade80; font-size: 13px; font-weight: 600;
      }
      #lsb-panel .lsb-rank-row {
        display: flex; justify-content: center;
        margin-top: 4px;
      }

      #lsb-panel .lsb-action {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin-top: 10px;
      }
      #lsb-panel .lsb-action .lsb-label { color: #d1d5db; }
      #lsb-panel .lsb-btn {
        appearance: none; border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #f3f4f6;
        font: inherit; font-size: 12px;
        padding: 4px 10px; border-radius: 6px;
        cursor: pointer;
        transition: background 0.12s ease, border-color 0.12s ease;
      }
      #lsb-panel .lsb-btn:hover { background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.2); }
      #lsb-panel .lsb-btn.lsb-primary { background: #4ade80; color: #052e16; border-color: transparent; font-weight: 600; }
      #lsb-panel .lsb-btn.lsb-primary:hover { background: #22c55e; }
      #lsb-panel .lsb-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      #lsb-panel .lsb-switch {
        position: relative; display: inline-block;
        width: 32px; height: 18px; flex: none;
      }
      #lsb-panel .lsb-switch input { opacity: 0; width: 0; height: 0; }
      #lsb-panel .lsb-switch .lsb-slider {
        position: absolute; inset: 0;
        background: #4b5563; border-radius: 999px;
        transition: background 0.18s ease;
        cursor: pointer;
      }
      #lsb-panel .lsb-switch .lsb-slider::before {
        content: ""; position: absolute;
        left: 2px; top: 2px;
        width: 14px; height: 14px;
        background: #f9fafb; border-radius: 50%;
        transition: transform 0.18s ease;
      }
      #lsb-panel .lsb-switch input:checked + .lsb-slider { background: #4ade80; }
      #lsb-panel .lsb-switch input:checked + .lsb-slider::before { transform: translateX(14px); }

      #lsb-panel .lsb-footer {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 10px; padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 11px; color: #6b7280;
      }
      #lsb-panel .lsb-footer a {
        color: #9ca3af; text-decoration: none;
      }
      #lsb-panel .lsb-footer a:hover { color: #e5e7eb; text-decoration: underline; }
    `);

    const root = document.createElement("div");
    root.id = "lsb-panel";
    root.className = "lsb-pos-br";
    root.innerHTML = `
      <div class="lsb-compact" data-lsb="compact">
        <img class="lsb-avatar" data-lsb="avatar" alt="" />
        <span class="lsb-name" data-lsb="name">…</span>
        <span class="lsb-dot lsb-loading" data-lsb="dot" title="载入中"></span>
        <span class="lsb-chevron">▾</span>
      </div>
      <div class="lsb-details">
        <div class="lsb-signin-row">
          <span data-lsb="signin-text" class="lsb-signed-text" hidden>✓ 已签到</span>
          <button class="lsb-btn lsb-primary" data-lsb="signin" hidden>立即签到</button>
        </div>
        <div class="lsb-rank-row" data-lsb="rank-row">
          <span class="lsb-meta" data-lsb="rank">—</span>
        </div>
        <div class="lsb-action">
          <span class="lsb-label">自动签到</span>
          <label class="lsb-switch">
            <input type="checkbox" data-lsb="auto" />
            <span class="lsb-slider"></span>
          </label>
        </div>
        <div class="lsb-footer">
          <a data-lsb="profile" href="#" target="_blank" rel="noopener">个人主页</a>
          <span data-lsb="version">v0.0.0</span>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);

    const $ = (key) => root.querySelector(`[data-lsb="${key}"]`);
    const dot = $("dot");
    const nameEl = $("name");
    const avatarEl = $("avatar");
    const signinBtn = $("signin");
    const autoInput = $("auto");
    const profileLink = $("profile");
    const versionEl = $("version");
    versionEl.textContent = `v${LSB.version}`;

    $("compact").addEventListener("click", (ev) => {
      if (ev.target.closest("[data-lsb]") && ev.target.dataset.lsb !== "compact") return;
      root.classList.toggle("lsb-open");
    });
    document.addEventListener("click", (ev) => {
      if (!root.classList.contains("lsb-open")) return;
      if (root.contains(ev.target)) return;
      root.classList.remove("lsb-open");
    });

    autoInput.addEventListener("change", () => {
      const next = autoInput.checked;
      signin.setAutoSignin(next);
      log_user.info("auto-signin toggled", next);
    });

    signinBtn.addEventListener("click", async () => {
      signinBtn.disabled = true;
      const orig = signinBtn.textContent;
      signinBtn.textContent = "签到中…";
      try {
        const r = await signin.performSignin();
        signinBtn.textContent = r.ok ? "已签到" : "签到失败";
        if (r.ok) setTimeout(() => refresh().catch(() => {}), 600);
      } catch (err) {
        signinBtn.textContent = "签到失败";
        log_signin.warn(err);
      } finally {
        signinBtn.disabled = false;
        setTimeout(() => { signinBtn.textContent = orig; }, 1500);
      }
    });

    function _signinLabel(status) {
      return {
        "signed-in": "已签到",
        "not-signed-in": "未签到",
        "guest": "请先登录",
        "unknown": "状态不明",
      }[status] || status;
    }

    function _position() {
      const pos = config.ui.panelPosition || "bottom-right";
      root.classList.remove("lsb-pos-br", "lsb-pos-bl", "lsb-pos-tr", "lsb-pos-tl");
      const map = { "bottom-right": "lsb-pos-br", "bottom-left": "lsb-pos-bl", "top-right": "lsb-pos-tr", "top-left": "lsb-pos-tl" };
      root.classList.add(map[pos] || "lsb-pos-br");
    }
    _position();

    async function refresh() {
      const u = await user.getCurrent();
      if (!u) {
        avatarEl.removeAttribute("src");
        nameEl.textContent = "未登录";
        dot.className = "lsb-dot lsb-guest";
        dot.title = "未登录";
        signinText.hidden = true;
        signinBtn.hidden = true;
        $("rank-row").hidden = true;
        profileLink.removeAttribute("href");
        return;
      }
      if (u.avatarUrl) avatarEl.src = u.avatarUrl;
      nameEl.textContent = u.nickname || `用户 #${u.id}`;
      if (u.profileUrl) profileLink.href = u.profileUrl;

      if (typeof signin.getAutoSignin === "function") {
        autoInput.checked = !!signin.getAutoSignin();
      }

      const signinText = $("signin-text");
      try {
        const s = await signin.getStatus();
        const dotCls = {
          "signed-in": "lsb-signed",
          "not-signed-in": "lsb-unsigned",
          "guest": "lsb-guest",
        }[s.status] || "lsb-loading";
        dot.className = "lsb-dot " + dotCls;
        dot.title = _signinLabel(s.status);
        const isSigned = s.status === "signed-in";
        const isPending = s.status === "not-signed-in";
        signinText.hidden = !isSigned;
        signinBtn.hidden = !isPending;
        $("rank-row").hidden = !(isSigned || isPending);
        const rankTxt = u.rank ? u.rank.replace(/\s*·\s*/, " | ") : "—";
        $("rank").textContent = "等级: " + rankTxt;
      } catch (err) {
        signinText.hidden = true;
        signinBtn.hidden = true;
        log_signin.warn(err);
      }
    }

    events.on("user:changed", () => refresh().catch((e) => log_user.warn(e)));
    events.on("user:route-changed", () => refresh().catch((e) => log_user.warn(e)));
    events.on("signin:status-changed", () => refresh().catch((e) => log_user.warn(e)));

    refresh().catch((e) => log.warn(e));

    return { name: "ui", refresh };
  }, ["config", "dom", "events", "user", "signin"]);

  // =====================================================================
  // module: debug  (console banner + env dump)
  // =====================================================================
  LSB.register("debug", function ({ config }) {
    const log = LSB.logger.make("debug");
    log.info("booted, version", LSB.version);
    log.info("config", JSON.parse(JSON.stringify(config)));
    log.info("location", location.href);
    return { name: "debug" };
  }, ["config"]);

  // =====================================================================
  // bootstrap
  // =====================================================================
  function start() {
    try { _bootAll(); }
    catch (err) { (LSB.logger.make("boot")).error("boot failed", err); }
    // Expose a tiny API for other userscripts and the devtools console.
    LSB.api.getCurrentUser = () => {
      const m = _registry.get("user");
      return m && m.instance ? m.instance.getCurrent() : null;
    };
    LSB.api.refreshUI = () => {
      const m = _registry.get("ui");
      return m && m.instance ? m.instance.refresh() : null;
    };
    (LSB.logger.make("boot")).info("linux.sb Suite ready. Try LSB.api.getCurrentUser() in console.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
