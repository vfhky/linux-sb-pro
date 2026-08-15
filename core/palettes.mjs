// Theme palettes (design tokens) — color values taken from LDStatus Pro's
// verified token set (#ldsp-panel in ldstatuspro.user.js) so the panel
// shares its refined dark/light look.
const PALETTES = {
  light: {
    bg: "rgba(250,251,254,0.97)",
    bgCard: "rgba(245,247,252,0.94)",
    bgHover: "rgba(238,242,250,0.96)",
    fg: "#1e2030",
    fgSec: "#4a5068",
    fgMut: "#8590a6",
    accent: "#5070d0",
    accentLight: "#6b8cef",
    ok: "#4a9e8f",
    warn: "#c49339",
    danger: "#d45d6e",
    border: "rgba(0,0,0,0.08)",
    borderStrong: "rgba(0,0,0,0.12)",
    scrollbar: "rgba(15,23,42,0.18)",
    scrollbarHover: "rgba(15,23,42,0.34)",
    shadow: "0 20px 48px rgba(30,41,80,0.16)",
    glow: "0 0 0 1px rgba(80,112,208,0.22), 0 20px 48px rgba(30,41,80,0.18)",
  },
  dark: {
    bg: "#12131a",
    bgCard: "rgba(24,26,36,0.92)",
    bgHover: "rgba(38,42,56,0.95)",
    fg: "#e4e6ed",
    fgSec: "#9499ad",
    fgMut: "#5d6275",
    accent: "#6b8cef",
    accentLight: "#8aa4f4",
    ok: "#5bb5a6",
    warn: "#d4a853",
    danger: "#e07a8d",
    border: "rgba(255,255,255,0.06)",
    borderStrong: "rgba(255,255,255,0.1)",
    scrollbar: "rgba(140,150,175,0.5)",
    scrollbarHover: "rgba(140,150,175,0.7)",
    shadow: "0 20px 48px rgba(0,0,0,0.4)",
    glow: "0 0 0 1px rgba(107,140,239,0.2), 0 20px 48px rgba(0,0,0,0.5)",
  },
};

export const THEMES = ["light", "dark", "auto"];

export function listThemes() { return THEMES.slice(); }

export function getPalette(name) {
  if (name === "auto") throw new Error("palettes: auto is a meta-theme, resolve via ui");
  if (!PALETTES[name]) throw new Error("palettes: unknown theme " + name);
  return PALETTES[name];
}
