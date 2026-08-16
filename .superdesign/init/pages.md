# Pages — linux.sb Suite

## Page Model
This is a single floating panel (no traditional pages). The "page" the user
sees is the **panel UI**, which has 4 tab-panes. Below are the dependency
trees for each pane's render path.

## 1. Panel Shell (all panes)
Entry: `linux-sb-suite.user.js` ui module factory
Dependencies:
- linux-sb-suite.user.js (single file, everything inlined)
  - core: css.mjs (panelPositionCss, panelThemeCss, PALETTE_TOKENS)
  - core: palettes.mjs (getPalette)
  - core: dom-sections.mjs (createSectionRegistry)
  - core: settings.mjs (createRegistry)
  - core: i18n.mjs (createI18n)
  - lib: dom-refs.mjs (collectRefs)
  - lib: toast.mjs (createToastManager)
  - lib: tab-leader.mjs (createTabLeader)
  - lib: notif-view.mjs (notifViewDiff)
  - lib: time-format.mjs (formatRelativeTime)

## 2. Check-in Pane (default)
Entry: checkin-summary section (ui module)
Dependencies:
- linux-sb-suite.user.js ui module (LSB.sections.register "checkin-summary")
  - signin module: getStatus() → _signinStatusCache
  - lib: checkin-fetch.mjs (createCheckinIO)
  - lib: checkin-parse.mjs (parseCheckinPage)
  - core: poller.mjs (makePoller — auto signin)

## 3. Notifications Pane
Entry: notif-section (notif module)
Dependencies:
- linux-sb-suite.user.js notif module (LSB.sections.register "notif")
  - lib: notif-parse.mjs (parseNotifications)
  - lib: notif-probe.mjs (probeEndpoint)
  - lib: notif-view.mjs (notifViewDiff)
  - core: poller.mjs (makePoller)
  - lib: tab-leader.mjs (leader gate)

## 4. History Pane
Entry: history-section (history module)
Dependencies:
- linux-sb-suite.user.js history module (LSB.sections.register "history")
  - lib: history-store.mjs (createHistoryStore)
  - lib: time-format.mjs (formatRelativeTime)
  - core: dom-sections.mjs (render)

## 5. Settings Dropdown
Entry: ui module (renderSettings + settingsHost)
Dependencies:
- core: settings.mjs (createRegistry — panel.theme, signin.auto)
- panelStyle module (theme store, panel:reapply)
- core: palettes.mjs (getPalette)
- core: css.mjs (PALETTE_TOKENS)

## 6. Auto Sign-in Flow
Entry: signin module (ensureSignedIn)
Dependencies:
- signin module (getStatus/performSignin/setAutoSignin)
  - lib: checkin-fetch.mjs (fetchStatus, submit)
  - lib: checkin-parse.mjs (parse)
  - core: poller.mjs (auto poller)
  - lib: tab-leader.mjs (leader gate)
  - lib: notifier.mjs (milestone toasts)
  - lib: signin-tips.mjs (top bar when auto off)
