# Routes — linux.sb Suite

## Routing Model
This is a Tampermonkey userscript running on `https://linux.sb/*` (and
`https://www.linux.bi/*`). There are NO app routes — the panel is injected
on every page. However, the script's **modules react to URL patterns** to
decide which data to extract. These are the meaningful "page contexts":

| URL Pattern | Module Behavior | UI Effect |
|---|---|---|
| `/` (home) | user reads nav-mine + sidebar card; signin reads home-sidebar card | Full panel |
| `/daily_checkin` | signin reads button text (已签到/签到) | Panel + signin state |
| `/user/<id>` | user two-page safety: sidebar card belongs to page owner, preserves logged-in user from cache | Panel |
| `/topic/<id>` | visited marks links; history records visit | Panel + history entry |
| `/notifications` | notif parses list | notif badge/list |
| any page | ui.refresh() renders panel | Panel |

## Module → UI Mapping (the "routes" of the panel)

### Check-in Pane (default tab)
- Source: ui module + signin module + checkin-summary section
- Shows: SVG progress ring (streak/30 days), 连续签到 count, 累计签到 count,
  today's status line (✓ 今日已签到 / 今日未签到)
- Data flow: `refresh()` → `signin.getStatus()` → `_signinStatusCache`
  → `LSB.sections.render({pane:"checkin"})`

### Notifications Pane
- Source: notif module → notif-section
- Shows: unread badge in header (red dot), list of notifications
- Data flow: `notif.refresh()` (60s poll via makePoller, leader-gated) →
  `events.emit("notif:updated")` → `renderNotif()`

### History Pane
- Source: history module → history-section
- Shows: list of visited topics/users with relative time pills
- Data flow: `dom.onRouteChange` → `store.record(url,title)` →
  `events.emit("history:updated")` → re-render

### Settings Pane (tab) / Settings Dropdown
- Source: panelStyle module + ui module settings host
- Theme segmented control (auto/light/dark), auto-signin switch
- Data flow: change → `LSB.settings.get(key).set()` → `panel:reapply`
  → `applyPanelStyle()`

## Key Event Flow (module communication)
```
user.getCurrent() → events.emit("user:changed", u)
  → notif.bindUser (start/stop poller)
  → signin.ensureSignedIn (auto-signin)
  → ui.refresh (re-render panel)

signin.getStatus() → _signinStatusCache → ui.refresh
signin.performSignin() → events.emit("signin:status-changed") → ui.refresh
notif.refresh() → events.emit("notif:updated") → renderNotif (diff-based)
dom.onRouteChange → history.record → events.emit("history:updated") → ui.refresh
settings.set("panel.theme") → events.emit("panel:reapply") → applyPanelStyle
```
