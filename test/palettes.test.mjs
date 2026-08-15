import assert from "node:assert/strict";
import { getPalette, listThemes } from "../core/palettes.mjs";

export default async function run() {
  const themes = listThemes();
  assert.ok(themes.includes("light"));
  assert.ok(themes.includes("dark"));
  assert.ok(themes.includes("auto"));
  const light = getPalette("light");
  assert.equal(typeof light.bg, "string");
  assert.equal(typeof light.fg, "string");
  // design-token fields used by the upgraded UI
  assert.equal(typeof light.accent, "string");
  assert.equal(typeof light.bgCard, "string");
  assert.equal(typeof light.glow, "string");
  const dark = getPalette("dark");
  assert.equal(typeof dark.accent, "string");
  assert.equal(typeof dark.fgSec, "string");
  assert.equal(typeof dark.scrollbar, "string");
  assert.equal(typeof dark.scrollbarHover, "string");
  assert.throws(() => getPalette("auto"), /auto/);
}
