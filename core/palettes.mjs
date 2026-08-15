// Theme palettes (design tokens) — the FULL verified LDStatus Pro token set
// (#ldsp-panel / #ldsp-panel.light in ldstatuspro.user.js) so the panel
// shares its exact dark/light color design.
const PALETTES = {
  light: {
    // surfaces
    bg: "rgba(250,251,254,0.97)",
    bgCard: "rgba(245,247,252,0.94)",
    bgHover: "rgba(238,242,250,0.96)",
    bgEl: "rgba(255,255,255,0.94)",
    // text
    fg: "#1e2030",
    fgSec: "#4a5068",
    fgMut: "#8590a6",
    // accents
    accent: "#5070d0",
    accentLight: "#6b8cef",
    accent2: "#4a9e8f",
    accent2Light: "#5bb5a6",
    accent3: "#d45d6e",
    // status
    ok: "#4a9e8f",
    okLight: "#5bb5a6",
    okBg: "rgba(74,158,143,0.08)",
    warn: "#c49339",
    warnBg: "rgba(196,147,57,0.08)",
    danger: "#d45d6e",
    errLight: "#e07a8d",
    errBg: "rgba(212,93,110,0.08)",
    // borders
    border: "rgba(0,0,0,0.08)",
    borderStrong: "rgba(0,0,0,0.1)",
    borderAccent: "rgba(80,112,208,0.2)",
    scrollbar: "rgba(15,23,42,0.18)",
    scrollbarHover: "rgba(15,23,42,0.34)",
    shadow: "0 20px 48px rgba(30,41,80,0.16)",
    glow: "0 0 0 1px rgba(80,112,208,0.22), 0 20px 48px rgba(30,41,80,0.18)",
  },
  dark: {
    // surfaces
    bg: "#12131a",
    bgCard: "rgba(24,26,36,0.92)",
    bgHover: "rgba(38,42,56,0.95)",
    bgEl: "rgba(32,35,48,0.88)",
    // text
    fg: "#e4e6ed",
    fgSec: "#9499ad",
    fgMut: "#5d6275",
    // accents
    accent: "#6b8cef",
    accentLight: "#8aa4f4",
    accent2: "#5bb5a6",
    accent2Light: "#7cc9bc",
    accent3: "#e07a8d",
    // status
    ok: "#5bb5a6",
    okLight: "#7cc9bc",
    okBg: "rgba(91,181,166,0.12)",
    warn: "#d4a853",
    warnBg: "rgba(212,168,83,0.12)",
    danger: "#e07a8d",
    errLight: "#ea9aa8",
    errBg: "rgba(224,122,141,0.12)",
    // borders
    border: "rgba(255,255,255,0.06)",
    borderStrong: "rgba(255,255,255,0.1)",
    borderAccent: "rgba(107,140,239,0.3)",
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
