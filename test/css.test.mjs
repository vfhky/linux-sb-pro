import assert from "node:assert/strict";
import { panelPositionCss, panelThemeCss, PALETTE_TOKENS } from "../core/css.mjs";

export default async function run() {
  const css = panelPositionCss({ TL: { top: 12, left: 12 }, BR: { bottom: 12, right: 12 } });
  assert.match(css, /#lsb-panel\[data-pos="TL"\]/);
  assert.match(css, /top:12px/);
  assert.match(css, /#lsb-panel\[data-pos="BR"\]/);
  assert.match(css, /right:12px/);

  // PALETTE_TOKENS drives both theme CSS and runtime token application.
  assert.ok(Array.isArray(PALETTE_TOKENS) && PALETTE_TOKENS.length >= 10);
  assert.ok(PALETTE_TOKENS.some(([f, v]) => f === "accent" && v === "--lsb-accent"));
  assert.ok(PALETTE_TOKENS.some(([f, v]) => f === "scrollbar" && v === "--lsb-scrollbar"));

  const tcss = panelThemeCss({ light: { bg: "#fff", fg: "#000", accent: "#5070e0" }, dark: { bg: "#111", fg: "#eee", accent: "#6b8cff" } });
  assert.match(tcss, /#lsb-panel\[data-theme="light"\]/);
  assert.match(tcss, /--lsb-bg:#fff/);
  assert.match(tcss, /#lsb-panel\[data-theme="dark"\]/);
  assert.match(tcss, /--lsb-bg:#111/);
  // full token emission
  assert.match(tcss, /--lsb-accent:#5070e0/);
  assert.match(tcss, /--lsb-accent:#6b8cff/);
}
