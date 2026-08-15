// Generate CSS rules for the floating panel position + theme.  Keeping
// the rule emission in one place means adding a new position or theme
// is a single config edit; the public build is data-driven end to end.

// [palette field, CSS variable] — the full set of design tokens emitted per
// theme.  The ui module reuses this table to apply tokens at runtime.
export const PALETTE_TOKENS = [
  ["bg", "--lsb-bg"],
  ["bgCard", "--lsb-bg-card"],
  ["bgHover", "--lsb-bg-hover"],
  ["bgEl", "--lsb-bg-el"],
  ["fg", "--lsb-fg"],
  ["fgSec", "--lsb-fg-sec"],
  ["fgMut", "--lsb-fg-mut"],
  ["accent", "--lsb-accent"],
  ["accentLight", "--lsb-accent-light"],
  ["accent2", "--lsb-accent2"],
  ["accent2Light", "--lsb-accent2-light"],
  ["accent3", "--lsb-accent3"],
  ["ok", "--lsb-ok"],
  ["okLight", "--lsb-ok-light"],
  ["okBg", "--lsb-ok-bg"],
  ["warn", "--lsb-warn"],
  ["warnBg", "--lsb-warn-bg"],
  ["danger", "--lsb-danger"],
  ["errLight", "--lsb-err-light"],
  ["errBg", "--lsb-err-bg"],
  ["border", "--lsb-border"],
  ["borderStrong", "--lsb-border-strong"],
  ["borderAccent", "--lsb-border-accent"],
  ["scrollbar", "--lsb-scrollbar"],
  ["scrollbarHover", "--lsb-scrollbar-hover"],
  ["shadow", "--lsb-shadow"],
  ["glow", "--lsb-glow"],
];

export function panelPositionCss(positions) {
  const sides = ["top", "right", "bottom", "left"];
  return Object.entries(positions)
    .map(([pos, off]) => {
      const decls = sides.map((s) => s + ":" + (off[s] != null ? off[s] + "px" : "auto") + ";").join("");
      return "#lsb-panel[data-pos=\"" + pos + "\"]{" + decls + "}";
    })
    .join("\n");
}

export function panelThemeCss(palettes) {
  return Object.entries(palettes)
    .map(([name, p]) => {
      const decls = PALETTE_TOKENS
        .map(([field, cssVar]) => (p[field] != null ? cssVar + ":" + p[field] : null))
        .filter(Boolean)
        .join(";");
      return "#lsb-panel[data-theme=\"" + name + "\"]{" + decls + ";}";
    })
    .join("\n");
}
