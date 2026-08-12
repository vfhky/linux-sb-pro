# Spec: 通知红点 + 面板定位 / 主题色

**Date:** 2026-08-12
**Status:** Draft (pending user review)
**Repo:** `E:\gitHub\linux-sb-pro`
**Scope:** Direction A, first half (A2 in the brainstorm). Direction A's second half (主题跳转 + 夜间模式) ships in a separate spec.

## 1. Goal

Make the linux.sb Suite a useful day-to-day companion instead of a one-action sign-in tool, by:

1. Surfacing unread notifications on the floating panel so the user does not have to navigate to the site header.
2. Letting the user pick where the panel sits and which color theme it uses, persisted across reloads.

Both goals are scoped to **read-only behaviour** (no write-backs to linux.sb that could be interpreted as automated user actions). They only touch the panel and add one new endpoint probe.

## 2. Non-Goals

- No "mark as read" button (avoids Greasy Fork policy + CSRF / anti-bot surface).
- No desktop notifications, no sound, no badge on the browser favicon.
- No settings registry, no per-module toggles UI — that is the P3 platform work for a future spec.
- No code-block / image / quick-reply enhancements. Those are Direction B.
- No topic-page shortcuts, no night-mode toggle. Those are Spec 2.

## 3. Architecture

### 3.1 New modules

#### `LSB.notif` (module id: `notif`)

- **Dependencies:** `config, http, dom, events, user`.
- **Public surface:**
  - `state.unread: number` — last seen unread count.
  - `state.list: Array<{ id, title, url, ageText, isMention }>` — up to 5 most recent entries.
  - `state.endpoint: string | null` — discovered URL, cached in `GM_setValue('lsb:notif:endpoint', ...)`.
  - `state.lastFetchAt: number` — ms epoch.
  - `state.lastError: string | null`.
  - `start(): void` — kicks off the polling loop; idempotent.
  - `stop(): void` — clears the interval and resets state; idempotent.
  - `refresh(): Promise<void>` — manual one-shot fetch; resolves even on error.
- **Bootstrap:** registers `notif:updated` event; `start()` is invoked from inside the factory once `user` has emitted `user:changed` and `isGuest` is false.

#### `LSB.panelStyle` (module id: `panelStyle`)

- **Dependencies:** `config, events, storage`.
- **Public surface:**
  - `state.pos: "TL" | "TR" | "BL" | "BR"` (default `BR`).
  - `state.theme: "light" | "dark" | "auto"` (default `auto`).
  - `set({pos?, theme?}?): void` — applies + persists + emits `panel:reapply`.
  - `GM_setValue('lsb:panel:pos', pos)`, `GM_setValue('lsb:panel:theme', theme)`.
- **Bootstrap:** reads stored values, calls `apply()` once, then subscribes to `panelStyle:change` so that external callers (the settings popover in `ui`) can update without holding a reference.

### 3.2 Changed modules

#### `LSB.ui` (module id: `ui`)

- **Additional dependencies:** `notif, panelStyle`.
- **New wiring:**
  - On `notif:updated` → toggle a small red dot in the pill (`<span class="lsb-dot">`) and re-render the top section of the expanded panel with up to 5 notification rows.
  - On `panel:reapply` → read `panelStyle.state` and set CSS custom properties on the panel root: `--lsb-pos-x`, `--lsb-pos-y`, `--lsb-bg`, `--lsb-fg`, `--lsb-border`, `--lsb-shadow`.
  - Adds a `⚙` button to the expanded panel footer. Clicking it opens a small in-panel popover (no new globals) with radio groups for position and theme. Confirming the popover calls `panelStyle.set({...})`.

#### `LSB.css` (core/css)

- Adds CSS custom properties on `:host` (the injected `div#lsb-root`):
  - Default `position: fixed; top: var(--lsb-pos-y); right: var(--lsb-pos-x); bottom: var(--lsb-pos-y); left: var(--lsb-pos-x);` with the four corner variants resolved by `--lsb-pos-x` / `--lsb-pos-y` (one of them is `auto` and the other a fixed offset like `16px`).
  - Theme variables resolve through `prefers-color-scheme` when `theme === "auto"`, otherwise to the explicit palette.
  - Red dot: `width: 8px; height: 8px; background: #e64545; border-radius: 50%; position: absolute; top: -2px; right: -2px;` with the unread count rendered as a small `0–9+` text badge only when expanded.

### 3.3 Unchanged

`config, logger, utils, storage, http, events, dom, user, signin, debug, build, serve` — not modified.

## 4. Data Flow

### 4.1 Notification polling

```
[user module]  user:changed (logged in)
    ↓
[notif]        start()
    ↓
                endpoint probe (one-time per session):
                    1. Try cached GM endpoint.
                    2. If absent, GET candidate URLs in order:
                       /notifications, /notice, /user/notifications,
                       /user/<currentUserId>/notifications
                    3. For each: search response HTML for one of:
                       - a "通知" / "通知中心" heading
                       - a list-shaped element with class matching
                         /notif|notice|inbox|message/
                    4. First hit wins; cache it.
    ↓
                refresh() (also re-runs on manual click + every 60s + on visibilitychange)
    ↓
                parse() → { unread, list: 5 most recent }
    ↓
                emit('notif:updated', payload)
    ↓
[ui]           update pill red dot + re-render top section
```

Polling rules:

- Interval: **60 s**, started in `start()`, cleared in `stop()`.
- Document hidden → `setInterval` is paused via `visibilitychange` listener. When the page becomes visible again, run one `refresh()` immediately and resume the interval.
- After 3 consecutive errors, the interval falls back to 5 min until a refresh succeeds; `state.lastError` is exposed for the debug module.
- If the user is a guest (`user.info == null`), `notif` is never started.

### 4.2 Panel position / theme

```
[ui]            user clicks ⚙ in expanded panel
    ↓
                open settings popover (rendered inside the panel root)
    ↓
                user picks new pos / theme
    ↓
                on confirm → panelStyle.set({pos, theme})
    ↓
[panelStyle]    write to GM_setValue
    ↓
                emit('panel:reapply', {pos, theme})
    ↓
[ui]            applies CSS custom properties on panel root
```

Persistence:

- `GM_setValue('lsb:panel:pos', 'BR' | 'BL' | 'TR' | 'TL')`
- `GM_setValue('lsb:panel:theme', 'light' | 'dark' | 'auto')`
- Both are read at module init. Missing values fall back to `BR` and `auto`.

## 5. CSS contract

The injected root element gets a single class `lsb-root` plus dynamic data attributes:

- `data-pos="TL|TR|BL|BR"`
- `data-theme="light|dark|auto"`
- `data-notif="0|N"` where N is the unread count (0 hides the dot, N > 0 shows it)

All visual state is expressed through these attributes and CSS custom properties. The script never writes inline styles for layout — it only sets the data attributes and the four CSS variables.

## 6. Error Handling

| Failure | Behaviour |
|---|---|
| `notif` endpoint probe finds nothing | `state.endpoint = null`; `unread = 0`; `notif:updated` still fires with empty payload so the UI does not show a stale red dot. |
| Endpoint probe finds something but parsing fails | `state.lastError` set; red dot hidden; debug module logs. |
| `GM_setValue` write fails (quota, etc.) | `panelStyle.set` logs a warning and still emits `panel:reapply` so the in-session UX is unaffected. |
| Stale tab visibility change fires after `stop()` | `start()` / `stop()` are idempotent and track their own interval id; leftover listeners are removed. |

## 7. Storage Keys

| Key | Type | Default | Purpose |
|---|---|---|---|
| `lsb:panel:pos` | string | `BR` | Panel corner. |
| `lsb:panel:theme` | string | `auto` | Light / dark / auto. |
| `lsb:notif:endpoint` | string | unset | Discovered notifications URL. |

All other `lsb:*` keys (existing `lsb:config:*`, `lsb:user:*`, `lsb:signin:auto`, etc.) are untouched.

## 8. Testing

Manual smoke (in the user's logged-in Chrome, debug port 9222):

1. **Notification red dot**
   - From another device or session, post a reply that @-mentions the user.
   - On the floating panel, the red dot must appear within 60 s of the mention.
   - Click the pill to expand. Top section must list up to 5 notifications, each clickable to the topic.
2. **Visibility pause**
   - Switch to a different tab for 30 s. DevTools network panel must show no `/notifications` requests during that window.
   - Switch back; exactly one request must fire.
3. **Position persistence**
   - Click ⚙ → choose `TL`. Refresh the page. Panel must reappear top-left.
4. **Theme persistence**
   - Click ⚙ → choose `dark`. Refresh. Panel background must be dark; `localStorage` / `GM_*` must contain `lsb:panel:theme: "dark"`.
   - Choose `auto`. Panel must follow the OS / browser `prefers-color-scheme` setting.
5. **Failure paths**
   - Manually set `LSB.config.site.apiBase` to an unreachable host in dev console. After the next interval tick, no red dot must show, and `window.LSB.notif.state.lastError` must contain a non-null string.

The `debug` module already exposes `LSB.notif.state` and `LSB.panelStyle.state`, so no new debug surface is needed.

## 9. Risk and Compliance

- **Greasy Fork policy.** Notification fetches use `GM_xmlhttpRequest` with the user's current session cookie. From the script's perspective this is "the user is browsing the site"; we do not post mutations, do not bypass rate limits, and do not bypass authentication. The 60 s interval is conservative and visibility-paused.
- **Site changes.** Endpoint discovery means if linux.sb moves the notifications URL, the next probe re-discovers it on the next page load (cached GM key, but if missing the probe runs).
- **No silent writes.** Mark-as-read, follow, like, etc. are explicitly out of scope. The script only reads.

## 10. Rollout

1. Implement against this spec, build dev, push to local Tampermonkey via `node chrome-cdp.mjs tm-update`.
2. Verify the smoke checklist in section 8.
3. Bump `.build-meta.json` from `1.0.1` to `1.1.0`, rebuild, commit, push to `main`. Greasy Fork auto-syncs the new public build; Tampermonkey auto-updates installed copies.
4. README: append a "Notifications, panel position & theme" feature bullet to the existing Features list.

## 11. Open Questions

None — the user already picked direction A2 and the polling strategy.
