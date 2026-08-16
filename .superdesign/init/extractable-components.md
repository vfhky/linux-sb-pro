# Extractable Components — linux.sb Suite

Components that can be extracted as reusable Superdesign DraftComponents.
All live in `linux-sb-suite.user.js` (ui module) — single-file userscript.

## Layout Components

### PanelShell
- Source: `linux-sb-suite.user.js` (ui module, #lsb-panel)
- Category: layout
- Description: Floating glass panel, right-center anchored, collapsible 48px pill
- Extractable props: isOpen (boolean), theme (light/dark/auto), position (string)
- Hardcoded: glass CSS, gradient pill, glow layers, 352px width, 560px max-height

### HeaderBand
- Source: `linux-sb-suite.user.js` (.lsb-hdr)
- Category: layout
- Description: Gradient brand band with site icon+version, title+app-name, signin dot, action buttons
- Extractable props: siteIcon (url), siteName (string), version (string), appName (string), signinStatus (string), hasUpdate (boolean)
- Hardcoded: gradient, sheen ::before, hover glow ::after, button styles

### TabBar
- Source: `linux-sb-suite.user.js` (.lsb-tabs)
- Category: layout
- Description: Frosted glass 4-tab bar with sliding indicator (📋签到/🔔通知/🕘历史/⚙️设置)
- Extractable props: activeTab (string), tabBadges (object: {notif: count})
- Hardcoded: emoji icons, glass+shine indicator, 11px/600 typography

## Basic Components

### UserCard
- Source: `linux-sb-suite.user.js` (.lsb-user)
- Category: basic
- Description: Two-column user identity + stats ring card
- Extractable props: avatarUrl (url), displayName (string), handle (string), meta (string), streak (number), streakGoal (number), isSignedIn (boolean)
- Hardcoded: accent border avatar, gradient name, 2:1 stats aspect, ring SVG

### ProgressRing
- Source: `linux-sb-suite.user.js` (.lsb-stats-ring / .lsb-checkin-ring)
- Category: basic
- Description: SVG circular progress with gradient stroke + center number
- Extractable props: value (number), max (number), size (number), label (string)
- Hardcoded: gradient #5070d0→#5bb5a6, stroke width, dasharray calc

### CheckinHero
- Source: `linux-sb-suite.user.js` (.lsb-checkin-hero)
- Category: basic
- Description: Big progress ring + streak/total stats + status line
- Extractable props: streak (number), total (number), goal (number), signedInToday (boolean)
- Hardcoded: card bg, ring 64px, stat typography

### NotificationItem / NotificationList
- Source: `linux-sb-suite.user.js` (.lsb-notif-list)
- Category: basic
- Description: Card list of notifications with unread mention highlight
- Extractable props: items (array[{title,url,isMention}]), unreadCount (number)
- Hardcoded: card styles, hover lift, mention color

### HistoryItem / HistoryList
- Source: `linux-sb-suite.user.js` (.lsb-history-list)
- Category: basic
- Description: Icon chip + title + relative-time pill list
- Extractable props: items (array[{title,url,ts}])
- Hardcoded: chip styles, pill time, icon SVGs

### SettingsDropdown
- Source: `linux-sb-suite.user.js` (.lsb-settings-menu)
- Category: basic
- Description: Multi-view dropdown (root → theme) with back nav + segmented pills
- Extractable props: theme (string), autoSignin (boolean), open (boolean)
- Hardcoded: view switching, slide-in animation, seg pill styles

### SigninHero
- Source: `linux-sb-suite.user.js` (.lsb-hero-signed / .lsb-hero-btn)
- Category: basic
- Description: Signed-in pill / signin CTA button
- Extractable props: state (signed/unsigned/loading), disabled (boolean)
- Hardcoded: ok-bg pill, accent gradient button, 999px radius

### Toast
- Source: `linux-sb-suite.user.js` (LSB.toast / .lsb-toast)
- Category: basic
- Description: Bottom-right themed toast with type accent border
- Extractable props: type (success/error/info), message (string), duration (number)
- Hardcoded: glass card, left accent border, slide-in animation
