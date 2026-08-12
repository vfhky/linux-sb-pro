import assert from "node:assert/strict";
import { panelPositionCss, panelThemeCss } from "../core/css.mjs";

export default async function run() {
  const css = panelPositionCss({ TL: { top: 12, left: 12 }, BR: { bottom: 12, right: 12 } });
  assert.match(css, /#lsb-panel\[data-pos="TL"\]/);
  assert.match(css, /top:12px/);
  assert.match(css, /#lsb-panel\[data-pos="BR"\]/);
  assert.match(css, /right:12px/);

  const tcss = panelThemeCss({ light: { bg: "#fff", fg: "#000" }, dark: { bg: "#111", fg: "#eee" } });
  assert.match(tcss, /#lsb-panel\[data-theme="light"\]/);
  assert.match(tcss, /--lsb-bg:#fff/);
  assert.match(tcss, /#lsb-panel\[data-theme="dark"\]/);
  assert.match(tcss, /--lsb-bg:#111/);
}
