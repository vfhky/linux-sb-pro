import assert from "node:assert/strict";
import { createRegistry } from "../core/settings.mjs";

export default async function run() {
  const reg = createRegistry();

  assert.deepEqual(reg.list(), []);

  reg.register({ key: "panel.pos",   type: "enum",    default: "BR",   group: "panel",  label: { zh: "位置", en: "Position" },  options: ["BR","BL","TR","TL"] });
  reg.register({ key: "panel.theme", type: "enum",    default: "auto", group: "panel",  label: { zh: "主题", en: "Theme" },     options: ["auto","light","dark"] });
  reg.register({ key: "signin.auto", type: "boolean", default: false, group: "signin", label: { zh: "自动签到", en: "Auto sign-in" } });

  const all = reg.list();
  assert.deepEqual(all.map((s) => s.key), ["panel.pos", "panel.theme", "signin.auto"]);
  assert.deepEqual(reg.groups(), ["panel", "signin"]);

  const pos = reg.get("panel.pos");
  assert.equal(pos.get(), "BR");
  pos.set("TL");
  assert.equal(pos.get(), "TL");
  assert.throws(() => pos.set("XX"), /panel.pos/);
  assert.throws(() => reg.get("nope"));

  let fired = 0;
  reg.on("change", () => fired++);
  pos.set("BR");
  assert.equal(fired, 1);

  let perKeyFired = 0;
  pos.subscribe(() => perKeyFired++);
  pos.set("BL");
  assert.equal(perKeyFired, 1);
}
