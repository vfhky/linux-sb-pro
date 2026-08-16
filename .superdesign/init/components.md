# Components — linux.sb Suite (Tampermonkey userscript)

## Architecture Note
This project is a **single-file Tampermonkey userscript** (no framework, no JSX, no
component library). All UI primitives are defined as:
- CSS classes injected via `GM_addStyle` inside the `ui` module of
  `linux-sb-suite.user.js` (lines ~1195–1760)
- HTML skeleton built by `root.innerHTML` in the same file (lines ~1780–1900)
- Sections contributed by other modules via `LSB.sections.register(name, {pane, render})`

The panel follows the **LDStatus Pro** design language (deep-space glass / light
clean theme, 4-tab layout, frosted glass tab bar, SVG progress ring).

## Shared UI Primitives

### LSB Panel Shell (#lsb-panel)
- File: `linux-sb-suite.user.js` (ui module, CSS ~1195–1230)
- The floating glass panel. Dark theme = deep-space glass (blur 22px + ambient
  glow); light theme = clean white with light frosted blur.
- Key CSS: position `fixed`, width `min(352px, 92vw)`, radius 13px,
  `backdrop-filter: blur(22px) saturate(160%)` (dark) / `blur(10px)` (light).

```css
#lsb-panel {
  position: fixed; z-index: 2147483646;
  font: 13px/1.55 "Inter", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--lsb-fg, #e4e6ed);
  background: var(--lsb-bg, #12131a);
  border: 1px solid var(--lsb-border, rgba(255,255,255,0.09));
  border-radius: 13px;
  box-shadow: var(--lsb-shadow, 0 24px 64px rgba(0,0,0,0.5)), 0 0 0 1px var(--lsb-border-accent, rgba(107,140,239,0.08)), inset 0 1px 0 rgba(255,255,255,0.06);
  backdrop-filter: blur(22px) saturate(160%);
  width: min(352px, 92vw); max-width: 352px; min-width: 300px;
  overflow: hidden;
}
/* right-center placement */
#lsb-panel[data-pos="RC"] { top: 50%; transform: translateY(-50%); }
#lsb-panel[data-effective-theme="light"] {
  background: #ffffff;
  backdrop-filter: blur(10px) saturate(140%);
  box-shadow: 0 12px 32px rgba(30,41,80,0.12), 0 0 0 1px rgba(80,112,208,0.12), inset 0 1px 0 rgba(255,255,255,0.6);
}
```

### Header Band (.lsb-hdr)
- File: `linux-sb-suite.user.js` (ui module, CSS ~1303–1330, template ~1795–1830)
- Gradient brand band: site icon + version stacked (left), title + app-name
  (middle), signin dot, action buttons (right).
- 3 header buttons: refresh 🔄, settings ⚙️, update 🔍 (all 28px, radius 6px,
  `rgba(255,255,255,.12)` background, hover lifts).

```css
#lsb-panel .lsb-hdr {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; min-height: 52px;
  background: linear-gradient(135deg, #5a7de0 0%, #4a6bc9 100%);
}
#lsb-panel .lsb-hdr::before { /* top sheen */ }
#lsb-panel .lsb-site-wrap { display:flex; flex-direction:column; align-items:center; gap:3px; }
#lsb-panel .lsb-site-icon { width:26px; height:26px; border-radius:7px; border:2px solid rgba(255,255,255,.25); }
#lsb-panel .lsb-site-ver { font-size:9px; color:#fff; background:rgba(0,0,0,.25); padding:1px 5px; border-radius:5px; }
#lsb-panel .lsb-title { font-weight:800; font-size:14px; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.2); }
#lsb-panel .lsb-app-name { font-size:10px; font-weight:700; background:linear-gradient(90deg,#a8c0f8,#7a9eef,#7cc9bc,#7a9eef,#a8c0f8); background-size:200% auto; -webkit-background-clip:text; -webkit-text-fill-color:transparent; animation:lsb-gradient-shift 6s ease infinite; }
#lsb-panel .lsb-hdr-btn { width:28px; height:28px; border-radius:6px; background:rgba(255,255,255,.12); color:#fff; }
#lsb-panel .lsb-hdr-btn svg { width:16px; height:16px; flex:none; } /* prevents site CSS collapse */
```

### User Card (.lsb-user)
- File: `linux-sb-suite.user.js` (CSS ~1435–1520, template ~1865–1890)
- Two-column grid: user identity (avatar + name + meta + signin hero) on the
  left; stats card (SVG progress ring + streak label) on the right.
- Avatar: 52px, radius 12px, 2px accent border (LDStatus style).

```css
#lsb-panel .lsb-user {
  display: grid; grid-template-columns: minmax(0,1fr) minmax(72px,92px);
  gap: 10px; padding: 10px 16px 10px;
  background: var(--lsb-bg-card, rgba(24,26,36,0.92));
  border-bottom: 1px solid var(--lsb-border, rgba(255,255,255,0.06));
}
#lsb-panel .lsb-avatar { width:52px; height:52px; border-radius:12px; border:2px solid var(--lsb-accent,#6b8cef); }
#lsb-panel .lsb-user-name { font-size:16px; font-weight:700; background:linear-gradient(90deg,var(--lsb-fg,#e4e6ed),var(--lsb-fg-sec,#9499ad)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
#lsb-panel .lsb-user-meta { font-size:12px; color:var(--lsb-fg-mut,#5d6275); }
#lsb-panel .lsb-stats { /* 2:1 aspect reading-style card */ aspect-ratio:2/1; min-width:84px; border-radius:10px; }
#lsb-panel .lsb-stats-ring { position:relative; width:46px; height:46px; }
#lsb-panel .lsb-ring-fill { stroke:url(#lsb-ring-grad); transition:stroke-dashoffset 1s cubic-bezier(.22,1,.36,1); }
#lsb-panel .lsb-hero-signed { color:var(--lsb-ok,#5bb5a6); background:var(--lsb-ok-bg,rgba(91,181,166,.12)); border:1px solid var(--lsb-ok,#5bb5a6); border-radius:999px; padding:7px 16px; }
#lsb-panel .lsb-hero-btn { background:linear-gradient(135deg,var(--lsb-accent,#6b8cef),var(--lsb-accent-light,#8aa4f4)); color:#fff; border-radius:999px; padding:8px 20px; }
```

### Tab Bar (.lsb-tabs) — LDStatus frosted glass
- File: `linux-sb-suite.user.js` (CSS ~1530–1590, template ~1900–1930)
- 4 tabs: 📋 签到 / 🔔 通知 / 🕘 浏览历史 / ⚙️ 设置
- Frosted glass strip with sliding indicator (glass + shine layers).

```css
#lsb-panel .lsb-tabs {
  position:relative; display:flex; padding:7px 9px; gap:5px;
  background:rgba(32,36,50,.62); backdrop-filter:blur(20px) saturate(175%);
  border:1px solid rgba(255,255,255,.11); border-radius:14px;
  box-shadow:0 6px 20px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.16);
  margin:8px 10px 6px;
}
#lsb-panel[data-effective-theme="light"] .lsb-tabs {
  background:rgba(255,255,255,.75); border-color:rgba(255,255,255,.9);
  box-shadow:0 5px 16px rgba(80,112,208,.1), inset 0 1px 0 rgba(255,255,255,.95);
}
#lsb-panel .lsb-tab-indicator-glass { background:rgba(255,255,255,.14); box-shadow:0 7px 16px rgba(42,64,120,.24), inset 0 1px 0 rgba(255,255,255,.3), inset 0 -1px 0 rgba(0,0,0,.18); border:1px solid rgba(138,164,244,.4); }
#lsb-panel .lsb-tab-indicator-shine { /* top gloss */ background:linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.12) 45%,transparent); }
#lsb-panel .lsb-tab { flex:1; padding:7px 8px; font-size:11px; font-weight:600; color:var(--lsb-fg-sec,#9499ad); border-radius:10px; }
#lsb-panel .lsb-tab.active { color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.22); }
#lsb-panel[data-effective-theme="light"] .lsb-tab.active { color:#173263; text-shadow:none; }
```

### Check-in Pane (.lsb-checkin-*) — LDStatus .ldsp-reqs slot
- File: `linux-sb-suite.user.js` (CSS ~1660–1700, template via sections)
- Progress ring (64px) + streak/total stats + status line.

```css
#lsb-panel .lsb-checkin-hero { display:flex; align-items:center; gap:16px; padding:16px; background:var(--lsb-bg-card,rgba(24,26,36,.92)); border:1px solid var(--lsb-border,rgba(255,255,255,.06)); border-radius:10px; }
#lsb-panel .lsb-checkin-ring { position:relative; width:64px; height:64px; }
#lsb-panel .lsb-checkin-ring svg { transform:rotate(-90deg); }
#lsb-panel .lsb-checkin-ring-val { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; }
#lsb-panel .lsb-checkin-stat-val { font-size:20px; font-weight:800; }
#lsb-panel .lsb-checkin-stat-val.ok { color:var(--lsb-ok,#5bb5a6); }
#lsb-panel .lsb-checkin-stat-lbl { font-size:9px; color:var(--lsb-fg-mut,#5d6275); font-weight:600; }
#lsb-panel .lsb-checkin-status { font-size:12px; font-weight:600; text-align:center; padding:9px 12px; border-radius:10px; color:var(--lsb-ok,#5bb5a6); background:var(--lsb-ok-bg,rgba(91,181,166,.12)); border:1px solid var(--lsb-ok,#5bb5a6); }
```

### Notification List (.lsb-notif-list)
- File: `linux-sb-suite.user.js` (CSS ~1595–1625)
- Card-style list items with hover accent.

```css
#lsb-panel .lsb-notif-list li { padding:10px 12px; margin-bottom:6px; border-radius:12px; font-size:12px; background:var(--lsb-bg-card,rgba(24,26,36,.7)); border:1px solid var(--lsb-border,rgba(255,255,255,.05)); }
#lsb-panel .lsb-notif-list li:hover { background:var(--lsb-bg-hover,rgba(38,42,56,.9)); border-color:rgba(107,140,239,.3); transform:translateY(-1px); }
#lsb-panel .lsb-notif-list a { color:var(--lsb-fg-sec,#9499ad); text-decoration:none; }
#lsb-panel .lsb-notif-list .lsb-mention { color:var(--lsb-accent-light,#8aa4f4); font-weight:600; }
```

### History List (.lsb-history-list)
- File: `linux-sb-suite.user.js` (CSS ~1106–1116)
- Icon chip + title + time pill (LDStatus-style).

```css
#lsb-panel .lsb-history-list li { display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:10px; }
#lsb-panel .lsb-history-ic { width:24px; height:24px; border-radius:8px; color:var(--lsb-fg-sec,#9499ad); background:var(--lsb-bg-hover,rgba(38,42,56,.95)); }
#lsb-panel .lsb-history-title { font-size:12px; color:var(--lsb-fg-sec,#9499ad); text-decoration:none; }
#lsb-panel .lsb-history-time { font-size:10px; color:var(--lsb-fg-mut,#5d6275); background:var(--lsb-bg-hover,rgba(38,42,56,.95)); border:1px solid var(--lsb-border,rgba(255,255,255,.08)); padding:2px 8px; border-radius:999px; }
```

### Settings Menu (.lsb-settings-menu)
- File: `linux-sb-suite.user.js` (CSS ~1626–1700, template ~1830–1860)
- Multi-view dropdown (root → theme sub-view), back navigation, segmented
  theme pills.

```css
#lsb-panel .lsb-settings-menu { position:absolute; top:34px; left:8px; width:clamp(220px,85%,300px); background:var(--lsb-bg-card,rgba(24,26,36,.97)); border:1px solid var(--lsb-border2,rgba(255,255,255,.1)); border-radius:12px; box-shadow:0 20px 48px rgba(0,0,0,.5); }
#lsb-panel .lsb-settings-view { display:none; }
#lsb-panel .lsb-settings-view.active { display:block; animation:lsb-settings-in .22s var(--ease-out); }
@keyframes lsb-settings-in { from { opacity:0; transform:translateX(10px); } to { opacity:1; transform:none; } }
#lsb-panel .lsb-settings-back { width:24px; height:24px; border-radius:7px; background:var(--lsb-bg-el,rgba(32,35,48,.88)); color:var(--lsb-fg-sec,#9499ad); }
#lsb-panel .lsb-seg span { padding:6px 14px; border-radius:999px; font-size:12px; color:var(--lsb-fg-sec,#9499ad); background:var(--lsb-bg-hover,rgba(38,42,56,.9)); border:1px solid var(--lsb-border,rgba(255,255,255,.08)); transition:color .15s, border-color .15s, background .15s; }
#lsb-panel .lsb-seg.active span { background:linear-gradient(135deg,var(--lsb-accent,#6b8cef),var(--lsb-accent-light,#8aa4f4)); color:#fff; border-color:transparent; }
```

### Toast (LSB.toast)
- File: `linux-sb-suite.user.js` (injected ~1760–1780)
- Bottom-right toast notifications, themed via CSS vars.

```css
.lsb-toast { color:var(--lsb-fg,#e4e6ed); background:var(--lsb-bg-card,rgba(24,26,36,.92)); border:1px solid var(--lsb-border,rgba(255,255,255,.06)); border-radius:12px; box-shadow:var(--lsb-shadow,0 20px 48px rgba(0,0,0,.4)); }
.lsb-toast[data-type=success] { border-left:3px solid var(--lsb-ok,#5bb5a6); }
.lsb-toast[data-type=error] { border-left:3px solid var(--lsb-danger,#e07a8d); }
.lsb-toast[data-type=info] { border-left:3px solid var(--lsb-accent,#6b8cef); }
```
