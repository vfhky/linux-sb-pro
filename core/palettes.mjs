// Theme palettes (design tokens).  Add a new theme here + a matching CSS
// rule and it works everywhere automatically.  "auto" is a meta-theme
// resolved by the ui module against prefers-color-scheme.
// Each palette carries the full token set emitted by core/css.mjs
// (PALETTE_TOKENS): surfaces, text levels, accent, state colors, borders,
// shadows and glow.
const PALETTES = {
  light: {
    bg: "rgba(255,255,255,0.9)",
    bgCard: "rgba(15,23,42,0.03)",
    bgHover: "rgba(15,23,42,0.06)",
    fg: "#1e2433",
    fgSec: "#5b6478",
    fgMut: "#8b93a7",
    accent: "#5070e0",
    accentLight: "#6b8cff",
    ok: "#16a34a",
    warn: "#d97706",
    danger: "#dc2626",
    border: "rgba(15,23,42,0.08)",
    borderStrong: "rgba(15,23,42,0.16)",
    scrollbar: "rgba(15,23,42,0.18)",
    scrollbarHover: "rgba(15,23,42,0.34)",
    shadow: "0 12px 36px rgba(30,41,80,0.16)",
    glow: "0 0 0 1px rgba(80,112,224,0.22), 0 12px 36px rgba(80,112,224,0.18)",
  },
  dark: {
    bg: "rgba(17,19,28,0.86)",
    bgCard: "rgba(255,255,255,0.045)",
    bgHover: "rgba(255,255,255,0.08)",
    fg: "#e8eaf2",
    fgSec: "#9aa1b5",
    fgMut: "#626a80",
    accent: "#6b8cff",
    accentLight: "#93aaff",
    ok: "#34d399",
    warn: "#fbbf24",
    danger: "#f87171",
    border: "rgba(255,255,255,0.09)",
    borderStrong: "rgba(255,255,255,0.18)",
    scrollbar: "rgba(255,255,255,0.18)",
    scrollbarHover: "rgba(255,255,255,0.34)",
    shadow: "0 12px 40px rgba(0,0,0,0.45)",
    glow: "0 0 0 1px rgba(107,140,255,0.22), 0 12px 36px rgba(0,0,0,0.5)",
  },
};

export const THEMES = ["light", "dark", "auto"];

export function listThemes() { return THEMES.slice(); }

export function getPalette(name) {
  if (name === "auto") throw new Error("palettes: auto is a meta-theme, resolve via ui");
  if (!PALETTES[name]) throw new Error("palettes: unknown theme " + name);
  return PALETTES[name];
}
