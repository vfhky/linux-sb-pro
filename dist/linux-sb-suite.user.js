// ==UserScript==
// @name         linux.sb 助手 / linux.sb Suite
// @namespace    https://github.com/vfhky/linux-sb-pro
// @version      1.1.5
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
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
/*
 * linux.sb Suite  -- public build
 * built: 2026-08-12T16:53:07.618Z
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

// =====================================================================
// Legacy notif layout (ul.notif-list with data-id / data-mention)
// =====================================================================

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

// =====================================================================
// Current linux.sb (1.1.3 era) layouts
// =====================================================================

/**
 * Home-page sidebar daily checkin card.
 * @param {object} [opts]
 * @param {"pending"|"done"} [opts.status="pending"]
 * @param {string} [opts.csrf="test-csrf-token"]
 * @param {{streak:number,total:number}} [opts.stats]
 * @param {number} [opts.reward] points to display in the badge when pending
 */
function dailyCheckinCard({ status = "pending", csrf = "test-csrf-token", stats = { streak: 0, total: 0 }, reward = 75 } = {}) {
  if (status === "done") {
    return `<div class="card sidebar-card daily-checkin-card">` +
      `<div class="daily-checkin-wrap">` +
        `<div class="daily-checkin-head">` +
          `<div>` +
            `<div class="daily-checkin-title">每日签到</div>` +
            `<div class="daily-checkin-sub">今天已签到</div>` +
          `</div>` +
          `<span class="daily-checkin-badge done">已签到</span>` +
        `</div>` +
        `<div class="daily-checkin-stats">` +
          `<div><strong>${stats.streak}</strong><span>连续天数</span></div>` +
          `<div><strong>${stats.total}</strong><span>累计签到</span></div>` +
        `</div>` +
        `<div class="daily-checkin-action">` +
          `<div class="daily-checkin-done">已完成</div>` +
        `</div>` +
      `</div>` +
      `</div>`;
  }
  return `<div class="card sidebar-card daily-checkin-card">` +
    `<div class="daily-checkin-wrap">` +
      `<div class="daily-checkin-head">` +
        `<div>` +
          `<div class="daily-checkin-title">每日签到</div>` +
          `<div class="daily-checkin-sub">今天待签到</div>` +
        `</div>` +
        `<span class="daily-checkin-badge">+${reward} 积分</span>` +
      `</div>` +
      `<div class="daily-checkin-stats">` +
        `<div><strong>${stats.streak}</strong><span>连续天数</span></div>` +
        `<div><strong>${stats.total}</strong><span>累计签到</span></div>` +
      `</div>` +
      `<div class="daily-checkin-action">` +
        `<form class="post-action-form" method="post" action="/daily_checkin">` +
          `<input type="hidden" name="_csrf" value="${csrf}">` +
          `<button type="submit" class="daily-checkin-btn">签到</button>` +
        `</form>` +
      `</div>` +
    `</div>` +
    `</div>`;
}

/**
 * Dedicated /daily_checkin page (different layout from the sidebar card).
 * Status text lives in `.admin-plugin-summary span`.
 */
function dailyCheckinPage({ status = "pending", csrf = "test-csrf-token", stats = { streak: 0, total: 0 } } = {}) {
  const statusText = status === "done" ? "今天已签到" : "今天待签到";
  const form = status === "done"
    ? `<div class="daily-checkin-done">已完成</div>`
    : `<form class="post-action-form" method="post" action="/daily_checkin">` +
      `<input type="hidden" name="_csrf" value="${csrf}">` +
      `<button type="submit" class="daily-checkin-btn">签到</button>` +
      `</form>`;
  return `<!doctype html><html><head><title>每日签到 - LINUX SB</title></head><body>` +
    `<div class="admin-list-panel plugin-manage-panel daily-checkin-page-panel">` +
      `<div class="admin-list-head">` +
        `<div class="admin-head-inline">` +
          `<div class="admin-head-left-slot">` +
            `<div class="admin-plugin-summary"><strong>每日签到</strong><span>${statusText}</span></div>` +
          `</div>` +
        `</div>` +
      `</div>` +
      `<div class="plugin-panel-body daily-checkin-page-body">` +
        `<div class="daily-checkin-stats daily-checkin-page-stats">` +
          `<div><strong>${stats.streak}</strong><span>连续天数</span></div>` +
          `<div><strong>${stats.total}</strong><span>累计签到</span></div>` +
        `</div>` +
        `<div class="daily-checkin-action daily-checkin-page-action">${form}</div>` +
      `</div>` +
    `</div>` +
    `</body></html>`;
}

/**
 * Right sidebar user card.
 * @param {object} [opts]
 * @param {boolean} [opts.loggedIn=true]
 * @param {number} [opts.userId=16056]
 * @param {string} [opts.nickname="myss"]
 * @param {string} [opts.rank="笔友"]
 * @param {number} [opts.points=177]
 * @param {string} [opts.avatarUrl] explicit avatar src; defaults to dicebear
 */
function userCard({ loggedIn = true, userId = 16056, nickname = "myss", rank = "笔友", points = 177, avatarUrl = "https://linux.sb/app/avatars/bottts-neutral_24.svg" } = {}) {
  if (loggedIn) {
    return `<div class="card sidebar-card user-card">` +
      `<div class="user-wrap">` +
        `<div class="user-header">` +
          `<div class="user-header-info">` +
            `<a class="user-avatar-big" href="/user/${userId}">` +
              `<img class="avatar-img" src="${avatarUrl}" alt="${nickname}" loading="lazy">` +
            `</a>` +
            `<div>` +
              `<a class="user-name" href="/user/${userId}">${nickname}</a>` +
              `<div class="user-rank">${rank} · 积分 ${points}</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="user-links">` +
          `<a href="/user/${userId}?tab=topics">我的主题</a>` +
          `<a href="/user/${userId}?tab=replies">我的回帖</a>` +
          `<a href="/user/${userId}?tab=points_rewards">我的积分</a>` +
        `</div>` +
      `</div>` +
      `<a class="btn-post" href="/topic_edit">+ 发帖</a>` +
      `</div>`;
  }
  // Visitor variant: same card shell, but avatar is a <div> letter placeholder
  // and the name link points to /login.
  const letter = (nickname || "G").slice(0, 1).toUpperCase();
  return `<div class="card sidebar-card user-card">` +
    `<div class="user-wrap">` +
      `<div class="user-header">` +
        `<div class="user-header-info">` +
          `<div class="user-avatar-big visitor-avatar">${letter}</div>` +
          `<div>` +
            `<a class="user-name" href="/login">登录</a>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</div>` +
    `</div>`;
}

/**
 * One notification item in the current site structure
 * (li.post-item.notification-item inside ul.post-list).
 * @param {object} opts
 * @param {"mention"|"reply"|"system"} [opts.kind="mention"]
 * @param {string} opts.content - body HTML (can include <a> tags)
 * @param {string} [opts.url]
 * @param {string} [opts.actor="actor"]
 * @param {string} [opts.age="刚刚"]
 */
function notificationItem({ kind = "mention", content = "", url = "/topic/100", actor = "actor", age = "刚刚" } = {}) {
  const kindZh = ({ mention: "提及", reply: "回复", system: "系统" })[kind] || "系统";
  return `<li class="post-item notification-item">` +
    `<div class="post-avatar"><a class="avatar-profile-link" href="/user/${actor}"><img class="avatar-img" src="/app/avatars/bottts-neutral_0.svg" alt="${actor}"></a></div>` +
    `<div class="post-body">` +
      `<div class="post-title-row notification-head">` +
        `<a class="post-title" href="/user/${actor}">${actor}</a>` +
        `<span class="post-user-group notification-kind">${kindZh}</span>` +
      `</div>` +
      `<div class="post-meta"><span>${age}</span></div>` +
      `<div class="post-content notification-content">${content}</div>` +
    `</div>` +
    `</li>`;
}

/**
 * Full /user/<id>?tab=notifications page body (just the post-list block).
 * @param {object} [opts]
 * @param {Array} [opts.items]
 */
function notificationPage({ items = [] } = {}) {
  return `<ul class="post-list">${items.map(notificationItem).join("")}</ul>`;
}

;
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
      return { ok: true, status: "signed-in", action: "none", source: "http-fetch" };
    }
    if (!before.csrf) {
      return { ok: false, status: before.status, reason: "no-csrf-token", source: "http-fetch" };
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
    const kindZh = kindMatch ? stripTags(kindMatch) : "";
    const title = stripTags(contentMatch).slice(0, 240);
    items.push({
      id: linkMatch ? linkMatch[1] : title,
      url: linkMatch ? linkMatch[1] : null,
      title,
      kind: kindFromZh(kindZh),
    });
    liRe.lastIndex = close + 5;
    if (items.length >= MAX_LIST) break;
  }
  return items;
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
  // "notification-item" class is unique to it.
  if (/notification-item/.test(html)) {
    const list = extractListNew(html);
    return { unread: list.length, list };
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
  const $ = (sel) => doc.querySelector(sel);
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
  const LSB = (root.LSB = { __booted: true, version: "1.1.5" });

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
          return merged;
        }
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
      // Delegate parsing to the structure-agnostic parseCheckinPage in
      // core/ (inlined from lib/checkin-parse.mjs). It handles both the
      // home-sidebar card AND the dedicated /daily_checkin page layout
      // (.admin-plugin-summary > span), so we never have to update
      // hardcoded selectors here when the site changes.
      const html = await LSB.http.getHtml(CHECKIN_URL);
      return { ...parseCheckinPage(html), source: "http-fetch" };
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
      });
    }

    function _startAuto() {
      const p = _ensurePoller();
      if (p) p.start();
    }
    function _stopAuto() {
      if (_signinPoller) { _signinPoller.stop(); _signinPoller = null; }
    }

    events.on("user:changed", (u) => {
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
    events.on("signin:auto", _persistLastSignedIn);
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

  LSB.register("ui", function ({ config, dom, events, user, signin, panelStyle, notif }) {
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
      #lsb-panel {
        position: fixed; z-index: 2147483646;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: var(--lsb-fg, #eee);
        background: var(--lsb-bg, rgba(20, 22, 28, 0.94));
        border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.08));
        border-radius: 8px;
        box-shadow: var(--lsb-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        user-select: none;
        max-width: 280px;
        min-width: 140px;
        overflow: hidden;
      }
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
      #lsb-panel .lsb-notif-dot {
        position: relative;
        min-width: 16px; height: 16px; padding: 0 4px;
        border-radius: 9999px; background: #e64545; color: #fff;
        font-size: 10px; line-height: 16px; font-weight: 600;
        text-align: center; box-shadow: 0 0 0 2px var(--lsb-bg, rgba(20,22,28,0.94));
        margin-left: -4px;
      }
      #lsb-panel .lsb-notif-dot[hidden] { display: none !important; }
      #lsb-panel [hidden] { display: none !important; }
      #lsb-panel .lsb-chevron {
        margin-left: auto; opacity: 0.5; font-size: 11px;
        transition: transform 0.2s ease;
      }
      #lsb-panel.lsb-open .lsb-chevron { transform: rotate(180deg); }

      #lsb-panel .lsb-details {
        display: none;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        padding: 0;
        font-size: 12px;
      }
      #lsb-panel.lsb-open .lsb-details { display: block; }
      #lsb-panel .lsb-section { padding: 8px 12px; border-top: 1px solid rgba(255,255,255,0.06); }
      #lsb-panel .lsb-section-title { font-size: 11px; opacity: 0.6; margin-bottom: 4px; }
      #lsb-panel .lsb-notif-list { list-style: none; margin: 0; padding: 0; max-height: 140px; overflow: auto; }
      #lsb-panel .lsb-notif-list li { padding: 3px 0; font-size: 12px; }
      #lsb-panel .lsb-notif-list a { color: inherit; text-decoration: none; opacity: 0.85; }
      #lsb-panel .lsb-notif-list a:hover { opacity: 1; text-decoration: underline; }
      #lsb-panel .lsb-notif-list .lsb-mention { color: #fbbf24; font-weight: 600; }
      #lsb-panel .lsb-notif-list .lsb-empty { opacity: 0.5; font-style: italic; }

      #lsb-panel .lsb-signin-row {
        display: flex; align-items: center; justify-content: center;
        min-height: 28px; padding: 8px 12px 0;
      }
      #lsb-panel .lsb-signed-text {
        color: #4ade80; font-size: 13px; font-weight: 600;
      }
      #lsb-panel .lsb-rank-row {
        display: flex; justify-content: center;
        padding: 4px 12px 0;
      }
      #lsb-panel .lsb-meta { color: #9ca3af; font-size: 11px; }
      #lsb-panel .lsb-action {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 10px 12px 0;
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
      #lsb-panel .lsb-gear {
        padding: 2px 6px; font-size: 12px; line-height: 1;
      }
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

      #lsb-panel .lsb-settings {
        padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.06);
        background: rgba(0,0,0,0.15);
      }
      #lsb-panel .lsb-settings[hidden] { display: none !important; }
      #lsb-panel .lsb-settings h4 { margin: 0 0 6px; font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
      #lsb-panel .lsb-settings label { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; cursor: pointer; }

      #lsb-panel .lsb-footer {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 0; padding: 8px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 11px; color: #6b7280;
      }
      #lsb-panel .lsb-footer a { color: #9ca3af; text-decoration: none; }
      #lsb-panel .lsb-footer a:hover { color: #e5e7eb; text-decoration: underline; }
    `);

    // -----------------------------------------------------------------
    // Build the panel.  Sections are rendered later from the registry.
    // -----------------------------------------------------------------
    const root = document.createElement("div");
    root.id = "lsb-panel";
    root.dataset.pos = LSB.panelStyle ? LSB.panelStyle.pos : "BR";
    root.dataset.theme = LSB.panelStyle ? LSB.panelStyle.theme : "auto";
    root.innerHTML = `
      <div class="lsb-compact" data-lsb="compact">
        <img class="lsb-avatar" data-lsb="avatar" alt="" />
        <span class="lsb-name" data-lsb="name">…</span>
        <span class="lsb-dot lsb-loading" data-lsb="dot" title="载入中"></span>
        <span class="lsb-chevron">▾</span>
      </div>
      <div class="lsb-details">
        <div class="lsb-sections" data-lsb="sections"></div>
        <div class="lsb-signin-row">
          <span data-lsb="signin-text" class="lsb-signed-text" hidden>✓ ${LSB.i18n.t("signin.status.signed")}</span>
          <button class="lsb-btn lsb-primary" data-lsb="signin" hidden>${LSB.i18n.t("signin.status.unsigned")}</button>
        </div>
        <div class="lsb-rank-row" data-lsb="rank-row">
          <span class="lsb-meta" data-lsb="rank">—</span>
        </div>
        <div class="lsb-action">
          <span class="lsb-label">${LSB.i18n.t("signin.auto")}</span>
          <label class="lsb-switch">
            <input type="checkbox" data-lsb="auto" />
            <span class="lsb-slider"></span>
          </label>
        </div>
        <div class="lsb-settings" data-lsb="settings" hidden></div>
        <div class="lsb-footer">
          <a data-lsb="profile" href="#" target="_blank" rel="noopener">${LSB.i18n.t("panel.title")}</a>
          <span data-lsb="version">v0.0.0</span>
          <button type="button" class="lsb-btn lsb-gear" data-lsb="gear" title="${LSB.i18n.t("panel.settings")}">⚙</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);

    const $ = (key) => root.querySelector(`[data-lsb="${key}"]`);
    const dot = $("dot");
    const nameEl = $("name");
    const avatarEl = $("avatar");
    const signinBtn = $("signin");
    const signinText = $("signin-text");
    const autoInput = $("auto");
    const profileLink = $("profile");
    const versionEl = $("version");
    const sectionsHost = $("sections");
    const settingsHost = $("settings");
    const gear = $("gear");
    versionEl.textContent = `v${LSB.version}`;

    function isLoggedIn() {
      return !!(user && user.info && user.info.id);
    }

    // Sections are rendered from the registry.  Modules register their
    // own section (e.g. notif) and the host fills them in.
    function rerenderSections() {
      if (!LSB.sections) return;
      const out = LSB.sections.render({ isLoggedIn: isLoggedIn() });
      sectionsHost.innerHTML = out.innerHTML;
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
      if (typeof getPalette === "function" && effective !== "auto") {
        try {
          const p = getPalette(effective);
          root.style.setProperty("--lsb-bg", p.bg);
          root.style.setProperty("--lsb-fg", p.fg);
          root.style.setProperty("--lsb-border", p.border);
          root.style.setProperty("--lsb-shadow", p.shadow);
        } catch (e) { /* unknown theme */ }
      }
    }

    // Render the notification badge on the compact row, and populate
    // the notif list inside the section (re-queried because the
    // section was just re-rendered by rerenderSections()).
    function renderNotif(payload) {
      const { unread, list } = payload || { unread: 0, list: [] };
      let notifDot = root.querySelector(".lsb-notif-dot");
      if (!notifDot) {
        notifDot = document.createElement("span");
        notifDot.className = "lsb-notif-dot";
        const compact = root.querySelector(".lsb-compact");
        if (compact) compact.insertBefore(notifDot, compact.querySelector(".lsb-chevron"));
      }
      notifDot.textContent = unread > 9 ? "9+" : (unread > 0 ? String(unread) : "");
      notifDot.hidden = unread === 0;
      const listEl = root.querySelector('[data-lsb="notif-list"]');
      const countEl = root.querySelector('[data-lsb="notif-count"]');
      if (countEl) countEl.textContent = String(unread);
      if (listEl) {
        listEl.innerHTML = "";
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
        html.push(`<h4>${g}</h4>`);
        for (const d of defs.filter((x) => x.group === g)) {
          const s = LSB.settings.get(d.key);
          const label = LSB.i18n.t(d.label) || d.key;
          if (d.type === "boolean") {
            html.push(`<label><input type="checkbox" data-lsb-setting="${d.key}"${s.get() ? " checked" : ""}> ${label}</label>`);
          } else if (d.type === "enum") {
            for (const opt of d.options) {
              const optLabel = LSB.i18n.t(d.label + "." + opt) || opt;
              html.push(`<label><input type="radio" name="lsb-${d.key}" data-lsb-setting="${d.key}" data-lsb-value="${opt}"${s.get() === opt ? " checked" : ""}> ${optLabel}</label>`);
            }
          }
        }
      }
      html.push(`<div style="text-align:right;margin-top:8px"><button type="button" class="lsb-btn" data-lsb="settings-close">${LSB.i18n.t("panel.close")}</button></div>`);
      settingsHost.innerHTML = html.join("");
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
    });
    settingsHost.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-lsb=settings-close]")) settingsHost.hidden = true;
    });
    gear.addEventListener("click", (ev) => {
      ev.stopPropagation();
      renderSettings();
      settingsHost.hidden = false;
    });
    document.addEventListener("click", (ev) => {
      if (settingsHost.hidden) return;
      if (settingsHost.contains(ev.target) || gear.contains(ev.target)) return;
      settingsHost.hidden = true;
    });

    // Wire the in-panel auto-signin toggle + the settings registry.
    if (LSB.settings) {
      const s = LSB.settings.get("signin.auto");
      autoInput.checked = !!s.get();
      autoInput.addEventListener("change", () => s.set(autoInput.checked));
      s.subscribe((v) => { autoInput.checked = !!v; });
    }
    autoInput.addEventListener("change", () => {
      const next = autoInput.checked;
      signin.setAutoSignin(next);
      log_user.info("auto-signin toggled", next);
    });

    // Compact / popover toggle.
    $("compact").addEventListener("click", (ev) => {
      if (ev.target.closest("[data-lsb]") && ev.target.dataset.lsb !== "compact") return;
      root.classList.toggle("lsb-open");
    });
    document.addEventListener("click", (ev) => {
      if (!root.classList.contains("lsb-open")) return;
      if (root.contains(ev.target)) return;
      root.classList.remove("lsb-open");
    });

    signinBtn.addEventListener("click", async () => {
      signinBtn.disabled = true;
      const orig = signinBtn.textContent;
      signinBtn.textContent = "签到中…";
      try {
        const r = await signin.performSignin();
        signinBtn.textContent = r.ok ? LSB.i18n.t("signin.status.signed") : "签到失败";
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
  }, ["config", "dom", "events", "user", "signin", "panelStyle", "notif"]);

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
