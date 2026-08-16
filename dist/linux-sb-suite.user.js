// ==UserScript==
// @name         linux.sb 助手 / linux.sb Suite
// @namespace    https://github.com/vfhky/linux-sb-pro
// @version      1.2.3
// @description  为 linux.sb (linux.bi) 论坛开发的 Tampermonkey 油猴脚本。在页面右下角显示登录用户信息、未读消息、每日签到状态，支持一键签到、自动签到以及面板位置/主题设置。模块化核心 (logger/storage/events/http/dom/i18n/settings/poller/palettes/css/sections) + 可扩展 UI 架构。 | linux.sb Suite: floating panel with notifications, check-in, auto sign-in, panel position/theme, settings popover.
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
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
/*
 * linux.sb Suite  -- public build
 * built: 2026-08-16T14:52:10.738Z
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
 *     |     http     native fetch wrapper with timeout, cookie-aware
 *     |     events   tiny pub/sub used by modules
 *     |     dom      waitForElement, onRouteChange, scrape helpers
 *     |
 *     +-- modules/   (each module is independent, registers itself)
 *     |     user     extract logged-in user info from the page (this module)
 *     |     signin   detect / trigger daily check-in (manual + auto)
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

// [palette field, CSS variable] — the full set of design tokens emitted per
// theme.  The ui module reuses this table to apply tokens at runtime.
const PALETTE_TOKENS = [
  ["bg", "--lsb-bg"],
  ["bgCard", "--lsb-bg-card"],
  ["bgHover", "--lsb-bg-hover"],
  ["bgEl", "--lsb-bg-el"],
  ["fg", "--lsb-fg"],
  ["fgSec", "--lsb-fg-sec"],
  ["fgMut", "--lsb-fg-mut"],
  ["accent", "--lsb-accent"],
  ["accentLight", "--lsb-accent-light"],
  ["accent2", "--lsb-accent2"],
  ["accent2Light", "--lsb-accent2-light"],
  ["accent3", "--lsb-accent3"],
  ["ok", "--lsb-ok"],
  ["okLight", "--lsb-ok-light"],
  ["okBg", "--lsb-ok-bg"],
  ["warn", "--lsb-warn"],
  ["warnBg", "--lsb-warn-bg"],
  ["danger", "--lsb-danger"],
  ["errLight", "--lsb-err-light"],
  ["errBg", "--lsb-err-bg"],
  ["border", "--lsb-border"],
  ["borderStrong", "--lsb-border-strong"],
  ["borderAccent", "--lsb-border-accent"],
  ["scrollbar", "--lsb-scrollbar"],
  ["scrollbarHover", "--lsb-scrollbar-hover"],
  ["shadow", "--lsb-shadow"],
  ["glow", "--lsb-glow"],
];

function panelPositionCss(positions) {
  const sides = ["top", "right", "bottom", "left"];
  return Object.entries(positions)
    .map(([pos, off]) => {
      const decls = sides.map((s) => {
        const v = off[s];
        if (v == null) return s + ":auto;";
        // numbers → px, strings (e.g. "50%") pass through
        return s + ":" + (typeof v === "number" ? v + "px" : v) + ";";
      }).join("");
      // Vertical-centering positions (e.g. RC: right-center) translate along Y.
      const transform = off.centerY ? "transform:translateY(-50%);" : "";
      return "#lsb-panel[data-pos=\"" + pos + "\"]{" + decls + transform + "}";
    })
    .join("\n");
}

function panelThemeCss(palettes) {
  return Object.entries(palettes)
    .map(([name, p]) => {
      const decls = PALETTE_TOKENS
        .map(([field, cssVar]) => (p[field] != null ? cssVar + ":" + p[field] : null))
        .filter(Boolean)
        .join(";");
      return "#lsb-panel[data-theme=\"" + name + "\"]{" + decls + ";}";
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
    sections.set(name, {
      order: def.order || 0,
      render: def.render,
      hidden: def.hidden || (() => false),
      pane: def.pane || null, // optional pane name; render() filters by ctx.pane
    });
  }
  function unregister(name) { sections.delete(name); }
  function list() { return Array.from(sections.entries()).sort((a, b) => a[1].order - b[1].order); }
  function render(ctx) {
    const pane = ctx && ctx.pane ? ctx.pane : null;
    let innerHTML = "";
    for (const [, def] of list()) {
      // pane-scoped sections only render into their pane's host.
      if (pane && def.pane && def.pane !== pane) continue;
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
// Theme palettes (design tokens) — the FULL verified LDStatus Pro token set
// (#ldsp-panel / #ldsp-panel.light in ldstatuspro.user.js) so the panel
// shares its exact dark/light color design.
const PALETTES = {
  light: {
    // surfaces — clean bright light theme (no gray cast)
    bg: "#ffffff",
    bgCard: "rgba(247,249,253,0.96)",
    bgHover: "rgba(238,242,250,0.96)",
    bgEl: "rgba(255,255,255,0.96)",
    // text
    fg: "#1e2030",
    fgSec: "#4a5068",
    fgMut: "#8590a6",
    // accents
    accent: "#5070d0",
    accentLight: "#6b8cef",
    accent2: "#4a9e8f",
    accent2Light: "#5bb5a6",
    accent3: "#d45d6e",
    // status
    ok: "#4a9e8f",
    okLight: "#5bb5a6",
    okBg: "rgba(74,158,143,0.08)",
    warn: "#c49339",
    warnBg: "rgba(196,147,57,0.08)",
    danger: "#d45d6e",
    errLight: "#e07a8d",
    errBg: "rgba(212,93,110,0.08)",
    // borders
    border: "rgba(0,0,0,0.08)",
    borderStrong: "rgba(0,0,0,0.1)",
    borderAccent: "rgba(80,112,208,0.2)",
    scrollbar: "rgba(15,23,42,0.18)",
    scrollbarHover: "rgba(15,23,42,0.34)",
    shadow: "0 20px 48px rgba(30,41,80,0.16)",
    glow: "0 0 0 1px rgba(80,112,208,0.22), 0 20px 48px rgba(30,41,80,0.18)",
  },
  dark: {
    // surfaces
    bg: "#12131a",
    bgCard: "rgba(24,26,36,0.92)",
    bgHover: "rgba(38,42,56,0.95)",
    bgEl: "rgba(32,35,48,0.88)",
    // text
    fg: "#e4e6ed",
    fgSec: "#9499ad",
    fgMut: "#5d6275",
    // accents
    accent: "#6b8cef",
    accentLight: "#8aa4f4",
    accent2: "#5bb5a6",
    accent2Light: "#7cc9bc",
    accent3: "#e07a8d",
    // status
    ok: "#5bb5a6",
    okLight: "#7cc9bc",
    okBg: "rgba(91,181,166,0.12)",
    warn: "#d4a853",
    warnBg: "rgba(212,168,83,0.12)",
    danger: "#e07a8d",
    errLight: "#ea9aa8",
    errBg: "rgba(224,122,141,0.12)",
    // borders
    border: "rgba(255,255,255,0.06)",
    borderStrong: "rgba(255,255,255,0.1)",
    borderAccent: "rgba(107,140,239,0.3)",
    scrollbar: "rgba(140,150,175,0.5)",
    scrollbarHover: "rgba(140,150,175,0.7)",
    shadow: "0 20px 48px rgba(0,0,0,0.4)",
    glow: "0 0 0 1px rgba(107,140,239,0.2), 0 20px 48px rgba(0,0,0,0.5)",
  },
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
// `document` object so tests can run without a real DOM.  An optional
// `leader` gate ({ isLeader() }) makes only the leader tab tick, which
// pairs with lib/tab-leader.mjs for multi-tab coordination.
function makePoller({ name, onTick, intervalMs = 60_000, backoffAfter = 3, backoffMs = 5 * 60_000, leader = null, document: doc = (typeof document !== "undefined" ? document : null) } = {}) {
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
    // Multi-tab gate: only the leader tab ticks; followers just reschedule.
    if (leader && typeof leader.isLeader === "function" && !leader.isLeader()) { schedule(); return; }
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
// I/O layer for the daily checkin flow. Takes an http adapter so tests
// can stub it. parseCheckinPage is the pure parser; this module wraps it
// with the fetch + submit dance.

function createCheckinIO({ http, base }) {
  const URL = `${base}/daily_checkin`;

  async function fetchStatus() {
    const html = await http.getHtml(URL);
    return { ...parseCheckinPage(html), source: "http-fetch" };
  }

  async function submit() {
    const before = await fetchStatus();
    if (before.status === "signed-in") {
      return { ok: true, status: "signed-in", action: "none", source: "http-fetch", stats: before.stats };
    }
    if (!before.csrf) {
      return { ok: false, status: before.status, reason: "no-csrf-token", source: "http-fetch", stats: before.stats };
    }
    const body = new URLSearchParams({ _csrf: before.csrf }).toString();
    const res = await http.fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const after = await fetchStatus();
    return {
      ok: res.ok || after.status === "signed-in",
      status: after.status,
      action: "signed-in",
      source: "http-post",
      httpStatus: res.status,
      stats: after.stats,
    };
  }

  return { fetchStatus, submit, url: URL };
}

;
// Parse a linux.sb daily checkin page (or sidebar card HTML) into a
// structured { status, csrf, hasForm, stats } object.
//
// Two layouts are supported:
//   1. Dedicated /daily_checkin page:
//      <div class="admin-plugin-summary"><strong>每日签到</strong><span>今天待签到</span></div>
//      <form class="post-action-form" action="/daily_checkin">
//        <input name="_csrf" value="...">
//        <button type="submit" class="daily-checkin-btn">签到</button>
//      </form>
//   2. Home sidebar card:
//      <div class="card sidebar-card daily-checkin-card">
//        <div class="daily-checkin-sub">今天待签到</div>
//        <form class="post-action-form" action="/daily_checkin">...</form>
//        (or, in done state, <div class="daily-checkin-done">已完成</div>)
//      </div>
//
// In both cases the parser is structure-agnostic: it looks for status
// text first, then csrf / form presence, then stats.

const STATUS_ZH = {
  "今天待签到": "not-signed-in",
  "今天已签到": "signed-in",
  "今日已签到": "signed-in",
  "已连续签到": "signed-in",
  "已签到": "signed-in",
  "未签到": "not-signed-in",
  "立即签到": "not-signed-in",
  "签到": "not-signed-in",
  "请先登录": "guest",
};

function detectStatus(text) {
  if (!text) return "unknown";
  for (const [zh, en] of Object.entries(STATUS_ZH)) {
    if (text.includes(zh)) return en;
  }
  return "unknown";
}

function findText(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function parseCheckinPage(html) {
  if (typeof html !== "string" || !html) {
    return { status: "unknown", csrf: null, hasForm: false, stats: { streak: 0, total: 0 } };
  }

  // Status text sources, in priority order.
  // 1) .admin-plugin-summary span (dedicated checkin page)
  // 2) .daily-checkin-sub (sidebar card)
  // 3) button text (legacy / fallback)
  const statusText = findText(html, [
    /<[^>]*class\s*=\s*["'][^"']*\badmin-plugin-summary\b[^"']*["'][\s\S]*?<span[^>]*>([\s\S]*?)<\//i,
    /<[^>]*class\s*=\s*["'][^"']*\bdaily-checkin-sub\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
    /<button\b[^>]*>([\s\S]*?)<\/button>/i,
  ]);

  // CSRF token from the checkin form (must be inside a form with action /daily_checkin).
  const csrfMatch = html.match(
    /<form\b[^>]*action\s*=\s*["']\/daily_checkin["'][^>]*>[\s\S]*?<input\b[^>]*name\s*=\s*["']_csrf["'][^>]*value\s*=\s*["']([^"']+)["']/i
  );

  // Form presence.
  const hasForm = /<form\b[^>]*action\s*=\s*["']\/daily_checkin["']/i.test(html);

  // Stats: pair of <strong>N</strong><span>label</span>.
  const stats = { streak: 0, total: 0 };
  const statRe = /<strong>(\d+)<\/strong>\s*<span>([^<]+)<\/span>/gi;
  let m;
  while ((m = statRe.exec(html)) !== null) {
    const n = Number(m[1]);
    const label = m[2].trim();
    if (/连续/.test(label)) stats.streak = n;
    else if (/累计/.test(label)) stats.total = n;
  }

  return {
    status: detectStatus(statusText || ""),
    csrf: csrfMatch ? csrfMatch[1] : null,
    hasForm,
    stats,
  };
}

;
// Build a { key -> element } reference table for a container's [data-*]
// nodes. The UI module collects its static skeleton once (instead of
// re-querying per access); dynamic content (sections, notif list, toast)
// is still queried on demand.
//
// Pure: takes any node with querySelectorAll, returns a plain object.
// Duplicate keys: first occurrence wins (the template only has unique
// keys; this guards against accidental re-registration).
function collectRefs(root, attr = "data-lsb") {
  const refs = {};
  if (!root || typeof root.querySelectorAll !== "function") return refs;
  root.querySelectorAll("[" + attr + "]").forEach((el) => {
    const key = el.getAttribute(attr);
    if (key && !(key in refs)) refs[key] = el;
  });
  return refs;
}

;
// lib/history-store.mjs
// Local browsing history for tracked pages (topics / user profiles).
// Pattern borrowed from Nodeseek Pro's history feature (see
// docs/superpowers/specs/2026-08-13-nodeseek-pro-analysis.md) — kept pure
// so tests can stub storage and the clock. The cap keeps GM storage bounded.

const DEFAULT_CAP = 50;

/** Only pages worth remembering: topic threads and user profiles. */
function isTrackableUrl(url) {
  try {
    const u = new URL(url, "https://linux.sb");
    return /^\/?\/?(?:topic|t|discussion|user)\//.test(u.pathname.replace(/^\/+/, "/"));
  } catch {
    return false;
  }
}

function createHistoryStore({
  storage,               // { get(name), set(name, value, ttlMs) }
  now = Date.now,
  cap = DEFAULT_CAP,
  trackable = isTrackableUrl,
} = {}) {
  function list() {
    const arr = storage.get("history.entries");
    return Array.isArray(arr) ? arr : [];
  }

  /** Record a visit; returns the new list (newest first, deduped by URL). */
  function record(url, title) {
    if (!url || !trackable(url)) return list();
    const next = [{ url, title: title || "", ts: now() }, ...list().filter((e) => e.url !== url)].slice(0, cap);
    storage.set("history.entries", next, 0);
    return next;
  }

  function clear() {
    storage.set("history.entries", [], 0);
  }

  return { list, record, clear };
}

;
// lib/lru-cache.mjs
// Generic LRU cache (Map-based, O(1) get/set). Ported from LDStatus Pro's
// verified implementation (docs/superpowers/specs/2026-08-13-ldstatuspro-analysis.md §4).
function createLRUCache(maxSize = 50) {
  if (!(maxSize > 0)) throw new Error("lru-cache: maxSize must be > 0");
  const cache = new Map();
  return {
    get size() { return cache.size; },
    get(key) {
      if (!cache.has(key)) return undefined;
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value); // move to tail (most recently used)
      return value;
    },
    set(key, value) {
      if (cache.has(key)) cache.delete(key);
      if (cache.size >= maxSize) cache.delete(cache.keys().next().value); // evict LRU
      cache.set(key, value);
      return value;
    },
    has(key) { return cache.has(key); },
    delete(key) { return cache.delete(key); },
    clear() { cache.clear(); },
  };
}

;
// Parse a linux.sb notifications page into { unread, list }.
// Pure: takes HTML text, returns a plain object.  MAX_LIST caps the
// returned list size; unread is reported as the raw count even when
// the list is capped (the panel can show "5 of N").
//
// Two layouts are supported; the parser auto-detects:
//   1. Current site (1.1.3 era):
//      <ul class="post-list">
//        <li class="post-item notification-item">
//          <span class="post-user-group notification-kind">提及</span>
//          <div class="post-content notification-content">...</div>
//        </li>
//      </ul>
//      The "unread" count is derived from the number of items (the
//      real page does not expose a separate badge).
//
//   2. Legacy:
//      <ul class="notif-list">
//        <li data-id="N" data-mention="true|false"><a>...</a></li>
//      </ul>
//      with an optional <span class="notif-unread-count">N</span>.
//      The "unread" count is read from the badge (falls back to list length).

const MAX_LIST = 5;

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function kindFromZh(text) {
  if (/提及|@|提到/.test(text)) return "mention";
  if (/回复|reply/i.test(text)) return "reply";
  return "system";
}

function extractUnreadLegacy(html) {
  const m = html.match(/class\s*=\s*["'][^"']*notif-unread-count["'][^>]*>\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function extractListLegacy(html) {
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
    const title = stripTags(aMatch[2]);
    items.push({
      id: idMatch ? idMatch[1] : url,
      url,
      title,
      isMention: mention,
      kind: mention ? "mention" : "system",
    });
    if (items.length >= MAX_LIST) break;
  }
  return items;
}

function extractListNew(html) {
  const items = [];
  let total = 0;
  // Match each <li class="...notification-item...">...</li> block.
  // Use a greedy-but-bounded approach: capture the <li> body via a
  // manual scan so nested <div>/<span> blocks parse correctly.
  const liRe = /<li\b[^>]*class\s*=\s*["'][^"']*\bnotification-item\b[^"']*["'][^>]*>/gi;
  let openMatch;
  while ((openMatch = liRe.exec(html)) !== null) {
    const start = liRe.lastIndex;
    // Walk forward, counting <div ...> opens minus </div> closes, until
    // we hit the matching </li>. Handles nested divs/p/spans correctly.
    const close = findMatchingClose(html, start, "li");
    if (close < 0) break;
    const body = html.slice(start, close);
    // Kind text lives inside the first .notification-kind element.
    const kindMatch = matchInner(body, "notification-kind", "span");
    const contentMatch = matchInner(body, "notification-content", "div");
    const linkMatch = body.match(/<a\b[^>]*href\s*=\s*["']([^"']+)/i);
    if (!contentMatch) {
      liRe.lastIndex = close + 5;
      continue;
    }
    // Count every well-formed item; only the returned list is capped.
    total++;
    if (items.length >= MAX_LIST) {
      liRe.lastIndex = close + 5;
      continue;
    }
    const kindZh = kindMatch ? stripTags(kindMatch) : "";
    const title = stripTags(contentMatch).slice(0, 240);
    items.push({
      id: linkMatch ? linkMatch[1] : title,
      url: linkMatch ? linkMatch[1] : null,
      title,
      kind: kindFromZh(kindZh),
    });
    liRe.lastIndex = close + 5;
  }
  return { list: items, total };
}

// Find the index of the matching </TAG> for an opening <TAG at position
// `start` (just past the opening tag).  Walks the substring, counting
// opens and closes, allowing for nested same-tag elements.  Returns -1
// if no match (malformed input).
function findMatchingClose(html, start, tag) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let i = start;
  // Build candidate positions by scanning both regexes.
  openRe.lastIndex = i;
  closeRe.lastIndex = i;
  let nextOpen = openRe.exec(html);
  let nextClose = closeRe.exec(html);
  while (depth > 0) {
    if (nextClose && (!nextOpen || nextClose.index < nextOpen.index)) {
      depth--;
      if (depth === 0) return nextClose.index;
      nextClose = closeRe.exec(html);
    } else if (nextOpen) {
      depth++;
      nextOpen = openRe.exec(html);
    } else if (nextClose) {
      depth--;
      if (depth === 0) return nextClose.index;
      nextClose = closeRe.exec(html);
    } else {
      return -1;
    }
  }
  return -1;
}

// Find the inner text of the first <TAG class="...className...">...</TAG>
// block within `html`.  Returns null if not found.
function matchInner(html, className, tag) {
  const re = new RegExp(
    `<${tag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const close = findMatchingClose(html, start, tag);
  if (close < 0) return null;
  return html.slice(start, close);
}

function parseNotifications(html) {
  if (typeof html !== "string" || !html) return { unread: 0, list: [] };

  // New structure takes priority: it ships with the live site and the
  // "notification-item" class is unique to it.  unread is the RAW item
  // count (the page has no separate badge); only the returned list is
  // capped at MAX_LIST.
  if (/notification-item/.test(html)) {
    const { list, total } = extractListNew(html);
    return { unread: total, list };
  }

  // Legacy fallback.
  const list = extractListLegacy(html);
  return { unread: extractUnreadLegacy(html), list };
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
// Diff-style rendering for the notification badge/list.
// Pure: given the previous and next notification state, returns a patch
// describing ONLY what visibly changed, or null when nothing changed so
// the caller can skip DOM writes entirely (keeps the 60s poll from
// flashing the panel when data is unchanged).
function notifViewDiff(prev, next) {
  const nextState = next || { unread: 0, list: [] };
  const unread = Number(nextState.unread) || 0;
  const list = Array.isArray(nextState.list) ? nextState.list : [];
  const prevUnread = prev ? Number(prev.unread) || 0 : null;
  // Symmetric with the next-side list handling: malformed / missing lists
  // are treated as empty on BOTH sides, so an identical malformed payload
  // yields no patch.
  const prevList = prev && Array.isArray(prev.list) ? prev.list : [];

  const listKey = (items) => items.map((i) => (i ? i.url + "|" + i.title : "")).join("\u0001");
  const nextKey = listKey(list);
  const prevKey = prevList ? listKey(prevList) : null;

  const countChanged = prevUnread !== unread;
  const listChanged = prevKey !== nextKey;
  // First render (prev === null) must always produce a patch.
  if (!countChanged && !listChanged) return null;

  return {
    unread,
    countChanged,
    listChanged,
    list,
    dotText: unread > 9 ? "9+" : (unread > 0 ? String(unread) : ""),
    dotHidden: unread === 0,
  };
}

;
// lib/notifier.mjs
// Milestone achievement notifications. Pattern borrowed from LDStatus Pro's
// Notifier (verified source: docs/superpowers/specs/2026-08-13-ldstatuspro-analysis.md §3):
// each milestone fires once (persisted "achieved" map) with a 60s rate limit.
// Pure factory — notify() is injected (the module wires GM_notification).
const DEFAULT_MILESTONES = {
  streak: [7, 30, 100, 365],      // 连续签到 N 天
  total: [100, 365, 1000],        // 累计签到 N 天
  points: [100, 500, 1000, 5000], // 积分达到 N
};

function createNotifier({
  storage,                       // { get(name), set(name, value, ttlMs) }
  notify = () => {},             // (title, text) — module injects GM_notification
  milestones = DEFAULT_MILESTONES,
  now = Date.now,
  rateLimitMs = 60_000,
} = {}) {
  let lastNotifyAt = 0;
  const LABELS = { streak: "连续签到", total: "累计签到", points: "积分" };

  function check(report) {
    if (!report) return [];
    const achieved = storage.get("notif.milestones") || {};
    const fresh = [];
    for (const [key, thresholds] of Object.entries(milestones)) {
      const value = report[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      for (const t of thresholds) {
        const k = key + ":" + t;
        if (value >= t && !achieved[k]) {
          achieved[k] = true;
          fresh.push({ key, threshold: t, value });
        }
      }
    }
    if (!fresh.length) return [];
    storage.set("notif.milestones", achieved, 0);
    if (now() - lastNotifyAt >= rateLimitMs) {
      lastNotifyAt = now();
      const lines = fresh.slice(0, 3).map((m) =>
        "🏆 " + (LABELS[m.key] || m.key) + " " + m.threshold + (m.key === "points" ? "" : " 天")
      );
      notify("🎉 达成里程碑！", lines.join("\n"));
    }
    return fresh;
  }

  return { check };
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

;
// lib/signin-tips.mjs
// Top-of-page "you haven't signed in today" reminder bar, shown only while
// the auto-signin toggle is OFF. Pattern borrowed from Nodeseek Pro's
// signinTips (verified source: docs/superpowers/specs/2026-08-13-nodeseek-pro-analysis.md §3):
// date-level dedupe via an "ignore today" marker + one-click sign-in.
// Pure factory — storage / signin API / toast / document are injected.

function todayKey(now) {
  const d = now instanceof Date ? now : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function createSigninTips({
  storage,          // { get(name), set(name, value, ttlMs) }
  signin,           // { getAutoSignin(), getStatus(), performSignin() }
  user,             // { info } — sync view of the logged-in user
  toast = null,     // { show(message, opts) } (optional)
  document: doc = (typeof document !== "undefined" ? document : null),
  today = todayKey,
  strings = { text: "今天还没签到，记得去签到哦～", signin: "立即签到", later: "今天不提示" },
} = {}) {
  let el = null;

  function isIgnoredToday() { return storage.get("signin.tips.ignoreDate") === today(); }
  function markIgnored() { storage.set("signin.tips.ignoreDate", today(), 0); }
  function remove() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  async function show() {
    remove();
    if (!doc || !doc.body) return false;
    if (!(user && user.info && user.info.id)) return false;   // guest
    if (signin.getAutoSignin()) return false;                 // auto on → no tip
    if (isIgnoredToday()) return false;                       // "今天不提示"
    let status = "unknown";
    try { status = (await signin.getStatus()).status; } catch (e) { /* keep unknown */ }
    if (status === "signed-in") return false;
    if (status !== "not-signed-in" && status !== "unknown") return false;

    el = doc.createElement("div");
    el.className = "lsb-tip";
    el.innerHTML =
      '<div class="lsb-tip-inner">' +
      '<span class="lsb-tip-text"></span>' +
      '<a class="lsb-tip-action" data-lsb-tip="signin" href="#"></a>' +
      '<a class="lsb-tip-action" data-lsb-tip="later" href="#"></a>' +
      "</div>";
    el.querySelector(".lsb-tip-text").textContent = strings.text;
    el.querySelector('[data-lsb-tip="signin"]').textContent = strings.signin;
    el.querySelector('[data-lsb-tip="later"]').textContent = strings.later;

    el.querySelector('[data-lsb-tip="signin"]').addEventListener("click", async (ev) => {
      ev.preventDefault();
      let r = null;
      try { r = await signin.performSignin(); } catch (e) { r = null; }
      if (toast && typeof toast.show === "function") {
        if (r && r.ok) {
          const days = (r.stats && r.stats.total) ? "，累计签到 " + r.stats.total + " 天" : "";
          toast.show("签到成功 ✓" + days, { type: "success" });
        } else {
          toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
        }
      }
      remove();
    });
    el.querySelector('[data-lsb-tip="later"]').addEventListener("click", (ev) => {
      ev.preventDefault();
      markIgnored();
      remove();
    });

    (doc.body || doc.documentElement).appendChild(el);
    return true;
  }

  return { show, remove, isIgnoredToday, markIgnored };
}

;
// Multi-tab leader election (localStorage heartbeat + takeover + release).
// Only the leader tab runs pollers, so N open tabs on the same origin do
// not duplicate network requests.
//
// Design borrowed from LDStatus Pro (verified against its source): every tab
// writes a heartbeat { tabId, ts } under one key; a tab becomes leader when
// the stored entry is stale (timeoutMs) or is its own id. beforeunload
// releases the entry so takeover is instant; storage events + the heartbeat
// timer keep the rest in sync.
//
// Pure: the storage adapter and event listeners are injected so tests can
// simulate multiple tabs with a shared Map-backed stub.

function createTabLeader(opts = {}) {
  const {
    storage,
    key = "lsb:tab-leader",
    heartbeatMs = 5000,
    timeoutMs = 10000,
    tabId = null,
    now = Date.now,
    addEventListener = null,
    removeEventListener = null,
  } = opts;
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function" || typeof storage.remove !== "function") {
    throw new Error("tab-leader: storage adapter with get/set/remove required");
  }

  const id = tabId || (Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
  let isLeaderFlag = false;
  let heartbeatTimer = null;
  let storageHandler = null;
  let unloadHandler = null;
  const listeners = new Set();

  function emit(change) {
    for (const fn of listeners) {
      try { fn(change); } catch (e) { /* ignore listener errors */ }
    }
  }

  function read() {
    try {
      const raw = storage.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function write(entry) { try { storage.set(key, JSON.stringify(entry)); } catch { /* quota/private mode */ } }

  function tryBecomeLeader() {
    const stored = read();
    const expired = !stored || !stored.ts || (now() - stored.ts) > timeoutMs;
    const mine = stored && stored.tabId === id;
    if (expired || mine) {
      write({ tabId: id, ts: now() });
      // Verify after write: a simultaneous writer may have won the race.
      const after = read();
      if (!after || after.tabId === id) {
        if (!isLeaderFlag) { isLeaderFlag = true; emit({ isLeader: true, tabId: id }); }
        return;
      }
    }
    if (isLeaderFlag) { isLeaderFlag = false; emit({ isLeader: false, tabId: id }); }
  }

  function release() {
    const stored = read();
    if (isLeaderFlag && stored && stored.tabId === id) {
      try { storage.remove(key); } catch { /* ignore */ }
      isLeaderFlag = false;
    }
  }

  return {
    get tabId() { return id; },
    isLeader() { return isLeaderFlag; },
    start() {
      tryBecomeLeader();
      if (!heartbeatTimer) heartbeatTimer = setInterval(tryBecomeLeader, heartbeatMs);
      if (addEventListener && !storageHandler) {
        storageHandler = (e) => { if (!e || e.key === key || e.key === null) tryBecomeLeader(); };
        addEventListener("storage", storageHandler);
        unloadHandler = () => release();
        addEventListener("beforeunload", unloadHandler);
      }
      return this;
    },
    stop() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (removeEventListener) {
        if (storageHandler) removeEventListener("storage", storageHandler);
        if (unloadHandler) removeEventListener("beforeunload", unloadHandler);
      }
      storageHandler = null;
      unloadHandler = null;
      return this;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

;
// lib/time-format.mjs
// Relative-time Chinese formatting. Pattern borrowed from Nodeseek Pro's
// timeChinese (docs/superpowers/specs/2026-08-13-nodeseek-pro-analysis.md):
// "刚刚 / N 分钟前 / N 小时前 / N 天前", older timestamps fall back to a date.
// Pure function — ready for the notif/history features that carry timestamps.
function formatRelativeTime(input, now) {
  if (input == null) return "";
  const ts = new Date(input).getTime();
  if (!Number.isFinite(ts)) return String(input);
  const base = now == null ? Date.now() : Number(now);
  const diff = Math.max(0, base - ts);
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  if (diff < MIN) return "刚刚";
  if (diff < HOUR) return Math.floor(diff / MIN) + " 分钟前";
  if (diff < DAY) return Math.floor(diff / HOUR) + " 小时前";
  if (diff < 7 * DAY) return Math.floor(diff / DAY) + " 天前";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

;
// lib/toast.mjs
// Pure factory function for toast notifications. Zero external dependencies.
// Inlined into the public build by build.mjs.

const ICONS = { success: '✓', error: '✗', info: 'ℹ' };

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createToastManager(opts) {
  if (opts === void 0) opts = {};
  var maxVisible = opts.maxVisible != null ? opts.maxVisible : 3;
  var gap = opts.gap != null ? opts.gap : 8;
  var durationMs = opts.durationMs != null ? opts.durationMs : 3000;
  var containerId = opts.containerId || 'lsb-toast-container';

  // Clamp duration to safe range.
  if (durationMs < 1000) durationMs = 1000;
  if (durationMs > 30000) durationMs = 30000;

  var container = null;
  var queue = [];

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = containerId;
    document.documentElement.appendChild(container);
    return container;
  }

  function show(message, options) {
    if (!message || typeof message !== 'string') return;
    if (options === void 0) options = {};
    var type = options.type || 'info';
    var dur = options.durationMs != null ? options.durationMs : durationMs;
    if (dur < 1000) dur = 1000;
    if (dur > 30000) dur = 30000;

    var ctr = ensureContainer();
    var el = document.createElement('div');
    el.className = 'lsb-toast';
    el.dataset.type = type;
    el.innerHTML = '<span class="lsb-toast-icon">' + (ICONS[type] || ICONS.info) + '</span>' +
                   '<span class="lsb-toast-msg">' + escapeHtml(message) + '</span>';
    el.addEventListener('click', function () { dismiss(el); });

    ctr.appendChild(el);
    queue.push(el);

    while (queue.length > maxVisible) {
      dismissEl(queue.shift());
    }

    var timer = setTimeout(function () { dismiss(el); }, dur);
    el._lsbToastTimer = timer;

    return el;
  }

  function dismiss(el) {
    if (!el || el._lsbToastDismissed) return;
    el._lsbToastDismissed = true;
    clearTimeout(el._lsbToastTimer);
    el.classList.add('lsb-toast-out');
    setTimeout(function () { dismissEl(el); }, 200);
  }

  function dismissEl(el) {
    var idx = queue.indexOf(el);
    if (idx >= 0) queue.splice(idx, 1);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  function destroy() {
    while (queue.length) { dismissEl(queue[0]); }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }

  return { show: show, dismiss: dismiss, destroy: destroy };
}

;
// Read the logged-in user info from a parsed HTML document.
//
// Two-page safety: on a linux.sb user-profile page, the page's own
// `.sidebar-card.user-card` shows the page's owner, not the logged-in
// viewer. We detect this case (page is /user/<id> AND id != my id)
// and refuse to read the sidebar card. Instead we fall back to the
// top-bar `a.nav-mine` for the id and to the avatar image's alt/ src.
//
// The function is pure (no DOM, no network) so it can be unit-tested
// with HTML fixtures. The caller is responsible for passing the
// parsed document and the helpers it needs.

const SELECTORS = {
  navMine:        "a.nav-mine",
  sidebarCard:    ".sidebar-card.user-card",
  nameLink:       ".sidebar-card.user-card .user-name",
  avatarWrap:     ".sidebar-card.user-card .user-avatar-big",
  avatarImg:      ".sidebar-card.user-card .user-avatar-big img.avatar-img",
  rank:           ".sidebar-card.user-card .user-rank",
  points:         ".sidebar-card.user-card .user-points",
  visitorAvatar:  ".sidebar-card.user-card .user-avatar-big.visitor-avatar",
  anyAvatarLink:  "a.avatar-profile-link",
};

/**
 * @param {Document} doc        - parsed HTML document (DOMParser output ok)
 * @param {object}   helpers
 * @param {string|null} helpers.currentPath - window.location.pathname, used to
 *                            detect "/user/<id>" pages so we can refuse to
 *                            trust the sidebar card when the page is NOT the
 *                            viewer's own profile.
 * @param {(s:string,el?:Element)=>string} helpers.absUrl - make href absolute
 * @param {(s:string)=>string|null} helpers.dicebearForUserId - synthesise a
 *                            placeholder avatar URL for visitors
 * @returns {object|null}      - the logged-in user descriptor, or null
 */
function readUserFromDocument(doc, helpers) {
  const { absUrl, dicebearForUserId, currentPath } = helpers;
  const $ = (sel, el) => (el || doc).querySelector(sel);
  const text = (el) => el ? (el.textContent || "").trim() : "";
  const attr = (el, name) => el ? el.getAttribute(name) : null;
  const src = (el) => el ? (el.src || el.getAttribute("src") || "") : "";

  // 1) nav-mine is the top-bar link, always the logged-in user.
  const navMine = $(SELECTORS.navMine);
  if (navMine) {
    const navText = text(navMine);
    const navHref = attr(navMine, "href") || "";
    if (/\/login\b/.test(navHref) || /登录/.test(navText)) return null;
    const myId = _userIdFromHref(navHref);

    // Two-page safety: refuse the sidebar card when the current page is
    // someone else's /user/<id> page. Detect this by comparing the page
    // path with the id we got from nav-mine.
    const isOwnUserPage = !!currentPath && new RegExp(`^/user/${myId}(?:/|$|\\?|#)`).test(currentPath);
    const isOtherUserPage = !!currentPath && /^\/user\/\d+/.test(currentPath) && !isOwnUserPage;
    if (isOtherUserPage) {
      // Sidebar card is the OTHER user. Only trust nav-mine.
      return {
        id: myId,
        nickname: null,
        avatarUrl: null,
        avatarIsDicebear: false,
        profileUrl: navHref ? absUrl(navHref) : null,
        rank: null,
        points: null,
        isLoggedIn: true,
        source: "nav-mine-only",
      };
    }

    // Home / own profile: read the sidebar card.
    const card = $(SELECTORS.sidebarCard);
    const nameEl = card ? $(SELECTORS.nameLink) : null;
    const avatarWrap = card ? $(SELECTORS.avatarWrap) : null;
    const avatarImg  = avatarWrap ? $("img.avatar-img", avatarWrap) : null;
    const rankEl     = card ? $(SELECTORS.rank) : null;
    const pointsEl   = card ? $(SELECTORS.points) : null;
    const nickname   = nameEl ? text(nameEl) : null;
    let avatarUrl    = avatarImg ? src(avatarImg) : null;
    let avatarIsDicebear = !!avatarUrl && /\/avatars\/|dicebear/i.test(avatarUrl);
    if (!avatarUrl && avatarWrap && avatarWrap.classList.contains("visitor-avatar")) {
      avatarUrl = dicebearForUserId ? dicebearForUserId(String(myId || "guest")) : null;
      avatarIsDicebear = true;
    }
    const rankText = rankEl ? text(rankEl) : null;
    let points = null;
    if (pointsEl) {
      const m = text(pointsEl).match(/(\d+)/);
      if (m) points = Number(m[1]);
    } else if (rankText) {
      const m = rankText.match(/(\d+)/);
      if (m) points = Number(m[1]);
    }
    return {
      id: myId,
      nickname: nickname || null,
      avatarUrl: avatarUrl || null,
      avatarIsDicebear,
      profileUrl: navHref ? absUrl(navHref) : null,
      rank: rankText || null,
      points,
      isLoggedIn: true,
      source: avatarImg ? "user-card" : "user-card-visitor",
    };
  }

  // 2) Fallback: any avatar-profile-link (last resort, isLoggedIn=false).
  const link = $(SELECTORS.anyAvatarLink);
  if (link) {
    const href = attr(link, "href") || "";
    const img = $("img", link);
    const id = _userIdFromHref(href);
    if (id) {
      return {
        id,
        nickname: attr(img, "alt") || null,
        avatarUrl: src(img) || null,
        avatarIsDicebear: !!img && /dicebear/i.test(src(img) || ""),
        profileUrl: absUrl(href),
        isLoggedIn: false,
        source: "avatar-link",
      };
    }
  }
  return null;
}

function _userIdFromHref(href) {
  const m = (href || "").match(/^\/user\/(\d+)/);
  return m ? Number(m[1]) : null;
}
;if (root.LSB && root.LSB.__booted) return;
  const LSB = (root.LSB = { __booted: true, version: "1.2.3" });

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
      signin: true,       // daily check-in: status detect, one-click + auto signin
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
        RC: { top: "50%", right: 12, centerY: true },
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
      // Build a user-scoped endpoint when the site requires it
      // (e.g. /user/<id>?tab=notifications). Return null to fall through to candidates.
      endpoint(userId) {
        if (userId) return `/user/${userId}?tab=notifications`;
        return null;
      },
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
    escapeHtml(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  // core/http  (native fetch wrapper: timeout, JSON convenience, same-origin cookies)
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
  // core/i18n, core/settings, core/dom-sections
  // (inlined at build time from core/*.mjs; the symbols live in the
  // outer scope so this block can use them directly).
  // =====================================================================
  LSB.i18n = (typeof createI18n === "function")
    ? createI18n({ locale: LSB.config.i18n.defaultLocale, fallback: LSB.config.i18n.fallbackLocale })
    : { t: (k) => k, add: () => {}, setLocale: () => {} };
  LSB.i18n.add({
    "panel.title":         { zh: "面板",     en: "Panel" },
    "panel.settings":      { zh: "设置",     en: "Settings" },
    "panel.close":         { zh: "关闭",     en: "Close" },
    "panel.theme":         { zh: "主题",     en: "Theme" },
    "panel.theme.auto":    { zh: "跟随系统", en: "Follow system" },
    "panel.theme.light":   { zh: "浅色",     en: "Light" },
    "panel.theme.dark":    { zh: "深色",     en: "Dark" },
    "checkin.title":       { zh: "签到",     en: "Check-in" },
    "notif.title":         { zh: "通知",     en: "Notifications" },
    "history.title":       { zh: "浏览历史",  en: "History" },
    "history.empty":       { zh: "暂无浏览历史", en: "No history yet" },
    "settings.group.panel": { zh: "面板",     en: "Panel" },
    "settings.group.signin": { zh: "签到",    en: "Sign-in" },
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
    // NOTE: panel position is fixed at bottom-right (BR) since 1.2.2 — the
    // position setting was removed on request. config.ui.positions still
    // drives the CSS, so re-enabling later is one registration + a constant.
    LSB.settings.register({
      key: "panel.theme", type: "enum", group: "panel",
      label: { zh: "主题", en: "Theme" },
      default: "light", options: LSB.config.ui.themes,
    });
    LSB.settings.register({
      key: "signin.auto", type: "boolean", group: "signin",
      label: { zh: "自动签到", en: "Auto sign-in" },
      default: false,
      hidden: true, // the panel's action row already has the auto-signin switch
    });
  }

  // =====================================================================
  // Toast notification manager (infrastructure, not a module)
  // =====================================================================
  LSB.toast = (typeof createToastManager === 'function')
    ? createToastManager({ maxVisible: 3, gap: 8, durationMs: 3000, containerId: 'lsb-toast-container' })
    : { show: function() {}, dismiss: function() {}, destroy: function() {} };

  // Multi-tab leader election (inlined from lib/tab-leader.mjs): only the
  // leader tab runs pollers, so N open tabs on linux.sb don't duplicate
  // notification / auto-signin requests. localStorage is per-origin and
  // shared across tabs; nothing leaves the browser.
  LSB.tabLeader = (typeof createTabLeader === "function")
    ? createTabLeader({
        storage: {
          get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
          set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
          remove: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
        },
        addEventListener: (t, fn) => window.addEventListener(t, fn),
        removeEventListener: (t, fn) => window.removeEventListener(t, fn),
      }).start()
    : null;

  // =====================================================================
  // api/linuxSb  (selectors, URL patterns, response shape)
  // =====================================================================
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
      // Class is "card sidebar-card user-card" on the live site.
      userCard:        ".sidebar-card.user-card",
      userNameLink:    ".sidebar-card.user-card .user-name",
      // Avatar wrapper (logged-in) + inner <img> (real photo) + visitor letter.
      userAvatar:      ".sidebar-card.user-card .user-avatar-big",
      userAvatarImg:   ".sidebar-card.user-card .user-avatar-big img.avatar-img",
      userCardVisitor: ".sidebar-card.user-card .user-avatar-big.visitor-avatar",
      // Rank text reads "笔友 · 积分 256"; we extract the digit run for points.
      userRank:        ".sidebar-card.user-card .user-rank",
      userPoints:      ".sidebar-card.user-card .user-points",
      // Home page sidebar daily checkin card
      dailyCheckinCard:   ".sidebar-card.daily-checkin-card",
      dailyCheckinStatus: ".daily-checkin-sub",
      dailyCheckinBadge:  ".daily-checkin-badge",
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
  const _registry = new Map();       // name -> { factory, deps, instance, enabled, match }
  const _pendingInit = [];           // modules whose deps are not yet resolved

  LSB.register = function (name, factory, deps = [], match) {
    if (_registry.has(name)) {
      (LSB.logger.make("register")).warn("duplicate module:", name);
      return;
    }
    if (!LSB.utils.isFunction(factory)) {
      throw new Error(`LSB.register("${name}"): factory must be a function`);
    }
    // Optional declarative gate (nodeseek borrow): when match(ctx) returns
    // false, the module's init() is skipped for this page/session.
    _registry.set(name, { factory, deps, instance: null, enabled: true, match: typeof match === "function" ? match : null });
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
    // In-memory LRU for user-page fallback fetches (lib/lru-cache.mjs, inlined).
    const userPageCache = (typeof createLRUCache === "function") ? createLRUCache(10) : null;

    /**
     * Read the current user info from the live DOM.
     * Returns null if not logged in or DOM is not yet rendered.
     * Result shape:
     *   { id, nickname, avatarUrl, avatarIsDicebear, profileUrl, isLoggedIn, source }
     *   source ∈ "nav-mine" | "avatar-link" | "user-page" | "stored"
     */
    async function readFromDom() {
      // Delegate to the pure parser in core (inlined from lib/user-read.mjs).
      // The lib enforces the "two-page safety" rule: on a /user/<other-id>
      // page, the sidebar card belongs to the OTHER user, so we refuse to
      // read it and return only what nav-mine tells us (id, profileUrl,
      // source = "nav-mine-only"). Consumers in getCurrent() preserve
      // nickname/avatar/rank/points from cache in that case.
      if (typeof readUserFromDocument !== "function") {
        log.warn("readUserFromDocument missing from inlined lib; readFromDom disabled");
        return null;
      }
      return readUserFromDocument(document, {
        currentPath: location.pathname,
        absUrl: dom.absUrl,
        dicebearForUserId: LSB.api.linuxSb.avatarUrl.dicebearForUserId,
      });
    }
     /**
     * Fetch the user page and parse richer info (signin count, joined date, etc.).
     * Only used as a fallback if DOM is incomplete.
     */
    async function readFromUserPage(userId) {
      if (!userId) return null;
      // LRU hit: avoid refetching the same user page within one page lifetime.
      if (userPageCache) {
        const hit = userPageCache.get("user:" + userId);
        if (hit) return hit;
      }
      const url = `${config.site.apiBase}/user/${userId}`;
      try {
        const html = await LSB.http.getHtml(url);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const title = dom.text(doc.querySelector("title"));
        const nickname = (title || "").split(" - ")[0].trim() || null;
        // Prefer the sidebar user-card's avatar; fall back to the page's
        // first <img> (old behaviour) only when the card is not rendered.
        const img = doc.querySelector(".sidebar-card.user-card .user-avatar-big img.avatar-img")
          || doc.querySelector("img");
        const result = {
          id: userId,
          nickname,
          avatarUrl: dom.src(img) || LSB.api.linuxSb.avatarUrl.dicebearForUserId(userId),
          avatarIsDicebear: /dicebear/i.test(dom.src(img) || ""),
          profileUrl: url,
          isLoggedIn: true,
          source: "user-page",
          raw: { title },
        };
        if (userPageCache) userPageCache.set("user:" + userId, result);
        return result;
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
    // Last known user, kept in sync with getCurrent() so other modules can
    // do a SYNCHRONOUS logged-in/id check (user.info.id) without awaiting
    // the DOM read again. Consumers: signin auto-poller, notif, ui.
    let _info = null;
    let _lastEmittedKey = null;
    async function getCurrent() {
      let fromDom = null;
      try { fromDom = await readFromDom(); } catch (err) { log.warn("dom read failed", err); }
      const cached = LSB.storage.get("user.current");
      if (fromDom) {
        // Two-page safety: if the lib only saw nav-mine (e.g. we are on
        // someone else's /user/<id> page), preserve nickname/avatar/rank/
        // points from the previous good read so the panel keeps showing
        // the LOGGED-IN user's identity. We still trust the fresh id
        // (it must match the cached id, otherwise something is wrong).
        if (fromDom.source === "nav-mine-only" && cached && cached.id === fromDom.id) {
          const merged = {
            ...cached,
            id: fromDom.id,
            profileUrl: fromDom.profileUrl || cached.profileUrl,
            isLoggedIn: true,
            source: "nav-mine-only",
          };
          _info = merged;
          return merged;
        }
        // Persist a normalized version.
        const normalized = normalize(fromDom);
        LSB.storage.set("user.current", normalized, LSB.config.storage.defaultTTL);
        // Publish _info BEFORE emitting so listeners (notif, signin) see the
        // fresh user.info synchronously inside their user:changed handlers.
        _info = normalized;
        const key = JSON.stringify(normalized);
        if (key !== _lastEmittedKey) {
          _lastEmittedKey = key;
          events.emit("user:changed", normalized);
        }
        return normalized;
      }
      if (cached) {
        _info = cached;
        // Also announce cached reads (DOM-less pages) so notif/signin start.
        const ck = JSON.stringify(cached);
        if (ck !== _lastEmittedKey) {
          _lastEmittedKey = ck;
          events.emit("user:changed", cached);
        }
        return cached;
      }
      // Last resort: nothing on the page yet. Return null and let caller decide.
      _info = null;
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
        "profileUrl", "isLoggedIn", "source", "rank", "points",
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
      // Synchronous view of the last known logged-in user (null until the
      // first getCurrent() resolves). Consumers check user.info.id.
      get info() { return _info; },
    };
  }, ["config", "dom", "events"]);

  // =====================================================================
  // module: signin  (detect / trigger daily checkin)
  // =====================================================================
  LSB.register("signin", function ({ config, dom, events, http, user }) {
    const log = LSB.logger.make("signin");
    // Shared fetch/submit IO layer (lib/checkin-fetch.mjs, inlined at build
    // time). The CSRF dance lives in exactly one unit-tested place.
    const io = (typeof createCheckinIO === "function")
      ? createCheckinIO({ http, base: config.site.apiBase })
      : null;

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
      // Delegated to the IO layer (lib/checkin-fetch.mjs) which wraps the
      // structure-agnostic parseCheckinPage (lib/checkin-parse.mjs) — both
      // unit-tested. Falls back to "unknown" when the lib was not inlined.
      if (!io) return { status: "unknown", csrf: null, hasForm: false, stats: { streak: 0, total: 0 } };
      return io.fetchStatus();
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
          // Fetch once so the return value can carry the checkin stats.
          const fetched = await _fetchStatus();
          if (/\u5df2\u7b7e\u5230/.test(t)) {
            return { ok: true, status: "signed-in", source: "already-on-page", stats: fetched.stats };
          }
          btn.click();
          return { ok: true, status: "submitted", source: "clicked", stats: fetched.stats };
        }
      }
      // Otherwise the IO layer handles fetch -> CSRF -> POST -> verify
      // (lib/checkin-fetch.mjs, unit-tested).
      if (!io) return { ok: false, status: "unknown", reason: "io-unavailable" };
      return io.submit();
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
      // Single source of truth: the settings registry ("signin.auto").
      // Fall back to the config default only when the registry is absent.
      if (LSB.settings && typeof LSB.settings.get === "function") {
        try { return !!LSB.settings.get("signin.auto").get(); } catch (e) { /* fall through */ }
      }
      return !!config.signin.autoSignin;
    }
    function setAutoSignin(on) {
      on = !!on;
      // setAutoSignin is the ONLY writer: persist via the settings registry
      // (which also notifies subscribers) and emit the module event.
      if (LSB.settings && typeof LSB.settings.get === "function") {
        try { LSB.settings.get("signin.auto").set(on); } catch (e) { /* registry unavailable */ }
      }
      events.emit("signin:auto-changed", on);
    }

    // One-shot migration: builds before 1.2.1 stored the auto-signin pref
    // under the raw storage key "signin.autoSignin".  Move it into the
    // settings registry once, then drop the legacy key.
    try {
      const legacy = LSB.storage.get("signin.autoSignin");
      if (legacy === true || legacy === false) {
        if (LSB.settings && typeof LSB.settings.get === "function") {
          if (legacy && !LSB.settings.get("signin.auto").get()) {
            LSB.settings.get("signin.auto").set(legacy);
          }
        }
        LSB.storage.del("signin.autoSignin");
      }
    } catch (e) { /* migration is best-effort */ }

    // Auto signin: drive a 5-minute poller; 20h dedupe window so we do not
    // re-signin within the same day. The poller stops when the user logs
    // out or disables the toggle.
    const _state = { lastSignedInAt: 0, pollInFlight: false };
    let _signinPoller = null;

    function _ensurePoller() {
      if (_signinPoller) return _signinPoller;
      if (typeof makePoller !== "function") {
        log.warn("makePoller not inlined; auto-checkin disabled");
        return null;
      }
      return makePoller({
        name: "signin-auto",
        onTick: async () => {
          if (_state.pollInFlight) return;
          if (!getAutoSignin()) return;
          if (!user || !user.info || !user.info.id) return;
          // Skip if we already signed in within the last 20h.
          if (_state.lastSignedInAt && (Date.now() - _state.lastSignedInAt) < 20 * 3600 * 1000) return;
          _state.pollInFlight = true;
          try {
            const r = await ensureSignedIn();
            if (r && r.status === "signed-in") _state.lastSignedInAt = Date.now();
            events.emit("signin:auto", r);
          } catch (err) { log.warn("auto tick failed", err); }
          finally { _state.pollInFlight = false; }
        },
        intervalMs: 5 * 60_000,
        backoffAfter: 2,
        backoffMs: 30 * 60_000,
        leader: LSB.tabLeader,
      });
    }

    function _startAuto() {
      const p = _ensurePoller();
      if (p) p.start();
    }
    function _stopAuto() {
      if (_signinPoller) { _signinPoller.stop(); _signinPoller = null; }
    }

    events.on("user:changed", function (u) {
      // _startAuto() runs the poller's first tick immediately, which performs
      // the checkin and emits signin:auto (toast handled there).
      if (u && u.isLoggedIn && getAutoSignin()) _startAuto();
      else _stopAuto();
    });
    events.on("signin:auto-changed", (on) => {
      if (on && user && user.info && user.info.id) _startAuto();
      else _stopAuto();
      if (on && _signinPoller) _signinPoller.tick().catch(() => {});
    });
    function _persistLastSignedIn() {
      if (_state.lastSignedInAt > 0) {
        try { LSB.storage.set("signin.lastSignedInAt", _state.lastSignedInAt, 0); } catch (e) {}
      }
    }

    // Toast helper — safe even if LSB.toast is not yet initialized.
    function _showSigninToast(result) {
      if (!LSB.toast || typeof LSB.toast.show !== "function") return;
      if (result && result.ok && result.action === "signed-in") {
        var days = (result.stats && result.stats.total) ? "，累计签到 " + result.stats.total + " 天" : "";
        LSB.toast.show("签到成功 ✓" + days, { type: "success" });
      } else if (result && !result.ok && result.reason) {
        if (result.reason !== "not-logged-in" && result.reason !== "unknown") {
          LSB.toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
        }
      }
    }

    events.on("signin:auto", function (r) {
      _persistLastSignedIn();
      _showSigninToast(r);
    });
    // Restore dedupe window across page loads.
    try {
      const v = LSB.storage.get("signin.lastSignedInAt");
      if (typeof v === "number" && v > 0) _state.lastSignedInAt = v;
    } catch (e) {}

    return {
      name: "signin",
      getStatus,
      performSignin,
      ensureSignedIn,
      getAutoSignin,
      setAutoSignin,
    };
  }, ["config", "dom", "events", "http", "user"]);

  // module: panelStyle  (panel position + theme store, source of truth for ui)
  // =====================================================================
  LSB.register("panelStyle", function ({ config, events }) {
    const log = LSB.logger.make("panelStyle");
    if (!LSB.settings) {
      log.warn("settings registry unavailable; panelStyle no-op");
      return { name: "panelStyle", init() {} };
    }
    const theme = LSB.settings.get("panel.theme");
    // Panel position: right-center (vertical middle of the viewport).
    const POS = "RC";

    LSB.panelStyle = {
      get pos() { return POS; },
      get theme() { return theme.get(); },
      set(patch) {
        if (patch && patch.theme != null) theme.set(patch.theme);
        events.emit("panel:reapply", { pos: POS, theme: this.theme });
      },
    };

    theme.subscribe((v) => events.emit("panel:reapply", { pos: POS, theme: v }));

    return {
      name: "panelStyle",
      init() { events.emit("panel:reapply", { pos: POS, theme: theme.get() }); },
    };
  }, ["config", "events"]);

  LSB.register("notif", function ({ config, http, events, user }) {
    const log = LSB.logger.make("notif");
    if (typeof makePoller !== "function" || typeof probeEndpoint !== "function" || typeof parseNotifications !== "function") {
      log.warn("lib not inlined; notif disabled");
      return { name: "notif", init() {} };
    }

    // One-shot cache bust: 1.1.2 cached a wrong endpoint path; 1.1.3 uses
    // the user-scoped factory. Clear the old value so we re-discover.
    if (typeof GM_deleteValue === "function") GM_deleteValue("lsb:notif:endpoint");

    const state = { unread: 0, list: [], endpoint: null, lastFetchAt: 0, lastError: null };
    LSB.notif = { state, start, stop, refresh };

    let poller = null;
    let userBound = false;

    function isLoggedIn() { return !!(user && user.info && user.info.id); }

    async function discoverEndpoint() {
      if (state.endpoint) return state.endpoint;
      // 1) Per-user factory endpoint (preferred when user is known).
      const uid = (user && user.info && user.info.id) || null;
      const factoryEndpoint = (typeof config.notif.endpoint === "function")
        ? config.notif.endpoint(uid) : null;
      if (factoryEndpoint) {
        state.endpoint = config.site.apiBase + factoryEndpoint;
        if (typeof GM_setValue === "function") GM_setValue("lsb:notif:endpoint", state.endpoint);
        return state.endpoint;
      }
      // 2) Cached static endpoint.
      const cached = (typeof GM_getValue === "function") ? GM_getValue("lsb:notif:endpoint", null) : null;
      if (cached) { state.endpoint = cached; return cached; }
      // 3) Probe static candidates.
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
      poller = makePoller({ name: "notif", onTick: refresh, intervalMs: config.notif.intervalMs, backoffAfter: config.notif.backoffAfter, backoffMs: config.notif.backoffMs, leader: LSB.tabLeader });
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
        pane: "notif",
        hidden: () => !isLoggedIn(),
        render: () => ({
          innerHTML:
            `<div class="lsb-section lsb-notif" data-lsb="notif-section">` +
            `<div class="lsb-section-title"><span>${LSB.i18n.t("notif.title")}</span><span class="lsb-notif-badge" data-lsb="notif-count">0</span></div>` +
            `<ul class="lsb-notif-list" data-lsb="notif-list"></ul>` +
            `</div>`,
        }),
      });
    }

    return { name: "notif", init: bindUser };
  }, ["config", "http", "events", "user"]);

  // =====================================================================
  // module: signinTips  (top reminder bar when auto-signin is off)
  // =====================================================================
  LSB.register("signinTips", function ({ events, signin, user }) {
    const log = LSB.logger.make("signinTips");
    if (typeof createSigninTips !== "function") {
      log.warn("createSigninTips not inlined; signinTips disabled");
      return { name: "signinTips", init() {} };
    }
    // Tip bar CSS (injected once; independent of the panel theme tokens).
    GM_addStyle(
      ".lsb-tip{position:fixed;top:0;left:0;right:0;z-index:2147483645;background:rgba(255,217,0,.92);" +
      "color:#5b4a00;font:13px/1.6 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;" +
      "box-shadow:0 2px 12px rgba(0,0,0,.18);animation:lsb-tip-in .3s ease}" +
      ".lsb-tip-inner{display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 12px;text-align:center}" +
      ".lsb-tip-text{font-weight:600}.lsb-tip-action{font-weight:800;cursor:pointer;text-decoration:underline;padding:2px 6px;border-radius:6px}" +
      ".lsb-tip-action:hover{background:rgba(0,0,0,.08)}" +
      "@keyframes lsb-tip-in{from{transform:translateY(-100%)}to{transform:none}}"
    );
    const tips = createSigninTips({ storage: LSB.storage, signin, user, toast: LSB.toast });
    let visible = false;

    async function refresh() {
      if (!user || !user.info || !user.info.id) { tips.remove(); visible = false; return; }
      if (signin.getAutoSignin()) { tips.remove(); visible = false; return; }
      if (visible) return;
      visible = await tips.show();
    }

    events.on("user:changed", refresh);
    events.on("signin:auto-changed", (on) => { if (on) { tips.remove(); visible = false; } else refresh(); });
    events.on("signin:status-changed", (s) => { if (s && s.status === "signed-in") { tips.remove(); visible = false; } });
    return { name: "signinTips", init: refresh };
  }, ["events", "signin", "user"]);

  // =====================================================================
  // module: notifier  (milestone notifications: streak / total / points)
  // =====================================================================
  LSB.register("notifier", function ({ events, signin, user }) {
    const log = LSB.logger.make("notifier");
    if (typeof createNotifier !== "function" || typeof GM_notification !== "function") {
      log.warn("createNotifier/GM_notification unavailable; notifier disabled");
      return { name: "notifier", init() {} };
    }
    const notifier = createNotifier({
      storage: LSB.storage,
      notify: (title, text) => GM_notification({ title, text, timeout: 5000 }),
    });
    function onStatus(s) {
      if (!s || !s.stats) return;
      notifier.check({
        streak: s.stats.streak,
        total: s.stats.total,
        points: user && user.info ? user.info.points : undefined,
      });
    }
    events.on("signin:auto", onStatus);
    events.on("signin:status-changed", onStatus);
    return { name: "notifier", init() {} };
  }, ["events", "signin", "user"], (ctx) => !!(ctx.user && ctx.user.id));

  // =====================================================================
  // module: history  (local browsing history for topics / users)
  // =====================================================================
  LSB.register("history", function ({ dom, events }) {
    const log = LSB.logger.make("history");
    if (typeof createHistoryStore !== "function") {
      log.warn("createHistoryStore not inlined; history disabled");
      return { name: "history", init() {} };
    }
    const store = createHistoryStore({ storage: LSB.storage });

    // LDStatus-style list: icon chip + title + time pill, hover accent.
    GM_addStyle(
      "#lsb-panel .lsb-history-list{list-style:none;margin:0;padding:0;max-height:230px;overflow:auto}" +
      "#lsb-panel .lsb-history-list li{display:flex;align-items:center;gap:9px;padding:8px 10px;margin:0 -10px;border-radius:10px;transition:background .16s ease}" +
      "#lsb-panel .lsb-history-list li:hover{background:var(--lsb-bg-hover,rgba(38,42,56,.95))}" +
      "#lsb-panel .lsb-history-ic{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;flex:none;color:var(--lsb-fg-sec,#9499ad);background:var(--lsb-bg-hover,rgba(38,42,56,.95));transition:color .16s ease}" +
      "#lsb-panel .lsb-history-list li:hover .lsb-history-ic{color:var(--lsb-accent-light,#8aa4f4)}" +
      "#lsb-panel .lsb-history-main{flex:1;min-width:0}" +
      "#lsb-panel .lsb-history-title{display:block;font-size:12px;line-height:1.45;color:var(--lsb-fg-sec,#9499ad);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .16s ease}" +
      "#lsb-panel .lsb-history-list li:hover .lsb-history-title{color:var(--lsb-fg,#e4e6ed)}" +
      "#lsb-panel .lsb-history-time{flex:none;font-size:10px;color:var(--lsb-fg-mut,#5d6275);background:var(--lsb-bg-hover,rgba(38,42,56,.95));border:1px solid var(--lsb-border,rgba(255,255,255,.08));padding:2px 8px;border-radius:999px}" +
      "#lsb-panel .lsb-history-count{font-size:10px;font-weight:700;color:var(--lsb-fg-sec,#9499ad);background:var(--lsb-bg-hover,rgba(38,42,56,.95));border:1px solid var(--lsb-border,rgba(255,255,255,.1));border-radius:999px;padding:0 7px;min-width:17px;text-align:center;line-height:17px}"
    );

    function onRoute(href) {
      store.record(dom.absUrl(href), (document.title || "").trim());
      events.emit("history:updated");
    }
    dom.onRouteChange(onRoute);
    // Also record the initial page (only trackable paths are kept).
    if (typeof isTrackableUrl === "function" && isTrackableUrl(location.href)) onRoute(location.href);

    if (LSB.sections) {
      LSB.sections.register("history", {
        order: 1,
        pane: "history",
        hidden: () => store.list().length === 0,
        render: () => {
          const items = store.list().slice(0, 8);
          const lis = items.map((it) => {
            const isUser = /\.*\/user\//.test(it.url);
            const icon = isUser
              ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
              : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
            const title = LSB.utils.escapeHtml(it.title || it.url);
            const rel = (typeof formatRelativeTime === "function") ? formatRelativeTime(it.ts) : "";
            return `<li>` +
              `<span class="lsb-history-ic">${icon}</span>` +
              `<span class="lsb-history-main"><a class="lsb-history-title" href="${LSB.utils.escapeHtml(it.url)}" target="_blank" rel="noopener">${title}</a></span>` +
              (rel ? `<span class="lsb-history-time">${rel}</span>` : "") +
              `</li>`;
          }).join("");
          return { innerHTML:
            `<div class="lsb-section lsb-history" data-lsb="history-section">` +
            `<div class="lsb-section-title"><span>${LSB.i18n.t("history.title")}</span><span class="lsb-history-count">${items.length}</span></div>` +
            (lis ? `<ul class="lsb-history-list">${lis}</ul>` : `<p class="lsb-empty">${LSB.i18n.t("history.empty")}</p>`) +
            `</div>` };
        },
      });
    }

    // Re-render the section when history changes (ui.refresh re-renders all sections).
    events.on("history:updated", () => { if (LSB.api && typeof LSB.api.refreshUI === "function") LSB.api.refreshUI(); });
    return { name: "history", store };
  }, ["dom", "events"]);

  // =====================================================================
  // module: visited  (visited-link tinting for topic titles)
  // =====================================================================
  LSB.register("visited", function () {
    // One CSS rule, scoped to the site's topic-title links (a.post-title),
    // so other link styles are untouched. The muted colour follows the panel
    // theme through the CSS variables applied on documentElement.
    GM_addStyle("a.post-title:visited{color:var(--lsb-fg-mut,#8590a6);opacity:.8}");
    return { name: "visited", init() {} };
  }, []);


  LSB.register("ui", function ({ config, dom, events, user, signin, panelStyle }) {
    const log = LSB.logger.make("ui");
    const log_user = LSB.logger.make("ui/user");
    const log_signin = LSB.logger.make("ui/signin");

    // -----------------------------------------------------------------
    // Data-driven CSS: position and theme rules come from config
    // and core/palettes, not hard-coded class lists.
    // -----------------------------------------------------------------
    if (typeof panelPositionCss === "function") {
      GM_addStyle(panelPositionCss(config.ui.positions));
    }
    if (typeof panelThemeCss === "function") {
      const palettes = {};
      for (const t of config.ui.themes) {
        if (t === "auto") continue;
        try { palettes[t] = getPalette(t); } catch (e) { /* unknown theme */ }
      }
      GM_addStyle(panelThemeCss(palettes));
    }

    GM_addStyle(`
      /* ================= design tokens ================= */
      #lsb-panel {
        --ease: cubic-bezier(0.22, 1, 0.36, 1);
        --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
        --ease-out: cubic-bezier(0, 0.55, 0.45, 1);
        --r-sm: 6px; --r-md: 10px; --r-lg: 13px;
      }
      /* ================= panel: deep-space glass ================= */
      #lsb-panel {
        position: fixed; z-index: 2147483646;
        font: 13px/1.55 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
          "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
        color: var(--lsb-fg, #e4e6ed);
        /* glass shell: follows the theme token (dark → deep-space, light → airy) */
        background: var(--lsb-bg, #12131a);
        border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.09));
        border-radius: var(--r-lg);
        box-shadow: var(--lsb-shadow, 0 24px 64px rgba(0, 0, 0, 0.5)),
          0 0 0 1px var(--lsb-border-accent, rgba(107, 140, 239, 0.08)),
          inset 0 1px 0 rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(22px) saturate(160%);
        -webkit-backdrop-filter: blur(22px) saturate(160%);
        user-select: none;
        width: min(352px, 92vw); max-width: 352px; min-width: 300px;
        overflow: hidden;
        animation: lsb-panel-in 0.45s var(--ease);
        transition: box-shadow 0.3s ease, border-color 0.3s ease,
          background-color 0.3s ease, color 0.3s ease,
          width 0.35s var(--ease), height 0.35s var(--ease), min-width 0.35s var(--ease),
          max-width 0.35s var(--ease), max-height 0.35s var(--ease), border-radius 0.35s var(--ease);
      }
      /* theme switch: smooth color morph across the whole panel */
      #lsb-panel, #lsb-panel .lsb-user, #lsb-panel .lsb-stats, #lsb-panel .lsb-notif-list li,
      #lsb-panel .lsb-history-list li, #lsb-panel .lsb-settings-menu, #lsb-panel .lsb-settings-nav,
      #lsb-panel .lsb-settings-toggle, #lsb-panel .lsb-seg span, #lsb-panel .lsb-hero-signed,
      #lsb-panel .lsb-section-title, #lsb-panel .lsb-notif-badge {
        transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
      }
      /* decorative ambient glows inside the panel (deep-space glass) */
      #lsb-panel .lsb-glow { position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; border-radius: inherit; }
      #lsb-panel .lsb-glow::before {
        content: ""; position: absolute; top: -110px; left: -80px; width: 340px; height: 340px;
        background: radial-gradient(circle, rgba(107, 140, 239, 0.38) 0%, transparent 62%);
        filter: blur(8px);
      }
      #lsb-panel .lsb-glow::after {
        content: ""; position: absolute; bottom: -130px; right: -90px; width: 360px; height: 360px;
        background: radial-gradient(circle, rgba(91, 181, 166, 0.22) 0%, transparent 62%);
        filter: blur(8px);
      }
      /* light theme: clean white shell — no heavy blur, subtle glows */
      #lsb-panel[data-effective-theme="light"] {
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        box-shadow: 0 12px 32px rgba(30, 41, 80, 0.12), 0 0 0 1px rgba(80, 112, 208, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.6);
      }
      #lsb-panel[data-effective-theme="light"] .lsb-glow::before {
        background: radial-gradient(circle, rgba(80, 112, 208, 0.14) 0%, transparent 62%);
      }
      #lsb-panel[data-effective-theme="light"] .lsb-glow::after {
        background: radial-gradient(circle, rgba(74, 158, 143, 0.08) 0%, transparent 62%);
      }
      /* light theme: glass tab bar becomes a light frosted strip */
      #lsb-panel[data-effective-theme="light"] .lsb-tabs {
        background: rgba(255, 255, 255, 0.75);
        border-color: rgba(255, 255, 255, 0.9);
        box-shadow: 0 5px 16px rgba(80, 112, 208, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.95);
      }
      #lsb-panel[data-effective-theme="light"] .lsb-tab { color: var(--lsb-fg-sec, #4a5068); }
      #lsb-panel[data-effective-theme="light"] .lsb-tab:hover { color: var(--lsb-fg, #1e2030); }
      #lsb-panel[data-effective-theme="light"] .lsb-tab.active { color: #173263; text-shadow: none; }
      @keyframes lsb-panel-in {
        from { opacity: 0; transform: translateY(10px) scale(0.97); }
        to { opacity: 1; transform: none; }
      }
      /* right-center placement: vertical middle; must win over the entrance
         animation's transform so the panel stays centered after it ends. */
      #lsb-panel[data-pos="RC"] {
        top: 50%;
        transform: translateY(-50%);
        animation: lsb-panel-in-rc 0.45s var(--ease);
      }
      @keyframes lsb-panel-in-rc {
        from { opacity: 0; transform: translateY(calc(-50% + 10px)) scale(0.97); }
        to { opacity: 1; transform: translateY(-50%); }
      }
      #lsb-panel:hover {
        border-color: rgba(138, 164, 244, 0.35);
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.55), 0 0 40px rgba(107, 140, 239, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }

      /* ================= collapsed: 48px brand pill ================= */
      #lsb-panel:not(.lsb-open) {
        width: 48px !important; height: 48px !important;
        min-width: 48px !important; max-width: 48px !important; max-height: 48px !important;
        border-radius: 16px;
        background: linear-gradient(135deg, #7a9bf5 0%, #5a7de0 45%, #5bb5a6 100%);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4), 0 0 24px rgba(107, 140, 239, 0.4);
        cursor: pointer;
      }
      @media (hover: hover) {
        #lsb-panel:not(.lsb-open):hover {
          transform: scale(1.1);
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45), 0 0 36px rgba(120, 160, 255, 0.55);
        }
      }
      #lsb-panel:not(.lsb-open) .lsb-glow { display: none; }
      #lsb-panel:not(.lsb-open) .lsb-hdr {
        padding: 0; justify-content: center; align-items: center;
        height: 100%; min-height: 0; background: none;
      }
      #lsb-panel:not(.lsb-open) .lsb-hdr-text,
      #lsb-panel:not(.lsb-open) .lsb-hdr-btns,
      #lsb-panel:not(.lsb-open) .lsb-chevron,
      #lsb-panel:not(.lsb-open) .lsb-notif-dot { display: none; }
      #lsb-panel:not(.lsb-open) .lsb-site-icon {
        width: 26px; height: 26px; border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.45);
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.12), 0 2px 10px rgba(0, 0, 0, 0.3);
      }
      /* body max-height: LDStatus calc(var(--h) - 180px); we cap with min() */
      #lsb-panel .lsb-content { min-height: 0; }
      #lsb-panel .lsb-details.lsb-open-scroll { overflow-y: auto; }
      #lsb-panel:not(.lsb-open) .lsb-details { max-height: 0 !important; opacity: 0; visibility: hidden; }
      #lsb-panel:not(.lsb-open) .lsb-dot {
        position: absolute; top: 3px; right: 3px;
        width: 12px; height: 12px;
        border: 2px solid rgba(0, 0, 0, 0.35);
        box-shadow: none;
      }

      /* ================= header: gradient brand band ================= */
      #lsb-panel .lsb-hdr {
        position: relative; z-index: 1;
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; min-height: 52px;
        cursor: pointer;
        background: linear-gradient(135deg, #5a7de0 0%, #4a6bc9 100%);
        overflow: hidden;
        flex-shrink: 0;
        transition: filter 0.25s ease;
      }
      #lsb-panel .lsb-hdr::before {
        content: ""; position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.1) 0%, transparent 100%);
        pointer-events: none;
      }
      #lsb-panel .lsb-hdr::after {
        content: ""; position: absolute; top: -70%; left: -30%; width: 160%; height: 220%;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.18) 0%, transparent 55%);
        opacity: 0; transition: opacity 0.5s; pointer-events: none;
      }
      #lsb-panel .lsb-hdr:hover::after { opacity: 1; }
      #lsb-panel .lsb-hdr:hover { filter: brightness(1.05); }
      #lsb-panel .lsb-site-icon {
        width: 26px; height: 26px; border-radius: 7px;
        border: 2px solid rgba(255, 255, 255, 0.25);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        object-fit: cover; flex-shrink: 0;
        position: relative; z-index: 1;
      }
      #lsb-panel .lsb-hdr-text {
        display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
        min-width: 0; flex: 1 1 0; overflow: hidden; position: relative; z-index: 1;
      }
      #lsb-panel .lsb-title {
        font-weight: 800; font-size: 14px; letter-spacing: -0.02em;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; max-width: 100%;
      }
      /* animated gradient app name (LDStatus .ldsp-app-name) */
      #lsb-panel .lsb-app-name {
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        background: linear-gradient(90deg, #a8c0f8, #7a9eef, #7cc9bc, #7a9eef, #a8c0f8);
        background-size: 200% auto;
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
        animation: lsb-gradient-shift 6s ease infinite;
      }
      @keyframes lsb-gradient-shift {
        0% { background-position: 0% center; }
        50% { background-position: 100% center; }
        100% { background-position: 0% center; }
      }
      #lsb-panel .lsb-ver { display: inline-flex; line-height: 1.3; }
      #lsb-panel .lsb-dot {
        width: 10px; height: 10px; border-radius: 50%;
        background: rgba(255, 255, 255, 0.7); flex: none; position: relative; z-index: 1;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
        transition: background 0.2s ease, box-shadow 0.2s ease;
      }
      #lsb-panel .lsb-dot.lsb-loading  { background: rgba(255,255,255,0.75); box-shadow: 0 0 0 2px rgba(255,255,255,0.4); animation: lsb-dot-pulse 1.2s ease-in-out infinite; }
      #lsb-panel .lsb-dot.lsb-signed   { background: var(--lsb-ok, #5bb5a6); box-shadow: 0 0 0 2px rgba(255,255,255,0.5), 0 0 14px rgba(91, 181, 166, 0.9); }
      #lsb-panel .lsb-dot.lsb-unsigned { background: var(--lsb-warn, #d4a853); box-shadow: 0 0 0 2px rgba(255,255,255,0.5), 0 0 14px rgba(212, 168, 83, 0.9); }
      #lsb-panel .lsb-dot.lsb-guest    { background: rgba(255, 255, 255, 0.75); box-shadow: 0 0 0 2px rgba(255,255,255,0.4); }
      @keyframes lsb-dot-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.45; transform: scale(0.75); }
      }
      #lsb-panel .lsb-hdr-info { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; position: relative; z-index: 1; }
      /* site icon + version stacked (LDStatus .ldsp-site-wrap) */
      #lsb-panel .lsb-site-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; flex-shrink: 0; }
      #lsb-panel .lsb-site-ver { font-size: 9px; font-weight: 700; color: #fff; text-align: center; background: rgba(0, 0, 0, 0.25); padding: 1px 5px; border-radius: 5px; letter-spacing: 0.02em; }
      #lsb-panel .lsb-hdr-btns { display: flex; align-items: center; gap: 4px; position: relative; z-index: 1; }
      #lsb-panel .lsb-hdr-btn {
        width: 28px; height: 28px; border-radius: var(--r-sm);
        display: flex; align-items: center; justify-content: center;
        border: none;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        cursor: pointer; backdrop-filter: blur(4px);
        font-size: 12px;
        transition: background 0.15s ease, box-shadow 0.2s ease, transform 0.25s var(--ease);
      }
      #lsb-panel .lsb-hdr-btn:hover {
        background: rgba(255, 255, 255, 0.25);
        transform: translateY(-2px) scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
      /* Force the icon SVGs to their intended size — this site's layout
         otherwise collapses the intrinsic width (renders as a sliver). */
      #lsb-panel .lsb-hdr-btn svg {
        width: 16px; height: 16px; flex: none;
      }
      #lsb-panel .lsb-hdr-btn:active { transform: translateY(0) scale(0.94); }
      #lsb-panel .lsb-notif-dot {
        position: relative;
        min-width: 18px; height: 18px; padding: 0 5px;
        border-radius: 9999px;
        background: linear-gradient(135deg, var(--lsb-err-light, #ea9aa8), var(--lsb-danger, #e07a8d));
        color: #fff;
        font-size: 10px; line-height: 18px; font-weight: 700;
        text-align: center;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7), 0 2px 12px rgba(224, 122, 141, 0.7);
      }
      #lsb-panel .lsb-notif-dot[hidden] { display: none !important; }
      #lsb-panel [hidden] { display: none !important; }
      #lsb-panel .lsb-chevron {
        display: flex; color: #fff; opacity: 0.85; position: relative; z-index: 1;
        transition: transform 0.3s var(--ease), opacity 0.2s;
      }
      #lsb-panel.lsb-open .lsb-chevron { transform: rotate(180deg); opacity: 1; }

      /* ================= body ================= */
      #lsb-panel .lsb-details {
        position: relative; z-index: 1;
        max-height: 0; opacity: 0; visibility: hidden;
        overflow: hidden;
        font-size: 12px;
        transform: translateY(-8px);
        transition: max-height 0.38s var(--ease), opacity 0.24s ease,
          transform 0.34s var(--ease), visibility 0s linear 0.38s;
      }
      #lsb-panel.lsb-open .lsb-details {
        max-height: 560px; opacity: 1; visibility: visible;
        transform: translateY(0);
        overflow-y: auto;
        transition: max-height 0.38s var(--ease), opacity 0.24s ease, transform 0.34s var(--ease);
      }

      /* ================= user card: hero ================= */
      #lsb-panel .lsb-user {
        position: relative; z-index: 1;
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(72px, 92px); align-items: stretch; gap: 10px;
        padding: 10px 16px 10px;
        background: var(--lsb-bg-card, rgba(24, 26, 36, 0.92));
        border-bottom: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.06));
      }
      #lsb-panel .lsb-user::before {
        content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg, transparent, rgba(107, 140, 239, 0.3), transparent);
      }
      #lsb-panel .lsb-user-left { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      #lsb-panel .lsb-user-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
      #lsb-panel .lsb-user-status { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      /* avatar: LDStatus .ldsp-avatar — accent border, no gradient frame */
      #lsb-panel .lsb-avatar-frame {
        width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
        padding: 0; display: block; background: none; box-shadow: none;
      }
      #lsb-panel .lsb-avatar {
        width: 44px; height: 44px; border-radius: 12px;
        object-fit: cover; display: block;
        border: 2px solid var(--lsb-accent, #6b8cef);
        background: var(--lsb-bg-el, rgba(32, 35, 48, 0.9));
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(107, 140, 239, 0.2);
        transition: transform 0.3s var(--ease), box-shadow 0.3s, border-color 0.2s;
      }
      #lsb-panel .lsb-avatar:hover { transform: scale(1.08) rotate(-3deg); border-color: var(--lsb-accent-light, #8aa4f4); box-shadow: 0 6px 20px rgba(107, 140, 239, 0.35); }
      #lsb-panel .lsb-user-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      #lsb-panel .lsb-user-name {
        font-size: 16px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3;
        background: linear-gradient(90deg, var(--lsb-fg, #e4e6ed) 0%, var(--lsb-fg-sec, #9499ad) 110%);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #lsb-panel .lsb-user-meta {
        font-size: 12px; color: var(--lsb-fg-mut, #5d6275);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      /* stats card (LDStatus .ldsp-reading slot): check-in streak */
      #lsb-panel .lsb-stats {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        padding: 8px 8px 6px; border-radius: var(--r-md); align-self: stretch;
        min-width: 84px; width: min(100%, 92px); max-width: min(100%, calc(var(--lsb-w, 320px) * 0.46));
        aspect-ratio: 2 / 1;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 100%), var(--lsb-bg-card, rgba(24, 26, 36, 0.92));
        border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.08));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        position: relative; overflow: hidden;
      }
      #lsb-panel .lsb-stats::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 50% 0%, rgba(107, 140, 239, 0.12), transparent 70%); pointer-events: none; }
      #lsb-panel .lsb-stats-icon { font-size: 23px; line-height: 1; margin-bottom: 4px; position: relative; animation: lsb-stats-bounce 3s ease-in-out infinite; }
      @keyframes lsb-stats-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      #lsb-panel .lsb-stats-num { font-size: 15px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; position: relative; }
      #lsb-panel .lsb-stats-label {
        display: inline-flex; align-items: center; justify-content: center;
        min-height: 18px; padding: 0 8px; border-radius: 999px; position: relative;
        background: rgba(107, 140, 239, 0.16); border: 1px solid rgba(107, 140, 239, 0.24);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
        font-size: 9px; color: var(--lsb-fg-sec, #9499ad); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      }

      /* demo-style progress ring inside the stats card (LDStatus .ldsp-ring) */
      #lsb-panel .lsb-stats-ring { position: relative; width: 46px; height: 46px; margin-bottom: 2px; }
      #lsb-panel .lsb-stats-ring svg { transform: rotate(-90deg); width: 100%; height: 100%; overflow: visible; }
      #lsb-panel .lsb-ring-bg { stroke: var(--lsb-bg-el, rgba(32, 35, 48, 0.88)); }
      #lsb-panel .lsb-ring-fill { stroke: url(#lsb-ring-grad); transition: stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1); }
      #lsb-panel .lsb-stats-ring .lsb-stats-num {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 800; letter-spacing: -0.02em; line-height: 1;
      }
      #lsb-panel .lsb-hero-signed {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; font-weight: 700; color: var(--lsb-ok, #5bb5a6);
        padding: 7px 16px; border-radius: 999px;
        background: var(--lsb-ok-bg, rgba(91, 181, 166, 0.12));
        border: 1px solid var(--lsb-ok, #5bb5a6);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 10px rgba(91, 181, 166, 0.12);
      }
      #lsb-panel .lsb-hero-btn {
        appearance: none; border: none; cursor: pointer;
        font: inherit; font-size: 12px; font-weight: 700;
        padding: 8px 20px; border-radius: 999px;
        color: #fff;
        background: linear-gradient(135deg, var(--lsb-accent, #6b8cef), var(--lsb-accent-light, #8aa4f4));
        box-shadow: 0 4px 14px rgba(107, 140, 239, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25);
        transition: filter 0.18s ease, box-shadow 0.18s ease, transform 0.18s var(--ease);
      }
      #lsb-panel .lsb-hero-btn:hover {
        filter: brightness(1.08);
        box-shadow: 0 6px 20px rgba(107, 140, 239, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }
      #lsb-panel .lsb-hero-btn:active { transform: translateY(0) scale(0.98); }
      #lsb-panel .lsb-hero-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; transform: none; }

      /* ================= check-in pane (LDStatus .ldsp-reqs slot) ================= */
      #lsb-panel .lsb-checkin-hero {
        display: flex; align-items: center; gap: 16px;
        padding: 16px; margin-bottom: 10px;
        background: var(--lsb-bg-card, rgba(24, 26, 36, 0.92));
        border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.06));
        border-radius: var(--r-md);
        position: relative; overflow: hidden;
      }
      #lsb-panel .lsb-checkin-hero::before {
        content: ""; position: absolute; inset: 0;
        background: radial-gradient(circle at 30% 0%, rgba(107, 140, 239, 0.1), transparent 70%);
        pointer-events: none;
      }
      #lsb-panel .lsb-checkin-ring { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
      #lsb-panel .lsb-checkin-ring svg { transform: rotate(-90deg); }
      #lsb-panel .lsb-checkin-ring .lsb-ring-bg { stroke: var(--lsb-bg-el, rgba(32, 35, 48, 0.88)); }
      #lsb-panel .lsb-checkin-ring .lsb-ring-fill { stroke: url(#lsb-ring-grad); }
      #lsb-panel .lsb-checkin-ring-val {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: 800; letter-spacing: -0.02em;
      }
      #lsb-panel .lsb-checkin-stats { display: flex; gap: 24px; position: relative; z-index: 1; }
      #lsb-panel .lsb-checkin-stat { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 44px; }
      #lsb-panel .lsb-checkin-stat-val { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
      #lsb-panel .lsb-checkin-stat-val.ok { color: var(--lsb-ok, #5bb5a6); }
      #lsb-panel .lsb-checkin-stat-lbl { font-size: 9px; color: var(--lsb-fg-mut, #5d6275); font-weight: 600; white-space: nowrap; }
      #lsb-panel .lsb-checkin-status {
        font-size: 12px; font-weight: 600; text-align: center;
        padding: 9px 12px; border-radius: 10px; margin-bottom: 10px;
        color: var(--lsb-ok, #5bb5a6);
        background: var(--lsb-ok-bg, rgba(91, 181, 166, 0.12));
        border: 1px solid var(--lsb-ok, #5bb5a6);
      }

      /* ================= tabs: floating glass + sliding indicator ================= */
      #lsb-panel .lsb-tabs {
        position: relative; z-index: 1; display: flex; gap: 5px;
        padding: 7px 9px;
        margin: 8px 10px 6px;
        background: rgba(32, 36, 50, 0.62);
        backdrop-filter: blur(20px) saturate(175%);
        -webkit-backdrop-filter: blur(20px) saturate(175%);
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 14px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.16);
        overflow: hidden;
        flex-shrink: 0;
      }
      #lsb-panel .lsb-tab-indicator {
        position: absolute; top: 5px; left: 6px; height: calc(100% - 10px);
        border-radius: 10px; pointer-events: none; z-index: 0;
        opacity: 0;
        transition: left 0.42s cubic-bezier(0.32, 1.2, 0.32, 1), width 0.32s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.22s ease;
      }
      #lsb-panel .lsb-tab-indicator.show { opacity: 1; }
      #lsb-panel .lsb-tab-indicator-glass {
        position: absolute; inset: 0; border-radius: inherit;
        background: rgba(255, 255, 255, 0.14);
        box-shadow: 0 7px 16px rgba(42, 64, 120, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -1px 0 rgba(0, 0, 0, 0.18);
        border: 1px solid rgba(138, 164, 244, 0.4);
      }
      #lsb-panel .lsb-tab-indicator-shine {
        position: absolute; top: 1px; left: 10%; right: 10%; height: 46%;
        border-radius: 8px 8px 50% 50%;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.12) 45%, transparent 100%);
        pointer-events: none;
      }
      #lsb-panel .lsb-tab {
        position: relative; z-index: 1;
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        padding: 7px 8px;
        border: none; background: transparent;
        color: var(--lsb-fg-sec, #9499ad);
        font: inherit; font-size: 11px; font-weight: 600;
        border-radius: 10px; cursor: pointer;
        white-space: nowrap; min-width: 0; overflow: hidden;
        transition: color 0.2s, transform 0.15s;
      }
      #lsb-panel .lsb-tab::before {
        content: ""; position: absolute; inset: 0; border-radius: inherit;
        background: linear-gradient(150deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.02) 55%, transparent 100%);
        opacity: 0; transition: opacity 0.2s;
      }
      #lsb-panel .lsb-tab::after {
        content: ""; position: absolute; top: 1px; left: 12%; right: 12%; height: 48%;
        border-radius: 8px 8px 50% 50%;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 45%, transparent 100%);
        opacity: 0; transition: opacity 0.2s;
      }
      #lsb-panel .lsb-tab .lsb-tab-ic { display: inline-flex; flex: none; position: relative; z-index: 1; transition: transform 0.25s var(--ease); }
      #lsb-panel .lsb-tab:hover { color: var(--lsb-fg, #e4e6ed); transform: translateY(-1px); }
      #lsb-panel .lsb-tab:hover::before { opacity: 1; }
      #lsb-panel .lsb-tab.active { color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }
      #lsb-panel .lsb-tab.active::before { opacity: 0.3; }
      #lsb-panel .lsb-tab.active::after { opacity: 0.7; }
      #lsb-panel .lsb-tab.active .lsb-tab-ic { transform: scale(1.1); }

      /* ================= content + sections ================= */
      #lsb-panel .lsb-pane { display: none; }
      #lsb-panel .lsb-pane.active { display: block; animation: lsb-enter 0.22s var(--ease-out); }
      #lsb-panel .lsb-section { padding: 10px; }
      #lsb-panel .lsb-section-title {
        font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
        color: var(--lsb-fg-mut, #5d6275); margin: 8px 2px 8px; font-weight: 700;
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
      }
      #lsb-panel .lsb-notif-badge {
        font-size: 10px; font-weight: 700; color: var(--lsb-accent-light, #8aa4f4);
        background: rgba(107, 140, 239, 0.12);
        border: 1px solid rgba(107, 140, 239, 0.3);
        border-radius: 999px; padding: 0 8px; min-width: 18px; text-align: center; line-height: 18px;
      }
      #lsb-panel .lsb-notif-list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow: auto; }
      #lsb-panel .lsb-notif-list li {
        padding: 10px 12px; margin-bottom: 6px; border-radius: 12px; font-size: 12px;
        background: var(--lsb-bg-card, rgba(24, 26, 36, 0.7));
        border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.05));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        transition: background 0.16s ease, border-color 0.16s ease, transform 0.18s var(--ease);
      }
      #lsb-panel .lsb-notif-list li:hover {
        background: var(--lsb-bg-hover, rgba(38, 42, 56, 0.9));
        border-color: rgba(107, 140, 239, 0.3);
        transform: translateY(-1px);
      }
      #lsb-panel .lsb-notif-list a {
        color: var(--lsb-fg-sec, #9499ad); text-decoration: none; transition: color 0.16s ease;
        display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #lsb-panel .lsb-notif-list li:hover a { color: var(--lsb-fg, #e4e6ed); }
      #lsb-panel .lsb-notif-list .lsb-mention { color: var(--lsb-accent-light, #8aa4f4); font-weight: 600; }
      #lsb-panel .lsb-notif-list .lsb-empty { opacity: 0.55; font-style: italic; padding: 8px; }
      @keyframes lsb-enter {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: none; }
      }

      /* ================= settings dropdown (LDStatus .ldsp-settings-menu) ================= */
      #lsb-panel .lsb-settings-menu {
        position: absolute; top: 34px; left: 8px; right: auto; z-index: 30;
        width: clamp(220px, 85%, 300px);
        padding: 8px;
        background: var(--lsb-bg-card, rgba(24, 26, 36, 0.97));
        border: 1px solid var(--lsb-border2, rgba(255, 255, 255, 0.1));
        border-radius: 12px;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        opacity: 0; pointer-events: none;
        transform: translateY(-8px) scale(0.98);
        transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      }
      #lsb-panel.settings-open .lsb-settings-menu { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
      #lsb-panel .lsb-settings-head { display: flex; align-items: center; padding: 4px 6px 8px; border-bottom: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.06)); margin-bottom: 8px; }
      #lsb-panel .lsb-settings-head-title { font-size: 12px; font-weight: 700; }
      #lsb-panel .lsb-settings-nav {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        width: 100%; padding: 9px 10px; margin-bottom: 6px;
        border: 1px solid transparent; border-radius: 10px;
        background: var(--lsb-bg-el, rgba(32, 35, 48, 0.8));
        font-size: 11px; text-align: left; cursor: pointer;
        transition: background 0.15s, border-color 0.15s, transform 0.15s;
      }
      #lsb-panel .lsb-settings-nav:hover { background: var(--lsb-bg-hover, rgba(38, 42, 56, 0.95)); border-color: var(--lsb-border2, rgba(255, 255, 255, 0.1)); transform: translateY(-1px); }
      #lsb-panel .lsb-settings-nav-main { display: flex; align-items: center; gap: 8px; font-weight: 600; min-width: 0; }
      #lsb-panel .lsb-settings-nav-value { font-size: 10px; color: var(--lsb-fg-mut, #5d6275); }
      #lsb-panel .lsb-settings-nav-arrow { font-size: 13px; color: var(--lsb-fg-mut, #5d6275); }
      #lsb-panel .lsb-settings-view { display: none; padding: 2px; }
      #lsb-panel .lsb-settings-view.active { display: block; animation: lsb-settings-in 0.22s var(--ease-out); }
      @keyframes lsb-settings-in {
        from { opacity: 0; transform: translateX(10px); }
        to { opacity: 1; transform: none; }
      }
      @keyframes lsb-settings-out {
        from { opacity: 1; transform: none; }
        to { opacity: 0; transform: translateX(-10px); }
      }
      #lsb-panel .lsb-settings-back {
        width: 24px; height: 24px; border: none; border-radius: 7px;
        background: var(--lsb-bg-el, rgba(32, 35, 48, 0.88));
        color: var(--lsb-fg-sec, #9499ad); font-size: 14px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; flex-shrink: 0;
        transition: background 0.15s, color 0.15s, transform 0.15s;
      }
      #lsb-panel .lsb-settings-back:hover { background: var(--lsb-bg-hover, rgba(38, 42, 56, 0.95)); color: var(--lsb-fg, #e4e6ed); transform: translateX(-1px); }
      #lsb-panel .lsb-settings-toggle {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 9px 10px; margin-top: 6px; border-radius: 10px;
        background: var(--lsb-bg-el, rgba(32, 35, 48, 0.8)); border: 1px solid transparent;
        font-size: 11px; transition: background 0.15s, border-color 0.15s;
      }
      #lsb-panel .lsb-settings-toggle:hover { background: var(--lsb-bg-hover, rgba(38, 42, 56, 0.95)); border-color: var(--lsb-border2, rgba(255, 255, 255, 0.1)); }
      #lsb-panel .lsb-settings-toggle-main { display: flex; align-items: center; gap: 8px; font-weight: 600; }
      /* the settings host inside the dropdown (theme segments) */
      #lsb-panel .lsb-settings {
        padding: 2px 2px 8px;
        max-height: 240px;
        overflow-y: auto;
        background: none;
      }
      #lsb-panel .lsb-settings[hidden] { display: none !important; }
      #lsb-panel .lsb-settings h4 {
        margin: 8px 0 10px; font-size: 10px; opacity: 0.75;
        text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700;
      }
      #lsb-panel .lsb-settings .lsb-row {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; padding: 6px 0; cursor: pointer;
        color: var(--lsb-fg-sec, #9499ad);
        transition: color 0.15s ease;
      }
      #lsb-panel .lsb-settings .lsb-row:hover { color: var(--lsb-fg, #e4e6ed); }
      #lsb-panel .lsb-settings input[type=checkbox], #lsb-panel .lsb-settings input[type=radio] {
        accent-color: var(--lsb-accent, #6b8cef);
      }
      #lsb-panel .lsb-setting-block { margin: 12px 0; }
      #lsb-panel .lsb-setting-name {
        display: block;
        font-size: 10px; letter-spacing: 0.1em;
        color: var(--lsb-fg-mut, #5d6275);
        margin-bottom: 8px; font-weight: 600;
      }
      #lsb-panel .lsb-seg-group { display: flex; flex-wrap: wrap; gap: 6px; }
      #lsb-panel .lsb-seg { position: relative; cursor: pointer; }
      #lsb-panel .lsb-seg input { position: absolute; opacity: 0; pointer-events: none; }
      #lsb-panel .lsb-seg span {
        display: inline-flex; align-items: center;
        padding: 6px 14px; border-radius: 999px;
        font-size: 12px; color: var(--lsb-fg-sec, #9499ad);
        background: var(--lsb-bg-hover, rgba(38, 42, 56, 0.9));
        border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.08));
        transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
        user-select: none;
      }
      #lsb-panel .lsb-seg:hover span { color: var(--lsb-fg, #e4e6ed); border-color: var(--lsb-accent, #6b8cef); }
      #lsb-panel .lsb-seg.active span {
        background: linear-gradient(135deg, var(--lsb-accent, #6b8cef), var(--lsb-accent-light, #8aa4f4));
        color: #fff; border-color: transparent;
        box-shadow: 0 2px 10px rgba(107, 140, 239, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25);
      }
      #lsb-panel .lsb-action {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 12px 16px;
        border-top: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.06));
        background: var(--lsb-bg-card, rgba(24, 26, 36, 0.8));
      }
      #lsb-panel .lsb-action .lsb-label { color: var(--lsb-fg-sec, #9499ad); font-weight: 600; font-size: 12px; }
      #lsb-panel .lsb-switch {
        position: relative; display: inline-block;
        width: 38px; height: 21px; flex: none;
      }
      #lsb-panel .lsb-switch input { opacity: 0; width: 0; height: 0; }
      #lsb-panel .lsb-switch .lsb-slider {
        position: absolute; inset: 0;
        background: var(--lsb-fg-mut, #5d6275);
        border-radius: 999px;
        transition: background 0.22s ease, box-shadow 0.22s ease;
        cursor: pointer;
      }
      #lsb-panel .lsb-switch .lsb-slider::before {
        content: ""; position: absolute;
        left: 2px; top: 2px;
        width: 17px; height: 17px;
        background: #fff; border-radius: 50%;
        transition: transform 0.22s var(--ease);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
      }
      #lsb-panel .lsb-switch input:checked + .lsb-slider {
        background: var(--lsb-accent, #6b8cef);
        box-shadow: 0 0 14px rgba(107, 140, 239, 0.45);
      }
      #lsb-panel .lsb-switch input:checked + .lsb-slider::before { transform: translateX(17px); }

      /* custom scrollbar: hidden until scrolling */
      #lsb-panel ::-webkit-scrollbar { width: 5px; height: 5px; }
      #lsb-panel ::-webkit-scrollbar-track { background: transparent; }
      #lsb-panel ::-webkit-scrollbar-thumb {
        background: transparent;
        border-radius: 999px;
        transition: background 0.25s ease;
      }
      #lsb-panel ::-webkit-scrollbar-thumb:hover { background: var(--lsb-scrollbar-hover, rgba(140,150,175,0.7)); }
      #lsb-panel .lsb-scrolling::-webkit-scrollbar-thumb { background: var(--lsb-scrollbar, rgba(140,150,175,0.5)); }
      #lsb-panel * { scrollbar-width: thin; scrollbar-color: var(--lsb-scrollbar, rgba(140,150,175,0.5)) transparent; }
    `);

    // Toast CSS (injected once, follows panel theme via CSS variables)
    GM_addStyle('\x23lsb-toast-container{position:fixed;bottom:12px;right:12px;z-index:2147483647;display:flex;flex-direction:column-reverse;gap:10px;pointer-events:none}' +
      '.lsb-toast{pointer-events:auto;max-width:320px;padding:11px 15px;border-radius:12px;font:13px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--lsb-fg,#e4e6ed);background:var(--lsb-bg-card,rgba(24,26,36,0.92));border:1px solid var(--lsb-border,rgba(255,255,255,0.06));box-shadow:var(--lsb-shadow,0 20px 48px rgba(0,0,0,0.4));backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);display:flex;align-items:center;gap:9px;animation:lsb-toast-in .28s cubic-bezier(.22,1,.36,1);transition:opacity .2s,transform .2s}' +
      '.lsb-toast.lsb-toast-out{opacity:0;transform:translateX(24px)}' +
      '@keyframes lsb-toast-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}' +
      '.lsb-toast[data-type=success]{border-left:3px solid var(--lsb-ok,#5bb5a6)}' +
      '.lsb-toast[data-type=error]{border-left:3px solid var(--lsb-danger,#e07a8d)}' +
      '.lsb-toast[data-type=info]{border-left:3px solid var(--lsb-accent,#6b8cef)}' +
      '.lsb-toast-icon{flex:none;font-size:14px}' +
      '.lsb-toast-msg{flex:1;min-width:0}');

    // -----------------------------------------------------------------
    // Build the panel.  Sections are rendered later from the registry.
    // -----------------------------------------------------------------
    const root = document.createElement("div");
    root.id = "lsb-panel";
    root.dataset.pos = LSB.panelStyle ? LSB.panelStyle.pos : "BR";
    root.dataset.theme = LSB.panelStyle ? LSB.panelStyle.theme : "auto";
        root.innerHTML = `
      <div class="lsb-glow" aria-hidden="true"></div>
      <div class="lsb-hdr lsb-compact" data-lsb="compact">
        <div class="lsb-hdr-info">
          <div class="lsb-site-wrap">
            <img class="lsb-site-icon" src="https://linux.sb/app/assets/index.svg" alt="linux.sb" data-lsb="site-icon" />
            <span class="lsb-site-ver">v<span data-lsb="version">0.0.0</span></span>
          </div>
          <div class="lsb-hdr-text">
            <span class="lsb-title">linux.sb 助手</span>
            <span class="lsb-ver"><span class="lsb-app-name">linux.sb Suite</span></span>
          </div>
        </div>
        <span class="lsb-dot lsb-loading" data-lsb="dot" title="载入中"></span>
        <div class="lsb-hdr-btns">
          <button type="button" class="lsb-hdr-btn" data-lsb="refresh" title="刷新"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
          <button type="button" class="lsb-hdr-btn" data-lsb="gear" title="${LSB.i18n.t("panel.settings")}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.6"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
          <button type="button" class="lsb-hdr-btn" data-lsb="update" title="检查更新"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
        </div>
        <span class="lsb-chevron"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
      </div>
      <div class="lsb-settings-menu" aria-hidden="true">
        <div class="lsb-settings-view active" data-settings-view="root">
          <div class="lsb-settings-head">
            <span class="lsb-settings-head-title">${LSB.i18n.t("panel.settings")}</span>
          </div>
          <div class="lsb-settings-body">
            <button type="button" class="lsb-settings-nav" data-settings-open="theme">
              <span class="lsb-settings-nav-main">🎨 ${LSB.i18n.t("panel.theme")}</span>
              <span class="lsb-settings-nav-value" data-lsb="theme-value">--</span>
              <span class="lsb-settings-nav-arrow">›</span>
            </button>
            <div class="lsb-settings-toggle">
              <span class="lsb-settings-toggle-main">⚡ ${LSB.i18n.t("signin.auto")}</span>
              <label class="lsb-switch">
                <input type="checkbox" data-lsb="auto" />
                <span class="lsb-slider"></span>
              </label>
            </div>
          </div>
        </div>
        <div class="lsb-settings-view" data-settings-view="theme">
          <div class="lsb-settings-head">
            <button type="button" class="lsb-settings-back" data-settings-back="root" aria-label="返回">‹</button>
            <span class="lsb-settings-head-title">🎨 ${LSB.i18n.t("panel.theme")}</span>
          </div>
          <div class="lsb-settings" data-lsb="settings"></div>
        </div>
      </div>
      <div class="lsb-details">
        <div class="lsb-user" data-lsb="rank-row">
          <div class="lsb-user-left">
            <div class="lsb-user-row">
              <span class="lsb-avatar-frame"><img class="lsb-avatar" data-lsb="avatar" alt="" /></span>
              <div class="lsb-user-info">
                <span class="lsb-user-name" data-lsb="name">…</span>
                <span class="lsb-user-meta" data-lsb="meta">—</span>
              </div>
            </div>
            <div class="lsb-user-status">
              <span data-lsb="signin-text" class="lsb-hero-signed" hidden>✓ ${LSB.i18n.t("signin.status.signed")}</span>
              <button type="button" class="lsb-hero-btn" data-lsb="signin" hidden>签到</button>
            </div>
          </div>
          <div class="lsb-stats" data-lsb="stats">
            <div class="lsb-stats-ring" data-lsb="stats-ring">
              <svg viewBox="0 0 42 42" width="42" height="42">
                <defs><linearGradient id="lsb-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#5070d0"/><stop offset="100%" stop-color="#5bb5a6"/></linearGradient></defs>
                <circle class="lsb-ring-bg" cx="21" cy="21" r="16.5" fill="none" stroke-width="4.5"/>
                <circle class="lsb-ring-fill" data-lsb="ring-fill" cx="21" cy="21" r="16.5" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="103.67" stroke-dashoffset="103.67"/>
              </svg>
              <span class="lsb-stats-num" data-lsb="stats-streak">--</span>
            </div>
            <span class="lsb-stats-label">连续签到</span>
          </div>
        </div>
        <div class="lsb-tabs" data-lsb="tabs">
          <div class="lsb-tab-indicator"><div class="lsb-tab-indicator-glass"></div><div class="lsb-tab-indicator-shine"></div></div>
          <button type="button" class="lsb-tab active" data-lsb-tab="checkin">
            <span class="lsb-tab-ic">📋</span>
            <span class="lsb-tab-text">${LSB.i18n.t("checkin.title")}</span>
          </button>
          <button type="button" class="lsb-tab" data-lsb-tab="notif">
            <span class="lsb-tab-ic">🔔</span>
            <span class="lsb-tab-text">${LSB.i18n.t("notif.title")}</span>
          </button>
          <button type="button" class="lsb-tab" data-lsb-tab="history">
            <span class="lsb-tab-ic">🕘</span>
            <span class="lsb-tab-text">${LSB.i18n.t("history.title")}</span>
          </button>
          <button type="button" class="lsb-tab" data-lsb-tab="settings">
            <span class="lsb-tab-ic">⚙️</span>
            <span class="lsb-tab-text">${LSB.i18n.t("panel.settings")}</span>
          </button>
        </div><div class="lsb-content">
          <div class="lsb-pane active" data-lsb-pane="checkin">
            <div class="lsb-sections" data-lsb="sections-checkin"></div>
          </div>
          <div class="lsb-pane" data-lsb-pane="notif">
            <div class="lsb-sections" data-lsb="sections"></div>
          </div>
          <div class="lsb-pane" data-lsb-pane="history">
            <div class="lsb-sections" data-lsb="sections-history"></div>
          </div>
          <div class="lsb-pane" data-lsb-pane="settings"></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);

    // Node reference table: collect the static skeleton's [data-lsb] nodes
    // once (inlined from lib/dom-refs.mjs) instead of re-querying per access.
    // Dynamic content (sections host, notif list, toast) is still queried on
    // demand because it is re-created on re-render.
    const refs = (typeof collectRefs === "function") ? collectRefs(root) : {};
    const $ = (key) => refs[key] || root.querySelector(`[data-lsb="${key}"]`);
    // The header site icon is the site's real favicon (index.svg). If it
    // ever fails to load (offline / 404), hide it rather than showing a
    // broken-image glyph.
    const siteIcon = $("site-icon");
    if (siteIcon) siteIcon.addEventListener("error", () => { siteIcon.hidden = true; }, { once: true });
    const dot = $("dot");
    const nameEl = $("name");
    const avatarEl = $("avatar");
    const signinBtn = $("signin");
    const signinText = $("signin-text");
    const autoInput = $("auto");
    const versionEl = $("version");
    const sectionsHost = $("sections");
    const settingsHost = $("settings");
    const gear = $("gear");
    versionEl.textContent = LSB.version; // template already renders the "v" prefix

    // Latest signin status cache (populated by refresh()) for the
    // check-in pane section (LDStatus .ldsp-reqs slot).
    let _signinStatusCache = null;
    if (LSB.sections) {
      LSB.sections.register("checkin-summary", {
        order: 0,
        pane: "checkin",
        hidden: () => !isLoggedIn(),
        render: () => {
          const status = _signinStatusCache;
          const stats = (status && status.stats) || {};
          const streak = Number(stats.streak) || 0;
          const total = Number(stats.total) || 0;
          const pct = Math.max(0, Math.min(100, streak / 30 * 100));
          const circ = 103.67; // 2πr, r=16.5
          const off = circ * (1 - pct / 100);
          const signed = status && status.status === "signed-in";
          return { innerHTML:
            `<div class="lsb-checkin-hero">
              <div class="lsb-checkin-ring">
                <svg viewBox="0 0 42 42" width="64" height="64">
                  <defs><linearGradient id="lsb-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#5070d0"/><stop offset="100%" stop-color="#5bb5a6"/></linearGradient></defs>
                  <circle class="lsb-ring-bg" cx="21" cy="21" r="16.5" fill="none" stroke-width="4.5"/>
                  <circle class="lsb-ring-fill" data-lsb="ring-fill" cx="21" cy="21" r="16.5" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${off}"/>
                </svg>
                <span class="lsb-checkin-ring-val">${pct}%</span>
              </div>
              <div class="lsb-checkin-stats">
                <div class="lsb-checkin-stat"><span class="lsb-checkin-stat-val ok">${streak}</span><span class="lsb-checkin-stat-lbl">连续签到</span></div>
                <div class="lsb-checkin-stat"><span class="lsb-checkin-stat-val">${total}</span><span class="lsb-checkin-stat-lbl">累计签到</span></div>
              </div>
            </div>
            <div class="lsb-checkin-status">${signed ? "✓ 今日已签到" : "今日未签到"}</div>`,
          };
        },
      });
    }

    // Restore the persisted panel open/close state (LDStatus Panel borrow).
    try { if (LSB.storage.get("panel.open")) root.classList.add("lsb-open"); } catch (e) { /* ignore */ }

    // Clicking the avatar opens the profile.
    avatarEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const url = avatarEl.dataset.profileUrl;
      if (url) window.open(url, "_blank", "noopener");
    });

    function isLoggedIn() {
      return !!(user && user.info && user.info.id);
    }

    // Sections are rendered from the registry.  Modules register their
    // own section (e.g. notif) and the host fills them in.
    function rerenderSections() {
      if (!LSB.sections) return;
      // Check-in pane: checkin-scoped sections.
      const checkinHost = $("sections-checkin");
      if (checkinHost) {
        const outCheck = LSB.sections.render({ isLoggedIn: isLoggedIn(), pane: "checkin" });
        checkinHost.innerHTML = outCheck.innerHTML;
      }
      // Notifications pane: notif-scoped sections.
      const out = LSB.sections.render({ isLoggedIn: isLoggedIn(), pane: "notif" });
      sectionsHost.innerHTML = out.innerHTML;
      // History pane: history-scoped sections.
      const histHost = $("sections-history");
      if (histHost) {
        const outHist = LSB.sections.render({ isLoggedIn: isLoggedIn(), pane: "history" });
        histHost.innerHTML = outHist.innerHTML;
      }
    }

    // Apply the panel position + theme.  Reads from LSB.panelStyle
    // (the source of truth) and sets the matching data attributes +
    // CSS variables on the root element.
    function applyPanelStyle(payload) {
      const pos = (payload && payload.pos) || (LSB.panelStyle ? LSB.panelStyle.pos : "BR");
      const theme = (payload && payload.theme) || (LSB.panelStyle ? LSB.panelStyle.theme : "auto");
      root.dataset.pos = pos;
      root.dataset.theme = theme;
      const effective = (theme === "auto")
        ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      root.dataset.effectiveTheme = effective; // drives light/dark CSS variants
      if (typeof getPalette === "function" && effective !== "auto") {
        try {
          const p = getPalette(effective);
          // Apply the FULL token set on the panel AND documentElement so the
          // toast (outside #lsb-panel) follows the theme. PALETTE_TOKENS is
          // inlined from core/css.mjs.
          const tokens = (typeof PALETTE_TOKENS === "object" && PALETTE_TOKENS) || [
            ["bg", "--lsb-bg"], ["fg", "--lsb-fg"], ["border", "--lsb-border"], ["shadow", "--lsb-shadow"],
          ];
          for (const [field, cssVar] of tokens) {
            if (p[field] == null) continue;
            root.style.setProperty(cssVar, p[field]);
            document.documentElement.style.setProperty(cssVar, p[field]);
          }
        } catch (e) { /* unknown theme */ }
      }
    }

    // Render the notification badge on the compact row, and populate
    // the notif list inside the section (re-queried because the
    // section was just re-rendered by rerenderSections()).
    // Diff-style (inlined from lib/notif-view.mjs): when nothing visible
    // changed, the 60s poll tick becomes a no-op so the panel never flashes.
    let _notifViewPrev = null;
    function renderNotif(payload) {
      let diff;
      if (typeof notifViewDiff === "function") {
        diff = notifViewDiff(_notifViewPrev, payload);
      } else {
        // Fallback (lib not inlined): always render, like the old code.
        const u = (payload || {}).unread || 0;
        diff = { unread: u, dotText: u > 9 ? "9+" : (u > 0 ? String(u) : ""), dotHidden: u === 0, listChanged: true, list: (payload || {}).list || [] };
      }
      _notifViewPrev = payload || { unread: 0, list: [] };
      if (!diff) return;

      let notifDot = root.querySelector(".lsb-notif-dot");
      if (!notifDot) {
        notifDot = document.createElement("span");
        notifDot.className = "lsb-notif-dot";
        const compact = root.querySelector(".lsb-compact");
        if (compact) compact.insertBefore(notifDot, compact.querySelector(".lsb-chevron"));
      }
      notifDot.textContent = diff.dotText;
      notifDot.hidden = diff.dotHidden;
      const listEl = root.querySelector('[data-lsb="notif-list"]');
      const countEl = root.querySelector('[data-lsb="notif-count"]');
      if (countEl && countEl.textContent !== String(diff.unread)) countEl.textContent = String(diff.unread);
      if (listEl && diff.listChanged) {
        listEl.innerHTML = "";
        const list = diff.list;
        if (!list.length) {
          const li = document.createElement("li");
          li.className = "lsb-empty";
          li.textContent = LSB.i18n.t("notif.empty");
          listEl.appendChild(li);
        } else {
          for (const item of list) {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = item.url; a.target = "_blank"; a.rel = "noopener";
            a.textContent = item.title;
            if (item.isMention) a.classList.add("lsb-mention");
            li.appendChild(a);
            listEl.appendChild(li);
          }
        }
      }
    }

    // Render the settings popover from the registry.  Any module that
    // registered a setting gets a row in here.
    function renderSettings() {
      if (!LSB.settings) return;
      const defs = LSB.settings.list();
      const groups = LSB.settings.groups();
      const html = [];
      for (const g of groups) {
        const groupDefs = defs.filter((x) => x.group === g && !x.hidden);
        if (!groupDefs.length) continue; // skip groups with no visible settings
        // Group header: prefer the i18n table (settings.group.<key>), fall
        // back to the raw key.
        html.push(`<h4>${LSB.i18n.t("settings.group." + g) || g}</h4>`);
        for (const d of groupDefs) {
          const s = LSB.settings.get(d.key);
          // Label: a plain string wins; otherwise look the SETTINGS KEY up in
          // the i18n table (e.g. "panel.pos" -> 位置). Passing the label
          // object to t() would render as "[object Object]".
          const label = (typeof d.label === "string")
            ? d.label
            : (LSB.i18n.t(d.key) || d.key);
          if (d.type === "boolean") {
            html.push(`<label class="lsb-row"><input type="checkbox" data-lsb-setting="${d.key}"${s.get() ? " checked" : ""}><span>${label}</span></label>`);
          } else if (d.type === "enum") {
            // Each enum setting gets its own named block with segmented
            // pill options — much clearer than a long radio column.
            html.push(`<div class="lsb-setting-block">`);
            html.push(`<span class="lsb-setting-name">${label}</span>`);
            html.push(`<div class="lsb-seg-group">`);
            for (const opt of d.options) {
              const optLabel = LSB.i18n.t(d.key + "." + opt) || opt;
              const active = s.get() === opt ? " active" : "";
              html.push(`<label class="lsb-seg${active}"><input type="radio" name="lsb-${d.key}" data-lsb-setting="${d.key}" data-lsb-value="${opt}"${active ? " checked" : ""}><span>${optLabel}</span></label>`);
            }
            html.push(`</div></div>`);
          }
        }
      }
      settingsHost.innerHTML = html.join("");
      const tv = $("theme-value");
      if (tv && LSB.panelStyle) {
        const label = ({ auto: "跟随系统", light: "浅色", dark: "深色" })[LSB.panelStyle.theme] || LSB.panelStyle.theme;
        tv.textContent = label;
      }
    }
    settingsHost.addEventListener("change", (ev) => {
      const el = ev.target.closest("[data-lsb-setting]");
      if (!el) return;
      const key = el.getAttribute("data-lsb-setting");
      const def = LSB.settings.list().find((d) => d.key === key);
      if (!def) return;
      const s = LSB.settings.get(key);
      if (def.type === "boolean") s.set(el.checked);
      else s.set(el.getAttribute("data-lsb-value") || el.value);
      // Keep the root-view label in sync after a change (theme etc.).
      const tv = $("theme-value");
      if (tv && key === "panel.theme" && LSB.panelStyle) {
        const label = ({ auto: "跟随系统", light: "浅色", dark: "深色" })[LSB.panelStyle.theme] || LSB.panelStyle.theme;
        tv.textContent = label;
      }
      // Keep the segmented control's .active class in sync with the chosen value.
      if (key === "panel.theme") {
        const chosen = el.getAttribute("data-lsb-value") || el.value;
        settingsHost.querySelectorAll(".lsb-seg").forEach((seg) => {
          const input = seg.querySelector("input");
          seg.classList.toggle("active", !!input && (input.getAttribute("data-lsb-value") || input.value) === chosen);
        });
      }
    });
    // Gear opens the settings dropdown (LDStatus-style), always reset to root view.
    gear.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setOpen(true);
      renderSettings();
      setSettingsView("root");
      root.classList.add("settings-open");
    });
    // LDStatus-style dropdown: multi-view navigation (root → sub-views).
    // Any [data-settings-open] row switches to its view; [data-settings-back]
    // returns to root. The settings host (theme segments) lives in the theme view.
    function setSettingsView(name) {
      root.querySelectorAll('.lsb-settings-view').forEach((v) => {
        v.classList.toggle('active', v.dataset.settingsView === name);
      });
    }
    const settingsMenu = root.querySelector('.lsb-settings-menu');
    if (settingsMenu) {
      settingsMenu.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const back = ev.target.closest('[data-settings-back]');
        if (back) {
          renderSettings();
          setSettingsView(back.dataset.settingsBack || "root");
          return;
        }
        const open = ev.target.closest('[data-settings-open]');
        if (open) { renderSettings(); setSettingsView(open.dataset.settingsOpen || "root"); return; }
      });
    }
    // Tab switching (LDStatus .ldsp-tabs with a sliding indicator).
    function updateTabIndicator() {
      const container = root.querySelector(".lsb-tabs");
      const indicator = container ? container.querySelector(".lsb-tab-indicator") : null;
      const active = container ? container.querySelector(".lsb-tab.active") : null;
      if (!container || !indicator || !active) return;
      indicator.style.left = active.offsetLeft + "px";
      indicator.style.width = active.offsetWidth + "px";
      indicator.classList.add("show");
    }
    function activateTab(name) {
      if (name === "settings") {
        // Settings "tab" opens the settings dropdown directly.
        root.querySelectorAll(".lsb-tab").forEach((t) => t.classList.toggle("active", t.dataset.lsbTab === "settings"));
        root.querySelectorAll(".lsb-pane").forEach((p) => p.classList.remove("active"));
        updateTabIndicator();
        renderSettings();
        setSettingsView("root");
        root.classList.add("settings-open");
        return;
      }
      root.querySelectorAll(".lsb-tab").forEach((t) => t.classList.toggle("active", t.dataset.lsbTab === name));
      root.querySelectorAll(".lsb-pane").forEach((p) => p.classList.toggle("active", p.dataset.lsbPane === name));
      root.classList.remove("settings-open");
      updateTabIndicator();
    }
    root.querySelectorAll(".lsb-tab").forEach((t) => {
      t.addEventListener("click", () => activateTab(t.dataset.lsbTab));
    });
    updateTabIndicator();

    // Wire the in-panel auto-signin toggle.  signin.setAutoSignin() is the
    // ONLY writer — it persists through the settings registry ("signin.auto")
    // and emits signin:auto-changed, which (re)starts the auto-checkin poller.
    if (LSB.settings) {
      const s = LSB.settings.get("signin.auto");
      autoInput.checked = !!s.get();
      // Reflect external changes (e.g. the settings registry being written
      // programmatically) back onto the switch.
      s.subscribe((v) => { autoInput.checked = !!v; });
    }
    autoInput.addEventListener("change", () => {
      const next = autoInput.checked;
      signin.setAutoSignin(next);
      log_user.info("auto-signin toggled", next);
    });

    // Persisted open/close state: the panel remembers whether it was expanded.
    function setOpen(open) {
      root.classList.toggle("lsb-open", open);
      if (!open) root.classList.remove("settings-open");
      try { LSB.storage.set("panel.open", !!open, 0); } catch (e) { /* ignore */ }
    }

    // Compact / popover toggle. Header buttons (refresh/gear) and the notif
    // badge handle their own clicks; anything else in the header toggles.
    $("compact").addEventListener("click", (ev) => {
      if (ev.target.closest("button") || ev.target.closest(".lsb-notif-dot")) return;
      setOpen(!root.classList.contains("lsb-open"));
    });
    // Header refresh button.
    const refreshBtn = $("refresh");
    if (refreshBtn) refreshBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      refresh().catch((e) => log_user.warn(e));
    });
    // Header update button: re-fetch data and toast the current version.
    const updateBtn = $("update");
    if (updateBtn) updateBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      refresh().catch((e) => log_user.warn(e));
      if (LSB.toast && typeof LSB.toast.show === "function") {
        LSB.toast.show("当前版本 v" + LSB.version, { type: "info", durationMs: 3000 });
      }
    });

    // Scrollbar auto-hide (LDStatus-style): any scroll inside the panel
    // briefly reveals the themed scrollbar (.lsb-scrolling), then fades it
    // out after 800ms. Captured so it also works for non-bubbling scroll
    // events, and delegated so it survives section re-renders.
    root.addEventListener("scroll", (ev) => {
      const el = ev.target;
      if (!el || el === root || typeof el.classList !== "object") return;
      el.classList.add("lsb-scrolling");
      clearTimeout(el._lsbScrollTimer);
      el._lsbScrollTimer = setTimeout(() => el.classList.remove("lsb-scrolling"), 800);
    }, true);
    document.addEventListener("click", (ev) => {
      if (!root.classList.contains("lsb-open")) return;
      if (root.contains(ev.target)) return;
      setOpen(false);
      root.classList.remove("settings-open");
    });

    signinBtn.addEventListener("click", async () => {
      signinBtn.disabled = true;
      const orig = signinBtn.textContent;
      signinBtn.textContent = "签到中…";
      try {
        const r = await signin.performSignin();
        signinBtn.textContent = r.ok ? LSB.i18n.t("signin.status.signed") : "签到失败";
        if (r.ok) {
          setTimeout(() => refresh().catch(() => {}), 600);
          // Toast on manual signin success
          if (LSB.toast && typeof LSB.toast.show === "function") {
            var days = (r.stats && r.stats.total) ? "，累计签到 " + r.stats.total + " 天" : "";
            LSB.toast.show("签到成功 ✓" + days, { type: "success" });
          }
        }
      } catch (err) {
        signinBtn.textContent = "签到失败";
        log_signin.warn(err);
        if (LSB.toast && typeof LSB.toast.show === "function") {
          LSB.toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
        }
      } finally {
        signinBtn.disabled = false;
        setTimeout(() => { signinBtn.textContent = orig; }, 1500);
      }
    });

    function _signinLabel(status) {
      return {
        "signed-in": LSB.i18n.t("signin.status.signed"),
        "not-signed-in": LSB.i18n.t("signin.status.unsigned"),
        "guest": LSB.i18n.t("signin.status.guest"),
        "unknown": LSB.i18n.t("signin.status.unknown"),
      }[status] || status;
    }

    // Event subscriptions.
    events.on("notif:updated", renderNotif);
    events.on("panel:reapply", applyPanelStyle);
    applyPanelStyle();
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", () => applyPanelStyle());
    }

    async function refresh() {
      const u = await user.getCurrent();
      rerenderSections();
      if (!u) {
        avatarEl.removeAttribute("src");
        nameEl.textContent = "未登录";
        dot.className = "lsb-dot lsb-guest";
        dot.title = LSB.i18n.t("signin.status.guest");
        if (signinText) signinText.hidden = true;
        signinBtn.hidden = true;
        $("rank-row").hidden = true;
        return;
      }
      if (u.avatarUrl) avatarEl.src = u.avatarUrl;
      nameEl.textContent = u.nickname || `用户 #${u.id}`;
      if (u.profileUrl) avatarEl.dataset.profileUrl = u.profileUrl;

      if (typeof signin.getAutoSignin === "function") {
        autoInput.checked = !!signin.getAutoSignin();
      }

      try {
        const s = await signin.getStatus();
        _signinStatusCache = s; // for the check-in pane section
        const dotCls = {
          "signed-in": "lsb-signed",
          "not-signed-in": "lsb-unsigned",
          "guest": "lsb-guest",
        }[s.status] || "lsb-loading";
        dot.className = "lsb-dot " + dotCls;
        dot.title = _signinLabel(s.status);
        const isSigned = s.status === "signed-in";
        const isPending = s.status === "not-signed-in";
        // Stats card (LDStatus .ldsp-reading slot): check-in streak.
        const streakEl = $("stats-streak");
        const streak = (s.stats && s.stats.streak) ? Number(s.stats.streak) : 0;
        if (streakEl) streakEl.textContent = streak ? String(streak) : "--";
        // Drive the progress ring: streak toward a 30-day goal (LDStatus .ldsp-ring-fill).
        const ringFill = $("ring-fill");
        if (ringFill) {
          const circ = 103.67; // 2πr, r=16.5
          const pct = Math.max(0, Math.min(100, streak / 30 * 100));
          const off = circ * (1 - pct / 100);
          requestAnimationFrame(() => { ringFill.style.strokeDashoffset = String(off); });
        }
        // Sign-in hero in the user card.
        if (signinText) signinText.hidden = !isSigned;
        signinBtn.hidden = !isPending;
        $("rank-row").hidden = !(isSigned || isPending);
        // User meta line: rank · points · signin streak.
        const rankParts = u.rank ? u.rank.split("·").map((x) => x.trim()).filter(Boolean) : [];
        const metaBits = [];
        if (rankParts[0]) metaBits.push(rankParts[0]);
        if (u.points != null && u.points !== "") metaBits.push("积分 " + u.points);
        if (s.stats && s.stats.streak) metaBits.push("连续签到 " + s.stats.streak + " 天");
        $("meta").textContent = metaBits.join(" · ") || "—";
      } catch (err) {
        if (signinText) signinText.hidden = true;
        signinBtn.hidden = true;
        log_signin.warn(err);
      }
    }

    events.on("user:changed", () => refresh().catch((e) => log_user.warn(e)));
    events.on("user:route-changed", () => refresh().catch((e) => log_user.warn(e)));
    events.on("signin:status-changed", () => refresh().catch((e) => log_user.warn(e)));

    refresh().catch((e) => log.warn(e));

    return { name: "ui", refresh };
  }, ["config", "dom", "events", "user", "signin", "panelStyle"]);

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
    // Run every module's init() hook now that all factories are resolved
    // (e.g. notif.bindUser subscribes to user:changed and starts polling).
    // Factories run in registration order, so subscribers (ui) exist before
    // publishers (panelStyle, notif) emit their boot events.
    for (const [name, entry] of _registry) {
      if (!entry.enabled || !entry.instance || typeof entry.instance.init !== "function") continue;
      // Optional match(ctx) gate (nodeseek borrow): skip init when it returns false.
      if (entry.match) {
        try {
          const userInst = _registry.get("user") ? _registry.get("user").instance : null;
          const ctx = { config: LSB.config, href: location.href, user: (userInst && userInst.info) || null };
          if (!entry.match(ctx)) continue;
        } catch (err) { (LSB.logger.make("register")).warn("match threw for", name, err); }
      }
      try { entry.instance.init(); }
      catch (err) { (LSB.logger.make("register")).error("init failed:", name, err); }
    }
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
