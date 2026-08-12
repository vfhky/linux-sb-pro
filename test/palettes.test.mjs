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
  assert.throws(() => getPalette("auto"), /auto/);
}
