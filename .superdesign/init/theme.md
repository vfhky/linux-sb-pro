# Theme — linux.sb Suite Design Tokens

## Part 1 — Compact Token Summary

The panel uses CSS custom properties (design tokens) defined per theme.
Source of truth: `core/palettes.mjs` (inlined at build time) + `core/css.mjs`
PALETTE_TOKENS table. Applied at runtime via `applyPanelStyle()` which sets
`--lsb-*` vars on `#lsb-panel` AND `documentElement`.

### Color Palette

| Token | Dark | Light |
|---|---|---|
| --lsb-bg (panel bg) | #12131a | #ffffff |
| --lsb-bg-card | rgba(24,26,36,.92) | rgba(247,249,253,.96) |
| --lsb-bg-hover | rgba(38,42,56,.95) | rgba(238,242,250,.96) |
| --lsb-bg-el | rgba(32,35,48,.88) | rgba(255,255,255,.96) |
| --lsb-fg (text) | #e4e6ed | #1e2030 |
| --lsb-fg-sec | #9499ad | #4a5068 |
| --lsb-fg-mut | #5d6275 | #8590a6 |
| --lsb-accent (primary) | #6b8cef | #5070d0 |
| --lsb-accent-light | #8aa4f4 | #6b8cef |
| --lsb-accent2 | #5bb5a6 | #4a9e8f |
| --lsb-accent2-light | #7cc9bc | #5bb5a6 |
| --lsb-accent3 | #e07a8d | #d45d6e |
| --lsb-ok (success) | #5bb5a6 | #4a9e8f |
| --lsb-ok-light | #7cc9bc | #5bb5a6 |
| --lsb-ok-bg | rgba(91,181,166,.12) | rgba(74,158,143,.08) |
| --lsb-warn | #d4a853 | #c49339 |
| --lsb-warn-bg | rgba(212,168,83,.12) | rgba(196,147,57,.08) |
| --lsb-danger (error) | #e07a8d | #d45d6e |
| --lsb-err-light | #ea9aa8 | #e07a8d |
| --lsb-err-bg | rgba(224,122,141,.12) | rgba(212,93,110,.08) |
| --lsb-border | rgba(255,255,255,.06) | rgba(0,0,0,.08) |
| --lsb-border-strong | rgba(255,255,255,.1) | rgba(0,0,0,.1) |
| --lsb-border-accent | rgba(107,140,239,.3) | rgba(80,112,208,.2) |
| --lsb-scrollbar | rgba(140,150,175,.5) | rgba(15,23,42,.18) |
| --lsb-scrollbar-hover | rgba(140,150,175,.7) | rgba(15,23,42,.34) |

### Header Gradient (always the same, brand)
`linear-gradient(135deg, #5a7de0 0%, #4a6bc9 100%)`
Collapsed pill: `linear-gradient(135deg, #7a9bf5, #5a7de0 45%, #5bb5a6)`
App-name gradient: `linear-gradient(90deg, #a8c0f8, #7a9eef, #7cc9bc, #7a9eef, #a8c0f8)` (animated 200% shift)

### Typography
- Font stack: `"Inter", -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
- Base: 13px/1.55
- Title: 14px 800 (header), 16px 700 (user name), 11px 600 (tabs), 10-12px (meta/labels)

### Spacing & Radius
- Radii: --r-sm 6px, --r-md 10px, --r-lg 13px (em-based, LDStatus)
- Panel padding: header 10px 12px, user 10px 16px, section 10px
- Tab bar: padding 7px 9px, gap 5px, margin 8px 10px 6px

### Shadows
- Dark: `0 20px 48px rgba(0,0,0,.4)` + accent ring
- Light: `0 12px 32px rgba(30,41,80,.12)` + accent ring

### Dimensions
- Panel: width 352px (LDStatus getConfig), max-height 560px (details), fixed
- Collapsed: 48×48px pill
- Avatar: 52px, progress ring: 46px (stats) / 64px (checkin pane)

## Part 2 — Raw Source Dumps

### core/palettes.mjs (full)
```js
const PALETTES = {
  light: {
    bg: "#ffffff",
    bgCard: "rgba(247,249,253,0.96)",
    bgHover: "rgba(238,242,250,0.96)",
    bgEl: "rgba(255,255,255,0.96)",
    fg: "#1e2030", fgSec: "#4a5068", fgMut: "#8590a6",
    accent: "#5070d0", accentLight: "#6b8cef",
    accent2: "#4a9e8f", accent2Light: "#5bb5a6", accent3: "#d45d6e",
    ok: "#4a9e8f", okLight: "#5bb5a6", okBg: "rgba(74,158,143,0.08)",
    warn: "#c49339", warnBg: "rgba(196,147,57,0.08)",
    danger: "#d45d6e", errLight: "#e07a8d", errBg: "rgba(212,93,110,0.08)",
    border: "rgba(0,0,0,0.08)", borderStrong: "rgba(0,0,0,0.1)", borderAccent: "rgba(80,112,208,0.2)",
    scrollbar: "rgba(15,23,42,0.18)", scrollbarHover: "rgba(15,23,42,0.34)",
    shadow: "0 20px 48px rgba(30,41,80,0.16)",
    glow: "0 0 0 1px rgba(80,112,208,0.22), 0 20px 48px rgba(30,41,80,0.18)",
  },
  dark: {
    bg: "#12131a",
    bgCard: "rgba(24,26,36,0.92)",
    bgHover: "rgba(38,42,56,0.95)",
    bgEl: "rgba(32,35,48,0.88)",
    fg: "#e4e6ed", fgSec: "#9499ad", fgMut: "#5d6275",
    accent: "#6b8cef", accentLight: "#8aa4f4",
    accent2: "#5bb5a6", accent2Light: "#7cc9bc", accent3: "#e07a8d",
    ok: "#5bb5a6", okLight: "#7cc9bc", okBg: "rgba(91,181,166,0.12)",
    warn: "#d4a853", warnBg: "rgba(212,168,83,0.12)",
    danger: "#e07a8d", errLight: "#ea9aa8", errBg: "rgba(224,122,141,0.12)",
    border: "rgba(255,255,255,0.06)", borderStrong: "rgba(255,255,255,0.1)", borderAccent: "rgba(107,140,239,0.3)",
    scrollbar: "rgba(140,150,175,0.5)", scrollbarHover: "rgba(140,150,175,0.7)",
    shadow: "0 20px 48px rgba(0,0,0,0.4)",
    glow: "0 0 0 1px rgba(107,140,239,0.2), 0 20px 48px rgba(0,0,0,0.5)",
  },
};
const THEMES = ["light", "dark", "auto"];
```

### core/css.mjs PALETTE_TOKENS (mapping table)
```js
export const PALETTE_TOKENS = [
  ["bg","--lsb-bg"], ["bgCard","--lsb-bg-card"], ["bgHover","--lsb-bg-hover"],
  ["bgEl","--lsb-bg-el"], ["fg","--lsb-fg"], ["fgSec","--lsb-fg-sec"],
  ["fgMut","--lsb-fg-mut"], ["accent","--lsb-accent"], ["accentLight","--lsb-accent-light"],
  ["accent2","--lsb-accent2"], ["accent2Light","--lsb-accent2-light"], ["accent3","--lsb-accent3"],
  ["ok","--lsb-ok"], ["okLight","--lsb-ok-light"], ["okBg","--lsb-ok-bg"],
  ["warn","--lsb-warn"], ["warnBg","--lsb-warn-bg"], ["danger","--lsb-danger"],
  ["errLight","--lsb-err-light"], ["errBg","--lsb-err-bg"],
  ["border","--lsb-border"], ["borderStrong","--lsb-border-strong"], ["borderAccent","--lsb-border-accent"],
  ["scrollbar","--lsb-scrollbar"], ["scrollbarHover","--lsb-scrollbar-hover"],
  ["shadow","--lsb-shadow"], ["glow","--lsb-glow"],
];
```

### Design Tokens block (ui module, inline in linux-sb-suite.user.js)
```css
#lsb-panel {
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --ease-out: cubic-bezier(0, 0.55, 0.45, 1);
  --r-sm: 6px; --r-md: 10px; --r-lg: 13px;
}
```
