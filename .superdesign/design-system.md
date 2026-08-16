# Design System — linux.sb Suite (extracted from LDStatus Pro)

> Style source: **LDStatus Pro** (linux.do trust-level panel userscript). The
> design DNA below is extracted from its verified source
> (docs/superpowers/specs/ldstatuspro.user.js, CSS 3969–4390, panel template
> 12147–12430). The target product is a linux.sb floating panel with 4 tabs:
> check-in, notifications, browsing history, settings.

## Product Context

- **What it is**: Tampermonkey floating panel for the linux.sb forum — shows
  daily check-in status, notifications, browsing history, theme settings.
- **Key user flow**: glance at panel (right-center of viewport) → see check-in
  ring + streak → one-click sign-in → read notifications → browse history.
- **Panel anatomy** (top→bottom): gradient header band (site icon + version +
  title + app-name + action buttons) → user card (avatar + name + meta +
  signin hero + streak ring card) → frosted glass tab bar (4 tabs) → content
  pane (check-in hero / notif list / history list / settings).
- **Position**: fixed right-center (`top:50%; transform:translateY(-50%); right:12px`).
- **Dimensions**: width 352px, details max-height 560px (internal scroll),
  collapsed = 48px gradient pill.

## Design Language

**"Frosted deep-space"** — LDStatus's signature:
- Dark theme: near-black translucent glass (`#12131a` base) with 22px
  backdrop blur + saturated colors, ambient blue/purple + teal glows.
- Light theme: clean white (`#ffffff`) with light frosted blur, soft blue
  shadows, subtle accent glows.
- Every surface is a rounded card with 1px hairline borders; gradients are
  used for brand accents (header, app-name, active tab, buttons, ring fill).

## Color System

### Dark theme tokens
| Token | Value | Usage |
|---|---|---|
| --bg | #12131a | panel background |
| --bg-card | rgba(24,26,36,.92) | cards / lists |
| --bg-hover | rgba(38,42,56,.95) | hover surfaces |
| --bg-el | rgba(32,35,48,.88) | input/settings rows |
| --txt | #e4e6ed | primary text |
| --txt-sec | #9499ad | secondary text |
| --txt-mut | #5d6275 | muted / labels |
| --accent | #6b8cef | primary blue |
| --accent-light | #8aa4f4 | accent gradient end |
| --accent2 | #5bb5a6 | teal secondary |
| --accent3 | #e07a8d | pink tertiary |
| --ok | #5bb5a6 | success (signed-in) |
| --warn | #d4a853 | warning (unsigned) |
| --err | #e07a8d | error / danger |
| --border | rgba(255,255,255,.06) | hairlines |
| --border-accent | rgba(107,140,239,.3) | accent borders |

### Light theme tokens
| Token | Value |
|---|---|
| --bg | #ffffff |
| --bg-card | rgba(247,249,253,.96) |
| --bg-hover | rgba(238,242,250,.96) |
| --bg-el | rgba(255,255,255,.96) |
| --txt | #1e2030 |
| --txt-sec | #4a5068 |
| --txt-mut | #8590a6 |
| --accent | #5070d0 |
| --accent-light | #6b8cef |
| --ok | #4a9e8f |
| --warn | #c49339 |
| --err | #d45d6e |
| --border | rgba(0,0,0,.08) |

### Brand gradients (theme-independent)
- **Header band**: `linear-gradient(135deg, #5a7de0 0%, #4a6bc9 100%)`
- **Collapsed pill**: `linear-gradient(135deg, #7a9bf5, #5a7de0 45%, #5bb5a6)`
- **App-name text**: `linear-gradient(90deg, #a8c0f8, #7a9eef, #7cc9bc, #7a9eef, #a8c0f8)` animated 200% shift, 6s loop
- **Progress ring fill**: `linear-gradient(135deg, #5070d0, #5bb5a6)`
- **Active tab / CTA**: `linear-gradient(135deg, accent, accent-light)`

## Typography

- **Stack**: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif`
- **Base**: 13px / 1.55
- **Header title**: 14px, weight 800, white, text-shadow 0 1px 2px rgba(0,0,0,.2)
- **App name**: 10px, weight 700, animated gradient text
- **User display name**: 16px, weight 700, gradient text (txt→txt-sec)
- **Tab text**: 11px, weight 600
- **Labels/captions**: 9–10px, muted, sometimes uppercase + letter-spacing .08em
- **Stat values**: 15–22px, weight 800, tight letter-spacing -0.02em

## Spacing & Radius

- **Radii**: --r-sm 6px, --r-md 10px, --r-lg 13px (em-based)
- **Header**: padding 10px 12px, min-height 52px, gap 8px
- **User card**: padding 10px 16px, grid gap 10px
- **Tabs**: padding 7px 9px, gap 5px, margin 8px 10px 6px
- **Sections**: padding 10px
- **List items**: padding 8–10px, margin-bottom 5–6px
- **Progress ring**: 46px (compact stats) / 64px (check-in hero), stroke 4.5–7

## Shadows

- **Dark panel**: `0 20px 48px rgba(0,0,0,.4)` + accent ring + inset top highlight
- **Light panel**: `0 12px 32px rgba(30,41,80,.12)` + soft accent ring
- **Cards**: inset 0 1px 0 rgba(255,255,255,.06)
- **Active tab indicator**: `0 7px 16px rgba(42,64,120,.24)`, inset highlights, 1px accent border
- **Buttons hover**: `0 4px 12px rgba(0,0,0,.2)` + lift translateY(-2px)

## Motion & Animation

- **Easing**: `cubic-bezier(.22,1,.36,1)` (ease), `cubic-bezier(.175,.885,.32,1.275)` (spring)
- **Panel enter**: fade + translateY(10px) scale(.97) → settle, 0.45s
- **Tab indicator**: spring slide (left 0.42s, width 0.32s, overshoot)
- **Theme switch**: background-color/color/border-color 0.3s smooth morph
- **Settings view**: slide-in translateX(10px) + fade, 0.22s
- **Ring fill**: stroke-dashoffset 1s ease
- **Reading icon / stats icon**: gentle bounce 3s infinite (translateY ±3px)
- **App-name gradient**: background-position shift 6s infinite
- **Hover lifts**: buttons/cards translateY(-1..-2px) scale(1.05)

## Component Style Guide

### Header band
Gradient brand strip, white content. Left: site icon (26px, radius 7px, 2px
white/25 border) stacked over version chip (9px, dark capsule). Middle: title
(14px 800) over animated app-name. Right: 28px round buttons
(rgba(255,255,255,.12), blur 4px, hover lifts + glows) + status dot + chevron.
Top sheen overlay + hover radial glow.

### User card
Two-column grid (identity | stats). Avatar 52px radius 12px with 2px accent
border + blue glow shadow; gradient text name; muted meta line (rank · points ·
streak). Right: compact 2:1 stats card with 46px progress ring + streak number +
capsule label. Below: signin hero — signed = ok-bg pill w/ check; unsigned =
accent gradient CTA.

### Tab bar
Frosted glass strip (dark: rgba(32,36,50,.62) blur 20px saturate 175%;
light: rgba(255,255,255,.75)). 4 equal tabs with emoji icon + 11px text.
Active tab: white text + glass indicator (translucent fill, top shine, accent
border, spring slide). Inactive: muted text, hover lifts + gloss.

### Check-in hero (pane)
Card with radial accent glow. Left: 64px progress ring (gradient fill, % in
center). Right: two stats (连续签到 / 累计签到) — 20px 800 values, 9px muted
labels. Below: status line (✓ 今日已签到 in ok-bg pill / 今日未签到 in warn).

### Notification list
Stacked cards: 12px text, card bg + hairline border, hover = lighter bg +
accent border + lift. Mentions highlighted in accent-light bold.

### History list
Rows: 24px icon chip (bg-hover, accent on hover) + 12px title (muted → bright
on hover) + relative-time pill (bg-hover, 999px radius, 10px muted).

### Settings dropdown
Multi-view (root → theme). Root: nav rows (icon + label + value + chevron ›)
+ auto-signin toggle (switch). Theme view: back button ‹ + segmented pills
(auto/light/dark) with gradient active state. Slide-in view transition.

## Non-Negotiables (fidelity constraints)
1. Use ONLY the fonts, colors, spacing, and component styles defined above.
2. Do not introduce fonts, colors, or visual styles not in this system.
3. Keep Inter/system font stack; never serif or decorative fonts.
4. Keep the header gradient (#5a7de0→#4a6bc9) and app-name animated gradient.
5. Keep the frosted glass tab bar + spring sliding indicator.
6. Keep the SVG progress ring with gradient fill.
7. Keep deep-space glass dark theme + clean white light theme.
8. Emoji icons for tabs (📋🔔🕘⚙️); real site icon (linux.sb index.svg).
