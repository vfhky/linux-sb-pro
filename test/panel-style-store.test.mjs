import assert from "node:assert/strict";
import { makeStore, validatePos, validateTheme } from "../lib/panel-style-store.mjs";

export default async function run() {
  assert.equal(validatePos("BR"), "BR");
  assert.equal(validatePos("garbage"), null);
  assert.equal(validateTheme("dark"), "dark");
  assert.equal(validateTheme("neon"), null);

  const mem = { kv: new Map() };
  const gm = { get: (k) => mem.kv.get(k) ?? null, set: (k, v) => mem.kv.set(k, v) };
  const s = makeStore(gm, "lsb:panel:");
  assert.equal(s.getPos(), "BR");
  assert.equal(s.getTheme(), "auto");
  s.setPos("TL");
  s.setTheme("dark");
  assert.equal(mem.kv.get("lsb:panel:pos"), "TL");
  assert.equal(mem.kv.get("lsb:panel:theme"), "dark");
  const s2 = makeStore(gm, "lsb:panel:");
  assert.equal(s2.getPos(), "TL");
  assert.equal(s2.getTheme(), "dark");

  mem.kv.set("lsb:panel:pos", "garbage");
  mem.kv.set("lsb:panel:theme", "neon");
  assert.equal(s2.getPos(), "BR");
  assert.equal(s2.getTheme(), "auto");

  assert.throws(() => s.setPos("XX"), /invalid pos/);
  assert.doesNotThrow(() => s.getPos());
}
