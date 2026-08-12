// Theme palettes.  Add a new theme here + a matching CSS rule and it
// works everywhere automatically.  "auto" is a meta-theme resolved by
// the ui module against prefers-color-scheme.
const PALETTES = {
  light: { bg: "#ffffff", fg: "#1f2937", border: "rgba(0,0,0,0.08)", shadow: "0 8px 24px rgba(0,0,0,0.12)" },
  dark:  { bg: "rgba(20,22,28,0.94)", fg: "#eee", border: "rgba(255,255,255,0.08)", shadow: "0 8px 24px rgba(0,0,0,0.35)" },
};

export const THEMES = ["light", "dark", "auto"];

export function listThemes() { return THEMES.slice(); }

export function getPalette(name) {
  if (name === "auto") throw new Error("palettes: auto is a meta-theme, resolve via ui");
  if (!PALETTES[name]) throw new Error("palettes: unknown theme " + name);
  return PALETTES[name];
}
