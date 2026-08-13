# Auto Sign-in Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toast notification system (`lib/toast.mjs`) and wire signin module to check-in on page load, with toast feedback on every successful sign-in.

**Architecture:** New `lib/toast.mjs` exports `createToastManager()` — a pure factory with zero dependencies, inlined at build time. Main script initializes `LSB.toast` as infrastructure (peer to `LSB.storage`). Toast CSS uses panel CSS variables (`--lsb-bg` etc.) set on `document.documentElement` by `applyPanelStyle()`. Signin module calls `ensureSignedIn()` immediately on init, emits toast on success. Manual signin button in ui module also calls toast.

**Tech Stack:** Vanilla JS (ES5/ES6), GM_* APIs, Node.js test runner, build.mjs inliner

## Global Constraints

- Zero external dependencies (no layui, no CDN resources)
- `lib/toast.mjs` must be pure factory, testable without DOM
- `LSB.toast` is infrastructure, NOT a registered module
- Signin flow must not break if `LSB.toast` is absent
- `durationMs` clamped to 1000-30000ms range
- `destroy()` must be idempotent
- Local Chrome verification before Greasy Fork update
- Follow existing code patterns: `GM_addStyle` for CSS, `LSB.*` namespace, IIFE structure

---
```

### Task 1: Create `lib/toast.mjs`

**Files:**
- Create: `lib/toast.mjs`

**Interfaces:**
- Produces: `export function createToastManager(opts)` → `{ show, dismiss, destroy }`
  - `show(message: string, { type?: 'success'|'error'|'info', durationMs?: number }): HTMLElement`
  - `dismiss(el: HTMLElement): void`
  - `destroy(): void`

- [ ] **Step 1: Write the toast module**

```javascript
// lib/toast.mjs
// Pure factory function for toast notifications. Zero external dependencies.
// Inlined into the public build by build.mjs.

const ICONS = { success: '✓', error: '✗', info: 'ℹ' };

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createToastManager(opts) {
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
```

- [ ] **Step 2: Verify file is syntactically valid**

```bash
node --check lib/toast.mjs
```
Expected: no output (exit 0)

- [ ] **Step 3: Commit**

```bash
git add lib/toast.mjs
git commit -m "feat(toast): add createToastManager factory (lib/toast.mjs)"
```

---

### Task 2: Create `test/toast.test.mjs` (TDD red)

**Files:**
- Create: `test/toast.test.mjs`

**Interfaces:**
- Consumes: `createToastManager` from `lib/toast.mjs`

- [ ] **Step 1: Write all 9 test cases**

```javascript
// test/toast.test.mjs
import assert from 'node:assert/strict';
import { createToastManager } from '../lib/toast.mjs';

// Minimal DOM stub for Node.js test environment
function createDOM() {
  // JSDOM-like minimal stub
  const doc = {
    _children: [],
    _idMap: {},
    documentElement: {
      appendChild(el) { doc._children.push(el); return el; },
      removeChild(el) {
        const i = doc._children.indexOf(el);
        if (i >= 0) doc._children.splice(i, 1);
        return el;
      },
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        dataset: {},
        _attrs: {},
        _children: [],
        _events: {},
        _parent: null,
        _removed: false,
        style: {},
        classList: {
          _items: [],
          add(cls) { if (!this._items.includes(cls)) this._items.push(cls); },
          remove(cls) { this._items = this._items.filter(function(c) { return c !== cls; }); },
          contains(cls) { return this._items.includes(cls); },
        },
        setAttribute(name, value) { this._attrs[name] = value; },
        getAttribute(name) { return this._attrs[name] || null; },
        appendChild(child) { child._parent = el; this._children.push(child); return child; },
        removeChild(child) {
          const i = this._children.indexOf(child);
          if (i >= 0) this._children.splice(i, 1);
          child._removed = true;
          return child;
        },
        addEventListener(evt, fn) {
          if (!this._events[evt]) this._events[evt] = [];
          this._events[evt].push(fn);
        },
        _fire(evt) {
          (this._events[evt] || []).forEach(function(fn) { fn.call(el); });
        },
        get parentNode() { return this._parent; },
      };
      if (tag === 'div') {
        el.id = '';
        el.innerHTML = '';
        Object.defineProperty(el, 'innerHTML', {
          get() { return this._innerHTML || ''; },
          set(v) { this._innerHTML = v; },
        });
      }
      return el;
    },
    getElementById(id) { return null; },
    querySelector(sel) { return null; },
  };
  return doc;
}

export default async function run() {
  // --- Test 1: show() creates a DOM element ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-toast', durationMs: 100 });
    const el = t.show('hello', { type: 'success' });
    assert.ok(el, 'show() should return an element');
    assert.equal(el.tagName, 'DIV', 'should be a div');
    assert.equal(el.dataset.type, 'success', 'data-type should be success');
    assert.ok(el._innerHTML.indexOf('hello') >= 0, 'innerHTML should contain message');
    t.destroy();
  }

  // --- Test 2: show("", ...) silently ignores empty message ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-empty' });
    const el = t.show('', { type: 'info' });
    assert.equal(el, undefined, 'empty message should return undefined');
    t.destroy();
  }

  // --- Test 3: show(null, ...) silently ignores ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-null' });
    const el = t.show(null, { type: 'info' });
    assert.equal(el, undefined, 'null message should return undefined');
    t.destroy();
  }

  // --- Test 4: type mapping → data-type attribute ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-types', durationMs: 100 });
    const success = t.show('ok', { type: 'success' });
    assert.equal(success.dataset.type, 'success');
    const error = t.show('fail', { type: 'error' });
    assert.equal(error.dataset.type, 'error');
    const info = t.show('info', { type: 'info' });
    assert.equal(info.dataset.type, 'info');
    t.destroy();
  }

  // --- Test 5: queue maxVisible=3, 4th evicts 1st ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-queue', maxVisible: 3, durationMs: 99999 });
    const a = t.show('a', { type: 'info' });
    const b = t.show('b', { type: 'info' });
    const c = t.show('c', { type: 'info' });
    const d = t.show('d', { type: 'info' });
    // a should have been evicted (removed from DOM)
    assert.ok(a._removed, '4th toast should evict the 1st');
    assert.ok(!b._removed, '2nd toast should still be present');
    assert.ok(!c._removed, '3rd toast should still be present');
    assert.ok(!d._removed, '4th toast should be present');
    t.destroy();
  }

  // --- Test 6: auto dismiss after durationMs ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-dismiss', durationMs: 10 });
    const el = t.show('auto-dismiss', { type: 'success' });
    assert.ok(!el._removed, 'should be visible before timeout');
    // Wait for the timer to fire
    await new Promise(function(r) { setTimeout(r, 50); });
    assert.ok(el._lsbToastDismissed, 'should be marked dismissed');
    assert.ok(el.classList.contains('lsb-toast-out'), 'should have out class');
    t.destroy();
  }

  // --- Test 7: manual dismiss on click ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-click', durationMs: 99999 });
    const el = t.show('click me', { type: 'info' });
    el._fire('click');
    assert.ok(el._lsbToastDismissed, 'click should mark dismissed');
    await new Promise(function(r) { setTimeout(r, 250); });
    assert.ok(el._removed, 'element should be removed after animation');
    t.destroy();
  }

  // --- Test 8: destroy() cleans up all toasts and container ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-destroy', durationMs: 99999 });
    t.show('one', { type: 'info' });
    t.show('two', { type: 'success' });
    t.destroy();
    // After destroy, all toast elements should be removed
    // and the container should be null
    // Verify by calling destroy again (idempotent)
    t.destroy(); // should not throw
  }

  // --- Test 9: idempotent destroy() ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-idempotent' });
    t.destroy();
    t.destroy();
    t.destroy();
    // Should not throw
  }

  // --- Test 10: durationMs clamping ---
  {
    const doc = createDOM();
    const tShort = createToastManager({ containerId: 'test-clamp-short', durationMs: 0 });
    const tLong = createToastManager({ containerId: 'test-clamp-long', durationMs: 99999 });
    // Clamping happens internally; just verify creation doesn't throw
    const el1 = tShort.show('clamped short', { type: 'info' });
    const el2 = tLong.show('clamped long', { type: 'info' });
    assert.ok(el1, 'short duration should not prevent show');
    assert.ok(el2, 'long duration should not prevent show');
    tShort.destroy();
    tLong.destroy();
  }
}
```

- [ ] **Step 2: Run the new test to verify it fails (red)**

```bash
node scripts/run-tests.mjs
```
Expected: `FAIL ./test/toast.test.mjs` (module not yet inlined, or test file won't be found if run-tests.mjs doesn't look in lib/)

Wait — `run-tests.mjs` only scans `test/`, `lib/`, and `core/` directories for `.test.mjs` files. It will find `test/toast.test.mjs` and try to import it. The test should run since `lib/toast.mjs` already exists from Task 1.

- [ ] **Step 3: Run tests and verify they pass (green)**

```bash
node scripts/run-tests.mjs
```
Expected: `ok  ./test/toast.test.mjs` among the output, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/toast.test.mjs
git commit -m "test(toast): add 10 unit tests for createToastManager"
```

---

### Task 3: Integrate toast into main script

**Files:**
- Modify: `linux-sb-suite.user.js`

**Interfaces:**
- Consumes: `createToastManager` from inlined `lib/toast.mjs`
- Produces: `LSB.toast` global, toast CSS injected via `GM_addStyle`

- [ ] **Step 1: Add LSB.toast initialization after the core/i18n/settings block**

Find the section after `LSB.sections` initialization (around line 333) and before `LSB.api.linuxSb`. Add:

```javascript
  // =====================================================================
  // Toast notification manager (infrastructure, not a module)
  // =====================================================================
  LSB.toast = (typeof createToastManager === 'function')
    ? createToastManager({ maxVisible: 3, gap: 8, durationMs: 3000, containerId: 'lsb-toast-container' })
    : { show: function() {}, dismiss: function() {}, destroy: function() {} };
```

- [ ] **Step 2: Add toast CSS via GM_addStyle**

Find the existing `GM_addStyle(...)` block inside the ui module (around line 998). Add the toast CSS immediately after the existing panel CSS injection, before the panel HTML construction:

```javascript
    // Toast CSS (injected once, follows panel theme via CSS variables)
    GM_addStyle('\x23lsb-toast-container{position:fixed;bottom:12px;right:12px;z-index:2147483647;display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none}' +
      '.lsb-toast{pointer-events:auto;max-width:300px;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:var(--lsb-fg,#eee);background:var(--lsb-bg,rgba(20,22,28,0.94));border:1px solid var(--lsb-border,rgba(255,255,255,0.08));box-shadow:var(--lsb-shadow,0 8px 24px rgba(0,0,0,0.35));backdrop-filter:blur(8px);display:flex;align-items:center;gap:8px;animation:lsb-toast-in .25s ease-out;transition:opacity .2s,transform .2s}' +
      '.lsb-toast.lsb-toast-out{opacity:0;transform:translateX(20px)}' +
      '@keyframes lsb-toast-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}' +
      '.lsb-toast[data-type=success]{border-left:3px solid \x234ade80}' +
      '.lsb-toast[data-type=error]{border-left:3px solid \x23f87171}' +
      '.lsb-toast[data-type=info]{border-left:3px solid \x2360a5fa}' +
      '.lsb-toast-icon{flex:none;font-size:14px}' +
      '.lsb-toast-msg{flex:1;min-width:0}');
```

Note: `\x23` is `#` — used to avoid potential parsing issues in the userscript.

- [ ] **Step 3: Extend applyPanelStyle() to set CSS variables on document.documentElement**

Find `applyPanelStyle()` (around line 1175). After the existing `root.style.setProperty(...)` lines, add:

```javascript
      // Also set on documentElement so toast (outside #lsb-panel) inherits theme.
      if (typeof getPalette === "function" && effective !== "auto") {
        try {
          var p = getPalette(effective);
          document.documentElement.style.setProperty("--lsb-bg", p.bg);
          document.documentElement.style.setProperty("--lsb-fg", p.fg);
          document.documentElement.style.setProperty("--lsb-border", p.border);
          document.documentElement.style.setProperty("--lsb-shadow", p.shadow);
        } catch (e) { /* unknown theme */ }
      }
```

Wait — this duplicates the existing getPalette call. Instead, refactor to extract the palette once and apply to both targets:

```javascript
    function applyPanelStyle(payload) {
      var pos = (payload && payload.pos) || (LSB.panelStyle ? LSB.panelStyle.pos : "BR");
      var theme = (payload && payload.theme) || (LSB.panelStyle ? LSB.panelStyle.theme : "auto");
      root.dataset.pos = pos;
      root.dataset.theme = theme;
      var effective = (theme === "auto")
        ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      if (typeof getPalette === "function" && effective !== "auto") {
        try {
          var p = getPalette(effective);
          root.style.setProperty("--lsb-bg", p.bg);
          root.style.setProperty("--lsb-fg", p.fg);
          root.style.setProperty("--lsb-border", p.border);
          root.style.setProperty("--lsb-shadow", p.shadow);
          // Also set on documentElement so toast (outside #lsb-panel) inherits theme.
          document.documentElement.style.setProperty("--lsb-bg", p.bg);
          document.documentElement.style.setProperty("--lsb-fg", p.fg);
          document.documentElement.style.setProperty("--lsb-border", p.border);
          document.documentElement.style.setProperty("--lsb-shadow", p.shadow);
        } catch (e) { /* unknown theme */ }
      }
    }
```

- [ ] **Step 4: Commit**

```bash
git add linux-sb-suite.user.js
git commit -m "feat(toast): integrate LSB.toast, CSS, and theme variables into main script"
```

---

### Task 4: Modify signin module — immediate check + stats pass-through

**Files:**
- Modify: `linux-sb-suite.user.js`

**Interfaces:**
- Consumes: `LSB.toast` (optional, fallback safe)
- Modifies: `performSignin()` return value (adds `stats`), signin module init (adds immediate check)

- [ ] **Step 1: Add stats to performSignin() return values**

Find `performSignin()` (around line 712). Two paths need `stats` added:

Path 1 — already on checkin page (around line 714-723):
```javascript
// OLD:
if (/已签到/.test(t)) {
  return { ok: true, status: "signed-in", source: "already-on-page" };
}
btn.click();
return { ok: true, status: "submitted", source: "clicked" };

// NEW:
var fetched = await _fetchStatus();
if (/已签到/.test(t)) {
  return { ok: true, status: "signed-in", source: "already-on-page", stats: fetched.stats };
}
btn.click();
return { ok: true, status: "submitted", source: "clicked", stats: fetched.stats };
```

Path 2 — HTTP POST (around line 726-748):
```javascript
// OLD:
return {
  ok: res.ok || after.status === "signed-in",
  status: after.status,
  source: "http-post",
  httpStatus: res.status,
};

// NEW:
return {
  ok: res.ok || after.status === "signed-in",
  status: after.status,
  source: "http-post",
  httpStatus: res.status,
  stats: after.stats,
};
```

- [ ] **Step 2: Add immediate signin check at signin module init**

After the `// Restore dedupe window across page loads.` block (around line 800-804), add a helper and an immediate check:

```javascript
    // Toast helper — safe even if LSB.toast is not yet initialized.
    function _showSigninToast(result) {
      if (!LSB.toast || typeof LSB.toast.show !== "function") return;
      if (result.ok && result.status === "signed-in") {
        var points = (result.stats && result.stats.total) ? " +" + result.stats.total + " 积分" : "";
        LSB.toast.show("签到成功 ✓" + points, { type: "success" });
      } else if (!result.ok && result.reason) {
        if (result.reason !== "not-logged-in" && result.reason !== "unknown") {
          LSB.toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
        }
      }
    }

    // Immediate check on page load (when auto-signin is enabled).
    events.on("user:changed", function (u) {
      if (u && u.isLoggedIn && getAutoSignin()) {
        _startAuto();
        // Also run an immediate check (poller will handle subsequent ticks).
        ensureSignedIn().then(function (r) {
          if (r && r.ok) _showSigninToast(r);
        }).catch(function () {});
      } else {
        _stopAuto();
      }
    });
```

Wait — this would replace the existing `events.on("user:changed", ...)` handler. Let me instead modify the existing handler to add the immediate check:

The existing handler (around line 785):
```javascript
events.on("user:changed", (u) => {
  if (u && u.isLoggedIn && getAutoSignin()) _startAuto();
  else _stopAuto();
});
```

Change to:
```javascript
events.on("user:changed", function (u) {
  if (u && u.isLoggedIn && getAutoSignin()) {
    _startAuto();
    // Immediate check on page load (poller also does periodic ticks).
    ensureSignedIn().then(function (r) {
      if (r && r.ok) _showSigninToast(r);
    }).catch(function (e) { log.warn("init checkin failed", e); });
  } else {
    _stopAuto();
  }
});
```

Also add the same toast call in the `signin:auto` event handler (around line 799):
```javascript
events.on("signin:auto", function (r) {
  _persistLastSignedIn();
  _showSigninToast(r);
});
```

And add the `_showSigninToast` helper function definition before the return statement.

- [ ] **Step 3: Commit**

```bash
git add linux-sb-suite.user.js
git commit -m "feat(signin): immediate checkin on page load + toast on success"
```

---

### Task 5: Modify ui module — manual signin toast

**Files:**
- Modify: `linux-sb-suite.user.js`

**Interfaces:**
- Consumes: `LSB.toast.show()`

- [ ] **Step 1: Add toast call to manual signin button handler**

Find the signin button click handler (around line 1305). After the existing `if (r.ok) setTimeout(...)` line, add a toast call:

```javascript
    signinBtn.addEventListener("click", async () => {
      signinBtn.disabled = true;
      const orig = signinBtn.textContent;
      signinBtn.textContent = "签到中…"; // 签到中…
      try {
        const r = await signin.performSignin();
        signinBtn.textContent = r.ok ? LSB.i18n.t("signin.status.signed") : "签到失败"; // 签到失败
        if (r.ok) {
          setTimeout(() => refresh().catch(() => {}), 600);
          // Toast on manual signin success
          if (LSB.toast && typeof LSB.toast.show === "function") {
            var points = (r.stats && r.stats.total) ? " +" + r.stats.total + " 积分" : "";
            LSB.toast.show("签到成功 ✓" + points, { type: "success" });
          }
        }
      } catch (err) {
        signinBtn.textContent = "签到失败"; // 签到失败
        log_signin.warn(err);
        if (LSB.toast && typeof LSB.toast.show === "function") {
          LSB.toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
        }
      } finally {
        signinBtn.disabled = false;
        setTimeout(() => { signinBtn.textContent = orig; }, 1500);
      }
    });
```

- [ ] **Step 2: Commit**

```bash
git add linux-sb-suite.user.js
git commit -m "feat(ui): add toast on manual signin button click"
```

---

### Task 6: Build and run all tests

**Files:**
- Modify: `dist/linux-sb-suite.user.js` (generated)

- [ ] **Step 1: Run all existing tests**

```bash
npm test
```
Expected: All 10+ test files pass (including new toast.test.mjs).

- [ ] **Step 2: Build the public dist**

```bash
node build.mjs
```
Expected: `Wrote dist/linux-sb-suite.user.js (N bytes, version=1.1.4)`

- [ ] **Step 3: Verify inlined toast code in dist**

```bash
grep -c "createToastManager" dist/linux-sb-suite.user.js
```
Expected: at least 1 (the function is inlined)

- [ ] **Step 4: Commit**

```bash
git add dist/linux-sb-suite.user.js
git commit -m "build: regenerate dist with toast module inlined"
```

---

### Task 7: Local Chrome verification

**Files:**
- No source changes — verification only

- [ ] **Step 1: Start local dev server**

```bash
node serve.mjs &
```
Expected: `serve.mjs listening on http://127.0.0.1:8123/`

- [ ] **Step 2: Start Chrome with debug port**

```powershell
powershell -ExecutionPolicy Bypass -File start-chrome.ps1
```

- [ ] **Step 3: Push dev script to Tampermonkey**

```bash
node chrome-cdp.mjs tm-update
```

- [ ] **Step 4: Manual verification checklist**

Navigate to `https://linux.sb/` and verify:

- [ ] Open dev console → `LSB.toast` exists and is an object with `show`, `dismiss`, `destroy`
- [ ] Enable auto sign-in in the panel settings
- [ ] Refresh the page → toast appears in bottom-right: "签到成功 ✓ +N 积分"
- [ ] Toast auto-dismisses after ~3 seconds
- [ ] Click the "签到" button in the panel → toast appears
- [ ] Switch theme to dark → toast follows dark theme
- [ ] Open 3+ tabs rapidly → toast stacks correctly (max 3 visible)
- [ ] Click on a toast → it dismisses immediately
- [ ] Disable auto sign-in → no toast on page load

- [ ] **Step 5: If any issues found, fix and re-verify**

Loop back to the relevant task, fix, rebuild, re-test in Chrome.

---

### Task 8: Update Greasy Fork

**Files:**
- Modify: `.build-meta.json` (bump version if needed)
- Modify: `dist/linux-sb-suite.user.js` (regenerated)

- [ ] **Step 1: Bump version in .build-meta.json**

Only if this is a release (not just a dev build). Change `"version": "1.1.4"` to `"version": "1.1.5"`.

- [ ] **Step 2: Rebuild with new version**

```bash
node build.mjs
```

- [ ] **Step 3: Final commit**

```bash
git add .build-meta.json dist/linux-sb-suite.user.js linux-sb-suite.user.js
git commit -m "release: 1.1.5 toast notification + immediate signin check"
```

- [ ] **Step 4: Push to GitHub**

```bash
git push
```

- [ ] **Step 5: Update Greasy Fork**

Go to https://greasyfork.org/en/scripts/590905-linux-sb-suite → "Source Code" → trigger sync, OR manually upload the new `dist/linux-sb-suite.user.js`.

Greasy Fork's auto-sync from GitHub raw URL should pick up the new version on the next sync tick.

---

### Task 9 (optional): Clean up local server

- [ ] **Step 1: Stop the local dev server**

```bash
kill $(lsof -t -i:8123) 2>/dev/null || true
```