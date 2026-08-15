// Theme palettes (design tokens) — the FULL verified LDStatus Pro token set
// (#ldsp-panel / #ldsp-panel.light in ldstatuspro.user.js) so the panel
// shares its exact dark/light color design.
const PALETTES = {
  light: {
    // surfaces — deep-space glass (panel stays dark & premium regardless of accent theme)
    bg: "rgba(13,16,28,0.97)",
    bgCard: "rgba(24,26,36,0.92)",
    bgHover: "rgba(38,42,56,0.95)",
    bgEl: "rgba(32,35,48,0.88)",
    // text
    fg: "#e4e6ed",
    fgSec: "#9499ad",
    fgMut: "#5d6275",
    // accents — brighter blue for the light option
    accent: "#7aa2ff",
    accentLight: "#9db8ff",
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
    borderAccent: "rgba(122,162,255,0.3)",
    scrollbar: "rgba(140,150,175,0.5)",
    scrollbarHover: "rgba(140,150,175,0.7)",
    shadow: "0 20px 48px rgba(0,0,0,0.4)",
    glow: "0 0 0 1px rgba(122,162,255,0.2), 0 20px 48px rgba(0,0,0,0.5)",
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
