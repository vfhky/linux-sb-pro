# Layouts — linux.sb Suite

## Layout Architecture
This userscript has NO traditional page layouts (no nav/sidebar/footer components).
The entire UI is a **single floating panel** (`#lsb-panel`) injected at
`document.documentElement` level, anchored **right-center** of the viewport
(`top:50%; transform:translateY(-50%); right:12px`).

The panel has a fixed vertical skeleton (LDStatus-style):
1. **Header band** (.lsb-hdr) — always visible, even when collapsed
2. **Settings dropdown** (.lsb-settings-menu) — absolute overlay under header
3. **Details body** (.lsb-details) — collapsed by default (max-height:0),
   expands to fixed 560px with internal scroll

### Full Panel Skeleton (root.innerHTML)
File: `linux-sb-suite.user.js` (ui module, template ~1780–1900)

```html
<div class="lsb-glow" aria-hidden="true"></div>
<div class="lsb-hdr lsb-compact" data-lsb="compact">
  <div class="lsb-hdr-info">
    <div class="lsb-site-wrap">
      <img class="lsb-site-icon" src="https://linux.sb/app/assets/index.svg" data-lsb="site-icon" />
      <span class="lsb-site-ver">v<span data-lsb="version">0.0.0</span></span>
    </div>
    <div class="lsb-hdr-text">
      <span class="lsb-title">linux.sb 助手</span>
      <span class="lsb-ver"><span class="lsb-app-name">linux.sb Suite</span></span>
    </div>
  </div>
  <span class="lsb-dot lsb-loading" data-lsb="dot" title="载入中"></span>
  <div class="lsb-hdr-btns">
    <button class="lsb-hdr-btn" data-lsb="refresh" title="刷新">🔄svg</button>
    <button class="lsb-hdr-btn" data-lsb="gear" title="设置">⚙️svg</button>
    <button class="lsb-hdr-btn" data-lsb="update" title="检查更新">🔍svg</button>
  </div>
  <span class="lsb-chevron">▾</span>
</div>
<div class="lsb-settings-menu" aria-hidden="true">
  <div class="lsb-settings-view active" data-settings-view="root">
    <div class="lsb-settings-head"><span>设置</span></div>
    <button class="lsb-settings-nav" data-settings-open="theme">🎨 主题 ›</button>
    <div class="lsb-settings-toggle">⚡ 自动签到 <switch></div>
  </div>
  <div class="lsb-settings-view" data-settings-view="theme">
    <button class="lsb-settings-back" data-settings-back="root">‹</button>
    <div class="lsb-settings" data-lsb="settings"></div>
  </div>
</div>
<div class="lsb-details">
  <div class="lsb-user" data-lsb="rank-row">
    <div class="lsb-user-left">
      <div class="lsb-user-row">
        <span class="lsb-avatar-frame"><img class="lsb-avatar" data-lsb="avatar" /></span>
        <div class="lsb-user-info">
          <span class="lsb-user-name" data-lsb="name">…</span>
          <span class="lsb-user-meta" data-lsb="meta">—</span>
        </div>
      </div>
      <div class="lsb-user-status">
        <span data-lsb="signin-text" class="lsb-hero-signed" hidden>✓ 已签到</span>
        <button data-lsb="signin" class="lsb-hero-btn" hidden>签到</button>
      </div>
    </div>
    <div class="lsb-stats" data-lsb="stats">
      <div class="lsb-stats-ring" data-lsb="stats-ring">
        <svg viewBox="0 0 42 42" width="42" height="42">
          <circle class="lsb-ring-bg" cx="21" cy="21" r="16.5" />
          <circle class="lsb-ring-fill" data-lsb="ring-fill" cx="21" cy="21" r="16.5" stroke-dasharray="103.67" />
        </svg>
        <span class="lsb-stats-num" data-lsb="stats-streak">--</span>
      </div>
      <span class="lsb-stats-label">连续签到</span>
    </div>
  </div>
  <div class="lsb-tabs" data-lsb="tabs">
    <div class="lsb-tab-indicator"><div class="lsb-tab-indicator-glass"></div><div class="lsb-tab-indicator-shine"></div></div>
    <button class="lsb-tab active" data-lsb-tab="checkin">📋 签到</button>
    <button class="lsb-tab" data-lsb-tab="notif">🔔 通知</button>
    <button class="lsb-tab" data-lsb-tab="history">🕘 浏览历史</button>
    <button class="lsb-tab" data-lsb-tab="settings">⚙️ 设置</button>
  </div>
  <div class="lsb-content">
    <div class="lsb-pane active" data-lsb-pane="checkin"><div class="lsb-sections" data-lsb="sections-checkin"></div></div>
    <div class="lsb-pane" data-lsb-pane="notif"><div class="lsb-sections" data-lsb="sections"></div></div>
    <div class="lsb-pane" data-lsb-pane="history"><div class="lsb-sections" data-lsb="sections-history"></div></div>
    <div class="lsb-pane" data-lsb-pane="settings"></div>
  </div>
</div>
```

## Collapsed State
When collapsed (`:not(.lsb-open)`), the panel shrinks to a 48px gradient pill
showing only the site icon. The details body hides (max-height:0).

```css
#lsb-panel:not(.lsb-open) { width:48px !important; height:48px !important; border-radius:16px; background:linear-gradient(135deg,#7a9bf5,#5a7de0 45%,#5bb5a6); cursor:pointer; }
#lsb-panel:not(.lsb-open) .lsb-details { max-height:0 !important; opacity:0; visibility:hidden; }
```

## Settings Dropdown (multi-view)
Two views: root (theme nav + auto-signin toggle) and theme (segmented pills).
Navigation via `[data-settings-open]` / `[data-settings-back]` with slide-in
animation.
