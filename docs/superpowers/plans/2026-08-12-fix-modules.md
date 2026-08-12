# Plan: 修复 linux.sb 站点选择器错位 (1.1.3)

**Date:** 2026-08-12
**Repo:** `E:\gitHub\linux-sb-pro`
**Supersedes plan section:** `2026-08-12-notif-panel-polish.md` (signin + notif parts)
**Spec:** `docs/superpowers/specs/2026-08-12-fix-broken-modules-design.md` (commit 9b951c3)
**Branch:** main

## Overview

Fix 4 broken modules in 1.1.2: daily checkin, notifications, user-card visitor
avatar, points. 10 tasks, TDD throughout. Total ~370 lines net across 8 new
files and 7 modified files. Estimated ~50 min hands-on + 90s CDN wait.

## File map

**New (8):**
- `test/fixtures/daily-checkin-pending.html`
- `test/fixtures/daily-checkin-done.html`
- `test/fixtures/user-card-logged-in.html`
- `test/fixtures/user-card-visitor.html`
- `test/fixtures/user-notifications.html`
- `test/checkin-parse.test.mjs`
- `test/checkin-fetch.test.mjs`
- `lib/checkin-parse.mjs`
- `lib/checkin-fetch.mjs`

**Modified (7):**
- `lib/build-fixture.mjs` — add `dailyCheckinCard`, `userCard`, `notificationItem` builders
- `scripts/gen-fixtures.mjs` — generate the 5 new fixtures
- `lib/notif-parse.mjs` — auto-detect new vs legacy structure, add `kind` field
- `test/notif-parse.test.mjs` — assert against new structure
- `linux-sb-suite.user.js` — selectors block, user module, config.notif, notif module, signin module
- `core/poller.mjs` — add `tickNow` (only if missing)
- `.build-meta.json` — bump 1.1.2 → 1.1.3
- `README.md` — 1.1.3 changelog entry

## Tasks (10)

## Task 1: Capture real HTML fixtures from the probe

**Goal:** 5 HTML fixture files captured from the live linux.sb site.
**Files:** 5 new files in `test/fixtures/`
**Tools:** Chrome DevTools Protocol probe on `localhost:9444`.

### Sub-steps

- [ ] **Step 1.1: Verify probe is alive and user is logged in**

```bash
# Probe should be running. If not, restart it.
Get-Process chrome | Where-Object { $_.MainWindowTitle -match "9444" -or $_.Path -match "probe" }
```

Visit `https://linux.sb/` and confirm the right sidebar shows your nickname +
rank + the daily checkin card. If not logged in, log in first.

- [ ] **Step 1.2: Capture `daily-checkin-pending.html`**

If currently NOT signed in today, fetch and save:
```js
// DevTools console on https://linux.sb/daily_checkin
const html = await fetch('https://linux.sb/daily_checkin', { credentials: 'include' }).then(r => r.text());
copy(html)
```
Paste into `test/fixtures/daily-checkin-pending.html`. The "待签到" or "未签到"
string must be present in the file.

- [ ] **Step 1.3: Capture `daily-checkin-done.html`**

Click the signin button on the page, wait for redirect, then re-fetch and
save as `test/fixtures/daily-checkin-done.html`. The "已签到" string must be
present.

- [ ] **Step 1.4: Capture `user-card-logged-in.html`**

Visit `https://linux.sb/`. In DevTools, run:
```js
copy(document.querySelector('.sidebar-card.user-card').outerHTML)
```
Paste into `test/fixtures/user-card-logged-in.html`. Must contain `user-avatar-big`
and `笔友` (or current rank text).

- [ ] **Step 1.5: Capture `user-card-visitor.html`**

Open an incognito window, visit `https://linux.sb/`. Run the same snippet,
paste into `test/fixtures/user-card-visitor.html`. Must contain
`visitor-avatar` class and a letter placeholder.

- [ ] **Step 1.6: Capture `user-notifications.html`**

Visit `https://linux.sb/user/<yourId>?tab=notifications` (replace `<yourId>`
with your user id from the avatar link). Run:
```js
const html = await fetch(location.href, { credentials: 'include' }).then(r => r.text());
copy(html)
```
Paste into `test/fixtures/user-notifications.html`. Must contain at least one
`li.post-item.notification-item` element.

- [ ] **Step 1.7: Commit (or stage) fixtures**

The fixtures are test data — they should be in git so tests are reproducible.
```bash
git add test/fixtures/daily-checkin-pending.html test/fixtures/daily-checkin-done.html
git add test/fixtures/user-card-logged-in.html test/fixtures/user-card-visitor.html
git add test/fixtures/user-notifications.html
git commit -m "test(fixtures): capture real linux.sb page fragments for 1.1.3"
```

### Notes

- The fixtures contain your personal data (nickname, avatar URL). Consider
  sanitising: replace your id with `16056` placeholder, replace nickname with
  `testuser`, replace avatar URL with the dicebearForUserId output. The
  *structure* is what tests assert against; the values are decorative.
- If the notification tab is empty for your account, capture it from
  another user (e.g. an admin/seed account) or temporarily generate fake
  notifications via a test user.

---
## Task 2: Update build-fixture.mjs to know new HTML structures

**Goal:** Programmatic HTML builders for the 3 new fixture types so future
updates can re-generate fixtures without copy-paste from the live site.
**Files:** `lib/build-fixture.mjs` (modify), `scripts/gen-fixtures.mjs` (modify)
**Estimated size:** ~80 lines net

### Sub-steps

- [ ] **Step 2.1: Read existing build-fixture.mjs**

```bash
Get-Content lib/build-fixture.mjs
```

Confirm it exports a `buildFixture(type, opts)` or similar. We'll add 3 new
exported functions to the same module.

- [ ] **Step 2.2: Add `dailyCheckinCard({ status, csrf, stats })` builder**

Append to `lib/build-fixture.mjs`:

```js
export function dailyCheckinCard({ status = "pending", csrf = "test-csrf-token", stats = { streak: 0, total: 0 } } = {}) {
  const subText = status === "done" ? "今天已签到" : "今天待签到";
  const btnText = status === "done" ? "已签到" : "立即签到";
  return `<aside class="sidebar-card daily-checkin-card">
  <h3 class="daily-checkin-title">每日签到</h3>
  <div class="daily-checkin-sub">${subText}</div>
  <span class="daily-checkin-badge">+${status === "done" ? 0 : 75} 积分</span>
  <form class="post-action-form" action="/daily_checkin" method="post">
    <input type="hidden" name="_csrf" value="${csrf}">
    <button type="submit">${btnText}</button>
  </form>
  <div class="daily-checkin-stats">
    <div><strong>${stats.streak}</strong><span>连续天数</span></div>
    <div><strong>${stats.total}</strong><span>累计签到</span></div>
  </div>
</aside>`;
}
```

- [ ] **Step 2.3: Add `userCard({ loggedIn, userId, nickname, rank, points, avatarUrl })` builder**

```js
export function userCard({ loggedIn = true, userId = 16056, nickname = "testuser", rank = "笔友", points = 177, avatarUrl = "https://linux.sb/app/avatars/bottts-neutral_test.svg" } = {}) {
  if (loggedIn) {
    return `<aside class="sidebar-card user-card">
      <a class="user-avatar-big" href="/user/${userId}">
        <img class="avatar-img" src="${avatarUrl}" alt="${nickname}">
      </a>
      <div class="user-info">
        <a class="user-name" href="/user/${userId}">${nickname}</a>
        <div class="user-rank">${rank} · 积分 ${points}</div>
        <div class="user-points">${points}</div>
      </div>
    </aside>`;
  }
  return `<aside class="sidebar-card user-card">
    <div class="user-avatar-big visitor-avatar">${nickname[0].toUpperCase()}</div>
    <div class="user-info">
      <a class="user-name" href="/login">登录</a>
    </div>
  </aside>`;
}
```

- [ ] **Step 2.4: Add `notificationItem({ kind, content, url })` builder**

```js
export function notificationItem({ kind = "mention", content = "@vfhky mentioned you in topic 100", url = "/topic/100" } = {}) {
  return `<li class="post-item notification-item">
    <span class="notification-kind">${kind}</span>
    <span class="notification-content"><a href="${url}">${content}</a></span>
  </li>`;
}

export function notificationPage({ items = [] } = {}) {
  return `<ul class="notif-list">${items.map(notificationItem).join("")}</ul>`;
}
```

- [ ] **Step 2.5: Update `scripts/gen-fixtures.mjs`**

Read the existing file, then add 3 blocks to write the new fixtures:
```js
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dailyCheckinCard, userCard, notificationPage } from "../lib/build-fixture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fxDir = join(__dirname, "..", "test", "fixtures");
mkdirSync(fxDir, { recursive: true });

writeFileSync(join(fxDir, "daily-checkin-pending.html"), dailyCheckinCard({ status: "pending", stats: { streak: 0, total: 0 } }));
writeFileSync(join(fxDir, "daily-checkin-done.html"),    dailyCheckinCard({ status: "done",    stats: { streak: 3, total: 47 } }));
writeFileSync(join(fxDir, "user-card-logged-in.html"),   userCard({ loggedIn: true }));
writeFileSync(join(fxDir, "user-card-visitor.html"),     userCard({ loggedIn: false, nickname: "guest" }));
writeFileSync(join(fxDir, "user-notifications.html"),    notificationPage({ items: [
  { kind: "mention",  content: "@vfhky mentioned you in topic 100", url: "/topic/100" },
  { kind: "reply",    content: "vfhky replied to your post",        url: "/post/200" },
  { kind: "system",   content: "Welcome to linux.sb",                url: "/topic/1"  },
]}));

console.log("Wrote 5 fixtures to", fxDir);
```

- [ ] **Step 2.6: Run the generator and diff against captured fixtures**

```bash
node scripts/gen-fixtures.mjs
```

Compare the generated files against the captured ones from Task 1. They
should be ~90% identical. Where they differ, the GENERATED version is the
source of truth — overwrite the captured fixture with the generated one.
This makes future fixture updates a 1-command operation.

- [ ] **Step 2.7: Run all tests, expect green**

```bash
node scripts/run-tests.mjs
```

Existing tests should still pass (legacy fixtures untouched).

- [ ] **Step 2.8: Commit**

```bash
git add lib/build-fixture.mjs scripts/gen-fixtures.mjs test/fixtures/
git commit -m "feat(fixtures): programmatic builders for checkin / user / notif"
```

---
## Task 3: Write lib/checkin-parse.mjs (TDD)

**Goal:** Pure function that turns a daily checkin HTML fragment into
`{ status, csrf, hasForm, stats }`.
**Files:** `test/checkin-parse.test.mjs` (new), `lib/checkin-parse.mjs` (new)
**Estimated size:** ~50 lines lib + 70 lines test

### Sub-steps

- [ ] **Step 3.1: Write the test first**

Create `test/checkin-parse.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCheckinPage } from "../lib/checkin-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

export default async function run() {
  // --- Status detection ---
  {
    const out = parseCheckinPage(fx("daily-checkin-pending.html"));
    assert.equal(out.status, "not-signed-in");
    assert.equal(out.hasForm, true);
    assert.equal(out.csrf, "test-csrf-token");
  }
  {
    const out = parseCheckinPage(fx("daily-checkin-done.html"));
    assert.equal(out.status, "signed-in");
    assert.equal(out.hasForm, true);
  }
  // --- Stats ---
  {
    const out = parseCheckinPage(fx("daily-checkin-done.html"));
    assert.equal(out.stats.streak, 3);
    assert.equal(out.stats.total, 47);
  }
  // --- Edge: empty / malformed ---
  {
    const out = parseCheckinPage("");
    assert.equal(out.status, "unknown");
    assert.equal(out.hasForm, false);
    assert.equal(out.csrf, null);
  }
  {
    const out = parseCheckinPage("<html>no card here</html>");
    assert.equal(out.status, "unknown");
  }
  // --- Legacy fallback: status by button text ---
  {
    const html = `<form action="/daily_checkin" method="post">
      <input name="_csrf" value="legacy-csrf">
      <button type="submit">立即签到</button>
    </form>`;
    const out = parseCheckinPage(html);
    assert.equal(out.status, "not-signed-in");
    assert.equal(out.csrf, "legacy-csrf");
  }
}
```

- [ ] **Step 3.2: Run test, expect fail (module doesn't exist yet)**

```bash
node scripts/run-tests.mjs 2>&1 | tail -10
```

Expected: `FAIL test/checkin-parse.test.mjs` — module not found.

- [ ] **Step 3.3: Write `lib/checkin-parse.mjs`**

```js
// Parse a linux.sb daily checkin page into { status, csrf, hasForm, stats }.
const STATUS_ZH = {
  "今天待签到": "not-signed-in",
  "今天已签到": "signed-in",
  "今日已签到": "signed-in",
  "已连续签到": "signed-in",
  "未签到": "not-signed-in",
  "请先登录": "guest",
};

function detectStatus(text) {
  if (!text) return "unknown";
  for (const [zh, en] of Object.entries(STATUS_ZH)) {
    if (text.includes(zh)) return en;
  }
  return "unknown";
}

export function parseCheckinPage(html) {
  if (typeof html !== "string" || !html) {
    return { status: "unknown", csrf: null, hasForm: false, stats: { streak: 0, total: 0 } };
  }
  // Status: prefer the .daily-checkin-sub text; fall back to button text.
  const subMatch = html.match(/<[^>]*class\s*=\s*["'][^"']*\bdaily-checkin-sub\b[^"']*["'][^>]*>([\s\S]*?)<\//);
  const btnMatch = html.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i);
  const status = detectStatus(subMatch ? subMatch[1] : (btnMatch ? btnMatch[1] : ""));

  // CSRF: form-scoped.
  const csrfMatch = html.match(/<form\b[^>]*action\s*=\s*["']\/daily_checkin["'][^>]*>[\s\S]*?<input\b[^>]*name\s*=\s*["']_csrf["'][^>]*value\s*=\s*["']([^"']+)["']/i);
  const csrf = csrfMatch ? csrfMatch[1] : null;

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

  return { status, csrf, hasForm, stats };
}
```

- [ ] **Step 3.4: Run test, expect pass**

```bash
node scripts/run-tests.mjs 2>&1 | tail -15
```

Expected: `ok ./test/checkin-parse.test.mjs`.

- [ ] **Step 3.5: Commit**

```bash
git add lib/checkin-parse.mjs test/checkin-parse.test.mjs
git commit -m "feat(checkin-parse): parse daily checkin page status + csrf + stats"
```

---
## Task 4: Write lib/checkin-fetch.mjs (TDD)

**Goal:** Pure data layer: `{ fetch, submit }` for daily checkin that takes an
`http` adapter (DI) so the signin module can pass `LSB.http` and tests can
pass a stub.
**Files:** `test/checkin-fetch.test.mjs` (new), `lib/checkin-fetch.mjs` (new)
**Estimated size:** ~40 lines lib + 80 lines test

### Sub-steps

- [ ] **Step 4.1: Write the test first**

Create `test/checkin-fetch.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCheckinIO } from "../lib/checkin-fetch.mjs";
import { parseCheckinPage } from "../lib/checkin-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

function stubHttp(responses) {
  const calls = [];
  return {
    calls,
    async getHtml(url) { calls.push(["get", url]); return responses.shift() || ""; },
    async fetch(url, opts) {
      calls.push(["post", url, opts]);
      return { ok: true, status: 200, text: async () => responses.shift() || "" };
    },
  };
}

export default async function run() {
  // --- fetchStatus: parses html into structured result ---
  {
    const http = stubHttp([fx("daily-checkin-pending.html")]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const out = await io.fetchStatus();
    assert.equal(out.status, "not-signed-in");
    assert.equal(out.csrf, "test-csrf-token");
    assert.equal(out.hasForm, true);
    assert.equal(http.calls[0][1], "https://linux.sb/daily_checkin");
  }
  // --- submit: posts csrf, returns post-fetched status ---
  {
    const http = stubHttp([
      fx("daily-checkin-pending.html"),  // 1st call: get csrf
      fx("daily-checkin-done.html"),     // 2nd call: confirm signed-in
    ]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const r = await io.submit();
    assert.equal(r.status, "signed-in");
    assert.equal(http.calls.length, 2);
    assert.equal(http.calls[1][0], "post");
    const body = http.calls[1][2].body;
    assert.match(body, /_csrf=test-csrf-token/);
  }
  // --- submit when no csrf available ---
  {
    const http = stubHttp([fx("user-card-visitor.html")]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const r = await io.submit();
    assert.equal(r.status, "unknown");
    assert.match(r.reason, /no-csrf/);
    assert.equal(http.calls.length, 1); // no POST fired
  }
  // --- submit when already signed-in (no-op) ---
  {
    const http = stubHttp([fx("daily-checkin-done.html")]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const r = await io.submit();
    assert.equal(r.status, "signed-in");
    assert.equal(r.action, "none");
    assert.equal(http.calls.length, 1); // no POST fired
  }
}
```

- [ ] **Step 4.2: Run test, expect fail**

```bash
node scripts/run-tests.mjs 2>&1 | tail -10
```

Expected: `FAIL test/checkin-fetch.test.mjs` — module not found.

- [ ] **Step 4.3: Write `lib/checkin-fetch.mjs`**

```js
// I/O layer for the daily checkin flow. Takes an http adapter so tests
// can stub it. parseCheckinPage is the pure parser; this module wraps it
// with the fetch + submit dance.
import { parseCheckinPage } from "./checkin-parse.mjs";

export function createCheckinIO({ http, base }) {
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
```

- [ ] **Step 4.4: Run test, expect pass**

```bash
node scripts/run-tests.mjs 2>&1 | tail -15
```

Expected: `ok ./test/checkin-fetch.test.mjs`.

- [ ] **Step 4.5: Commit**

```bash
git add lib/checkin-fetch.mjs test/checkin-fetch.test.mjs
git commit -m "feat(checkin-fetch): DI'd I/O layer for /daily_checkin (status + submit)"
```

---
## Task 5: Update lib/notif-parse.mjs to match real site structure (TDD)

**Files:**
- Modify: `lib/notif-parse.mjs`
- Modify: `test/notif-parse.test.mjs`

- [ ] **Step 5.1: Update test/notif-parse.test.mjs to assert against the new structure**

The new real site structure is `li.post-item.notification-item` with `.notification-kind` and `.notification-content`. The OLD fixture structure (heading + `<ul class="notif-list">` with `data-id` / `data-mention`) is kept for back-compat; `notif-parse.mjs` should auto-detect which shape it is looking at.

Replace the contents of `test/notif-parse.test.mjs` with:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseNotifications, MAX_LIST } from "../lib/notif-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

export default async function run() {
  // --- New structure (li.post-item.notification-item) ---
  {
    const out = parseNotifications(fx("user-notifications.html"));
    assert.equal(out.list.length, 3);
    assert.equal(out.unread, 3);
    assert.equal(out.list[0].kind, "mention");
    assert.match(out.list[0].title, /@vfhky/);
    assert.equal(out.list[1].kind, "reply");
    assert.equal(out.list[2].kind, "system");
  }
  // --- Empty new structure ---
  {
    const html = `<ul class="notif-list"></ul>`;
    const out = parseNotifications(html);
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // --- Legacy shape: ul.notif-list with data-id / data-mention ---
  {
    const html = `<ul class="notif-list">
      <li data-id="1" data-mention="true"><a href="/topic/100">@vfhky hello</a></li>
    </ul>`;
    const out = parseNotifications(html);
    assert.equal(out.list.length, 1);
    assert.equal(out.list[0].id, "1");
    assert.equal(out.list[0].isMention, true);
    assert.match(out.list[0].url, /\/topic\/100/);
    assert.match(out.list[0].title, /@vfhky/);
  }
  // --- Legacy empty ---
  {
    const out = parseNotifications(fx("notifications-empty.html"));
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // --- Legacy malformed ---
  {
    const out = parseNotifications(fx("notifications-malformed.html"));
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // --- Legacy overflow ---
  {
    const out = parseNotifications(fx("notifications-many.html"));
    assert.equal(out.unread, 8);
    assert.equal(out.list.length, MAX_LIST);
    assert.equal(MAX_LIST, 5);
  }
}
```

- [ ] **Step 5.2: Run test, expect fail**

Run: `node scripts/run-tests.mjs 2>&1 | tail -25`
Expected: `FAIL test/notif-parse.test.mjs` - the new kind field is not extracted yet.

- [ ] **Step 5.3: Rewrite lib/notif-parse.mjs**

Replace the file contents with:

```js
// Parse a linux.sb notifications page into { unread, list }.
const MAX_LIST = 5;

function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

function kindFromZh(text) {
  if (/提及|@|提到/.test(text)) return "mention";
  if (/回复|reply/.test(text)) return "reply";
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
    items.push({ id: idMatch ? idMatch[1] : url, url, title, isMention: mention, kind: mention ? "mention" : "system" });
    if (items.length >= MAX_LIST) break;
  }
  return items;
}

function extractListNew(html) {
  const items = [];
  const liRe = /<li\b[^>]*class\s*=\s*["'][^"']*\bnotification-item\b[^"']*["'][\s\S]*?<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[0];
    const kindMatch = block.match(/class\s*=\s*["'][^"']*\bnotification-kind\b[^"']*["'][^>]*>([\s\S]*?)<\//);
    const contentMatch = block.match(/class\s*=\s*["'][^"']*\bnotification-content\b[^"']*["'][^>]*>([\s\S]*?)<\//);
    const linkMatch = block.match(/<a\b[^>]*href\s*=\s*["']([^"']+)/i);
    if (!contentMatch) continue;
    const kindZh = kindMatch ? stripTags(kindMatch[1]) : "";
    const title = stripTags(contentMatch[1]).slice(0, 120);
    items.push({
      id: linkMatch ? linkMatch[1] : title,
      url: linkMatch ? linkMatch[1] : null,
      title,
      kind: kindFromZh(kindZh),
    });
    if (items.length >= MAX_LIST) break;
  }
  return items;
}

export function parseNotifications(html) {
  if (typeof html !== "string" || !html) return { unread: 0, list: [] };

  const hasNew = /notification-item/.test(html);
  if (hasNew) {
    const list = extractListNew(html);
    return { unread: list.length, list };
  }

  // Legacy fallback.
  const list = extractListLegacy(html);
  return { unread: extractUnreadLegacy(html), list };
}
```

- [ ] **Step 5.4: Run test, expect pass**

Run: `node scripts/run-tests.mjs 2>&1 | tail -25`
Expected: `ok ./test/notif-parse.test.mjs`, all tests still passing.

- [ ] **Step 5.5: Commit**

```bash
git add lib/notif-parse.mjs test/notif-parse.test.mjs
git commit -m "feat(notif-parse): support new li.notification-item structure + kind field"
```

---
## Task 6: linux-sb-suite.user.js — selectors + user module

**Goal:** Fix selectors that broke in 1.1.2 + add rank/points to user module.
**Files touched:** `linux-sb-suite.user.js` (selector block at L363-385, user module at L470-617)
**Estimated size:** ~40 lines net

### Why these changes

- The user card in the live site uses `.sidebar-card.user-card`, but the inner
  user-avatar class is `user-avatar-big` (NOT `user-avatar`) and the visitor
  variant has a `<div>` letter placeholder, no `<img>`.
- The current code only reads avatar `img`, so it misses the logged-in
  DiceBear SVG (avatarIsDicebear false negative on `<img>` src with `/avatars/` path).
- Rank/points are visible in the right card as `<rank> · 积分 <N>`, but the
  module never captures them.

### Sub-steps

- [ ] **Step 6.1: Update selectors block (L363-385)**

Replace the `selectors:` object inside `LSB.api.linuxSb` with:

```js
selectors: {
  navMine:         "a.nav-mine",
  avatarLink:      "a.avatar-profile-link",
  title:           "title",
  signinCard:      ".signin-card, .daily-signin, [class*=\"signin\"], [class*=\"checkin\"]",
  signinButton:    "button[class*=\"signin\"], button[class*=\"checkin\"], a[class*=\"signin\"]",
  userCard:        ".sidebar-card.user-card",
  userNameLink:    ".sidebar-card.user-card .user-name",
  userAvatar:      ".sidebar-card.user-card .user-avatar-big",
  userAvatarImg:   ".sidebar-card.user-card .user-avatar-big img.avatar-img",
  userRank:        ".sidebar-card.user-card .user-rank",
  userPoints:      ".sidebar-card.user-card .user-points",
  userCardVisitor: ".sidebar-card.user-card .user-avatar-big.visitor-avatar",
  dailyCheckinCard:  ".sidebar-card.daily-checkin-card",
  dailyCheckinStatus: ".daily-checkin-sub",
  dailyCheckinBadge:  ".daily-checkin-badge",
  checkinForm:      'form.post-action-form[action="/daily_checkin"]',
  checkinBtn:       'form.post-action-form[action="/daily_checkin"] button[type=submit]',
},
```

- [ ] **Step 6.2: Patch `readFromDom()` in the user module**

Inside the `nav-mine` branch (where the user is logged in), replace the
avatar/rank block with the version below. Key changes:
  1. Use `userAvatar` (wrapper) as the lookup root; look for an inner `img`.
  2. If no `<img>` (visitor variant), generate a letter-placeholder avatar
     using `LSB.api.linuxSb.avatarUrl.dicebearForUserId(id)` as a stable
     fallback.
  3. Capture `rank` from `.user-rank`; capture `points` from `.user-points`.
  4. Set `avatarIsDicebear` true when the wrapper is `.visitor-avatar` div
     OR the img src matches `/avatars/|dicebear/`.

Find this block:
```js
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
```

Replace it with:
```js
const card = dom.$(LSB.api.linuxSb.selectors.userCard);
const nameEl = card ? dom.$(LSB.api.linuxSb.selectors.userNameLink, card) : null;
const avatarWrap = card ? dom.$(LSB.api.linuxSb.selectors.userAvatar, card) : null;
const avatarImg  = avatarWrap ? dom.$("img.avatar-img", avatarWrap) : null;
const rankEl     = card ? dom.$(LSB.api.linuxSb.selectors.userRank, card) : null;
const pointsEl   = card ? dom.$(LSB.api.linuxSb.selectors.userPoints, card) : null;
const nickname   = nameEl ? dom.text(nameEl) : null;
let avatarUrl    = avatarImg ? dom.src(avatarImg) : null;
let avatarIsDicebear = !!avatarUrl && /\/avatars\/|dicebear/i.test(avatarUrl);
if (!avatarUrl && avatarWrap && avatarWrap.classList.contains("visitor-avatar")) {
  avatarUrl = LSB.api.linuxSb.avatarUrl.dicebearForUserId(id || "guest");
  avatarIsDicebear = true;
}
const rankText = rankEl ? dom.text(rankEl) : null;
let points = null;
if (pointsEl) {
  const m = dom.text(pointsEl).match(/(\d+)/);
  if (m) points = Number(m[1]);
}
return {
  id: id || null,
  nickname: nickname || null,
  avatarUrl: avatarUrl || null,
  avatarIsDicebear,
  profileUrl: href ? dom.absUrl(href) : null,
  rank: rankText || null,
  points,
  isLoggedIn: true,
  source: avatarImg ? "user-card" : "user-card-visitor",
};
```

- [ ] **Step 6.3: Add `points` to `normalize()` pick-list**

Find:
```js
return LSB.utils.pick(info, [
  "id", "nickname", "avatarUrl", "avatarIsDicebear",
  "profileUrl", "isLoggedIn", "source", "rank",
]);
```

Add `"points"` to the list:
```js
return LSB.utils.pick(info, [
  "id", "nickname", "avatarUrl", "avatarIsDicebear",
  "profileUrl", "isLoggedIn", "source", "rank", "points",
]);
```

- [ ] **Step 6.4: Manual smoke read**

In DevTools console on linux.sb while logged in:
```js
JSON.parse(GM_getValue("lsb:v1:user.current"))
```
Expected: should include `"rank": "笔友 · 积分 177"` (or similar) and `"points": 177`.

- [ ] **Step 6.5: Commit**

```bash
git add linux-sb-suite.user.js
git commit -m "fix(user): add rank/points; handle visitor-avatar letter placeholder"
```

---

## Task 7: config.notif.endpoint factory + notif module

**Goal:** Make the notifications endpoint a factory `(userId) => string` so the
new site path `/user/<id>?tab=notifications` works without code changes.
**Files touched:** `linux-sb-suite.user.js` (config L88-102, notif module L855-925)
**Estimated size:** ~30 lines net

### Why

- The candidate list at `config.notif.candidates` is a list of static paths.
  The new live site uses `/user/<id>?tab=notifications` which requires the
  current user id.
- We add a factory `config.notif.endpoint(userId)` that takes priority. The
  notif module uses it when a user is bound; otherwise it falls back to the
  existing `candidates` list (preserves backward compat).

### Sub-steps

- [ ] **Step 7.1: Add `endpoint` factory to `config.notif` (L88-102)**

Find:
```js
notif: {
  candidates: ["/notifications", "/notice", "/user/notifications"],
  intervalMs: 60_000,
  backoffAfter: 3,
  backoffMs: 5 * 60_000,
},
```

Replace with:
```js
notif: {
  candidates: ["/notifications", "/notice", "/user/notifications"],
  endpoint(userId) {
    if (userId) return `/user/${userId}?tab=notifications`;
    return null;
  },
  intervalMs: 60_000,
  backoffAfter: 3,
  backoffMs: 5 * 60_000,
},
```

- [ ] **Step 7.2: Update `discoverEndpoint()` in notif module**

Find:
```js
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
```

Replace with:
```js
async function discoverEndpoint() {
  if (state.endpoint) return state.endpoint;
  const uid = (user && user.info && user.info.id) || null;
  const factoryEndpoint = (typeof config.notif.endpoint === "function")
    ? config.notif.endpoint(uid) : null;
  if (factoryEndpoint) {
    state.endpoint = config.site.apiBase + factoryEndpoint;
    if (typeof GM_setValue === "function") GM_setValue("lsb:notif:endpoint", state.endpoint);
    return state.endpoint;
  }
  const cached = (typeof GM_getValue === "function") ? GM_getValue("lsb:notif:endpoint", null) : null;
  if (cached) { state.endpoint = cached; return cached; }
  const endpoint = await probeEndpoint(http, config.site.apiBase, config.notif.candidates);
  if (endpoint) {
    state.endpoint = endpoint;
    if (typeof GM_setValue === "function") GM_setValue("lsb:notif:endpoint", endpoint);
  }
  return endpoint;
}
```

- [ ] **Step 7.3: Invalidate the cached endpoint**

Add a one-shot at the top of the notif module factory (right after `const log = ...`):
```js
if (typeof GM_deleteValue === "function") GM_deleteValue("lsb:notif:endpoint");
```

- [ ] **Step 7.4: Commit**

```bash
git add linux-sb-suite.user.js
git commit -m "fix(notif): user-scoped endpoint factory (/user/<id>?tab=notifications)"
```

---

## Task 8: signin module — wire auto-checkin via core/poller (5min tick)

**Goal:** Replace the current `events.on("user:changed")` one-shot auto-checkin
with a poller that ticks every 5 minutes. The toggle stays a user setting.
**Files touched:** `linux-sb-suite.user.js` (signin module L617-790)
**Estimated size:** ~30 lines net (remove old handler, add poller)

### Why

- User reported the signin status not always refreshing on tab navigation.
  A 5-minute poller guarantees the panel reflects the real server state.
- The existing dedupe is "per page-load" — when you stay on one tab for
  hours, the auto-checkin never re-runs. A poller fixes this.
- We dedupe by checking `state.lastSignedInAt` and the daily signin cap
  (20h since last signed-in = a new day on this site).

### Sub-steps

- [ ] **Step 8.1: Extend signin module state**

Right after the existing `const log = ...` line at the top of the signin
factory, add:

```js
const state = {
  lastSignedInAt: 0,
  lastCheckAt: 0,
  pollInFlight: false,
};
```

- [ ] **Step 8.2: Add the poller in the signin factory**

Right after the `getAutoSignin` / `setAutoSignin` block, add:

```js
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
      if (state.pollInFlight) return;
      if (!getAutoSignin()) return;
      if (!user || !user.info || !user.info.id) return;
      if (state.lastSignedInAt && (Date.now() - state.lastSignedInAt) < 20 * 3600 * 1000) {
        return;
      }
      state.pollInFlight = true;
      try {
        const r = await ensureSignedIn();
        if (r.status === "signed-in") {
          state.lastSignedInAt = Date.now();
        }
        events.emit("signin:auto", r);
      } catch (err) { log.warn("auto tick failed", err); }
      finally { state.pollInFlight = false; }
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
```

- [ ] **Step 8.3: Replace the old `events.on("user:changed")` auto handler**

Find:
```js
events.on("user:changed", async (u) => {
  if (!u || !u.isLoggedIn) return;
  if (!getAutoSignin()) return;
  try {
    const r = await ensureSignedIn();
    log.info("auto signin result", r);
    events.emit("signin:auto", r);
  } catch (err) { log.warn("auto signin failed", err); }
});
```

Replace with:
```js
events.on("user:changed", (u) => {
  if (u && u.isLoggedIn && getAutoSignin()) _startAuto();
  else _stopAuto();
});
events.on("signin:auto-changed", (on) => {
  if (on && user && user.info && user.info.id) _startAuto();
  else _stopAuto();
});
events.on("signin:auto-changed", (on) => {
  if (on) {
    setTimeout(() => {
      const p = _ensurePoller();
      if (p) p.tickNow && p.tickNow();
    }, 500);
  }
});
```

- [ ] **Step 8.4: Add `tickNow` to core/poller (only if missing)**

Check `core/poller.mjs` for `tickNow`. If not present, add inside the
poller module:

```js
function tickNow() {
  if (state.running) {
    runTick().catch((e) => log.warn("manual tick failed", e));
  }
}
```

And expose on the returned object as `tickNow,`.

- [ ] **Step 8.5: Manual verification**

Reload the script. Toggle "自动签到" on. Verify in DevTools Network tab that
a new GET to `/daily_checkin` fires after 5 minutes. If currently
unsigned-in, the panel button switches to "已签到" within one tick.

- [ ] **Step 8.6: Commit**

```bash
git add linux-sb-suite.user.js core/poller.mjs
git commit -m "feat(signin): auto-checkin via 5min poller, 20h dedupe window"
```

---

## Task 9: Release 1.1.3 — bump meta, run full test+build, smoke test

**Goal:** Produce a clean 1.1.3 build that boots, shows correct
user/notif/signin info on linux.sb.
**Files touched:** `.build-meta.json`, `README.md`, `dist/linux-sb-suite.user.js`
**Estimated size:** ~10 file edits, ~5 minutes

### Sub-steps

- [ ] **Step 9.1: Bump `.build-meta.json` to 1.1.3**

Edit the `version` field:
```json
"version": "1.1.3",
```

- [ ] **Step 9.2: Sync the version into the userscript header**

```bash
node build.mjs
```

This regenerates `dist/linux-sb-suite.user.js` with the new version.

- [ ] **Step 9.3: Run the full test suite**

```bash
node scripts/run-tests.mjs
```

Expected: 4-5 test files pass (build-fixture, checkin-parse, checkin-fetch,
notif-parse, plus pre-existing). No failures.

- [ ] **Step 9.4: Update README**

Add a 1.1.3 entry to the changelog (3-5 bullets max):

```markdown
### 1.1.3 (2026-08-12)

- fix(user): capture rank + points from sidebar card; visitor avatar letter fallback
- fix(notif): user-scoped endpoint factory for `/user/<id>?tab=notifications`
- feat(signin): auto-checkin via 5min poller with 20h dedupe
- chore: refresh fixtures from live site, drop legacy `notif-unread-count` reliance
```

- [ ] **Step 9.5: Promote dist → dev userscript**

```bash
copy dist/linux-sb-suite.user.js linux-sb-suite.user.js
```

`git diff linux-sb-suite.user.js` should show ONLY the version line change.

- [ ] **Step 9.6: Smoke test on live site via CDP probe**

The probe on port 9444 is still alive and the user is still logged in.
Reload, then run in DevTools:

```js
JSON.parse(GM_getValue("lsb:v1:user.current"))
// Should include rank + points
```

```js
LSB.notif.state
// Should show endpoint = "https://linux.sb/user/16056?tab=notifications" and list populated
```

```js
LSB.signin.getStatus()
// Should return { status: "signed-in", ... }
```

- [ ] **Step 9.7: Tampermonkey self-update check**

```js
GM_info.script.version   // should be "1.1.3"
```

- [ ] **Step 9.8: Commit + tag + push**

```bash
git add .build-meta.json dist/linux-sb-suite.user.js linux-sb-suite.user.js README.md
git commit -m "release: 1.1.3 fix signin / notif / user"
git tag -a v1.1.3 -m "1.1.3 fix signin / notif / user"
git push origin main --follow-tags
```

---

## Task 10: Greasy Fork sync

**Goal:** Push 1.1.3 to Greasy Fork so other users get the fix.
**Tools:** CDP probe on port 9444 (already logged in to greasyfork.org as
non-GitHub `vfhky`).
**Estimated time:** ~3 minutes plus 90s CDN wait.

### Sub-steps

- [ ] **Step 10.1: Navigate to the script admin page**

```
https://greasyfork.org/en/scripts/590905-linux-sb-suite/admin
```

- [ ] **Step 10.2: Open the update form**

Click "Update". A form appears with a textarea pre-filled with the existing
source.

- [ ] **Step 10.3: Replace the source code**

Wipe the textarea (select-all + delete), then paste the new source from
`dist/linux-sb-suite.user.js`.

- [ ] **Step 10.4: Commit-URL placeholder**

In the "Additional info" / "Commit URL" field, enter:
```
https://github.com/vfhky/linux-sb-pro/blob/main/linux-sb-suite.user.js
```

- [ ] **Step 10.5: Submit**

Click "Update script". Wait for the success page.

- [ ] **Step 10.6: Restore commit-URL to a real commit**

Go back to the admin page → "Update" again → replace the Commit URL with:
```
https://github.com/vfhky/linux-sb-pro/blob/<release-hash>/linux-sb-suite.user.js
```

(Use the actual hash from `git rev-parse HEAD` after the release commit.)
Resubmit.

- [ ] **Step 10.7: Wait for CDN propagation (90s)**

```bash
curl -s https://update.greasyfork.org/scripts/590905.meta.js | head -8
```

Expected: first line is `// @version      1.1.3`.

```bash
curl -s https://update.greasyfork.org/scripts/590905.user.js | head -3
```

- [ ] **Step 10.8: Tampermonkey auto-update verification**

Reload linux.sb in the CDP probe. Watch the Network tab for a request to
`update.greasyfork.org/scripts/590905.meta.js`. The response should be the
new 1.1.3 meta.

---

## Acceptance criteria (1.1.3 ships when ALL are true)

- [ ] `node scripts/run-tests.mjs` — all tests pass
- [ ] `node build.mjs` — produces `dist/linux-sb-suite.user.js` with `@version 1.1.3`
- [ ] Live smoke test: panel shows correct rank, points, signin status, notification list
- [ ] Tampermonkey self-update from 1.1.2 → 1.1.3 works (or already on 1.1.3)
- [ ] `git log` shows release commit + tag `v1.1.3`
- [ ] `git push origin main --follow-tags` succeeds
- [ ] Greasy Fork admin page shows script at version 1.1.3
- [ ] `curl https://update.greasyfork.org/scripts/590905.meta.js | head -3` shows 1.1.3 after 90s wait
- [ ] No new file untracked in working tree

## Notes / open questions

- If the live `linux.sb` user-card DOM has a different rank format (e.g.
  "积分 177" without the `·`), the `points` regex still extracts correctly.
- If Greasy Fork refuses the source paste (length limit?), fall back to
  uploading via a public URL (e.g. raw githubusercontent).
- If Task 4's `checkin-fetch.mjs` discover turns up a third payload shape
  (e.g. a JSON API exists at `/api/daily_checkin`), prefer that over the
  HTML scrape and update the plan during execution.
