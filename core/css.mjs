// Generate CSS rules for the floating panel position + theme.  Keeping
// the rule emission in one place means adding a new position or theme
// is a single config edit; the public build is data-driven end to end.

export function panelPositionCss(positions) {
  const sides = ["top", "right", "bottom", "left"];
  return Object.entries(positions)
    .map(([pos, off]) => {
      const decls = sides.map((s) => `${s}:${off[s] != null ? off[s] + "px" : "auto"};`).join("");
      return `#lsb-panel[data-pos="${pos}"]{${decls}}`;
    })
    .join("\n");
}

export function panelThemeCss(palettes) {
  return Object.entries(palettes)
    .map(([name, p]) => {
      const decls = [
        `--lsb-bg:${p.bg}`,
        `--lsb-fg:${p.fg}`,
        `--lsb-border:${p.border || "transparent"}`,
        `--lsb-shadow:${p.shadow || "none"}`,
      ].join(";");
      return `#lsb-panel[data-theme="${name}"]{${decls};}`;
    })
    .join("\n");
}
