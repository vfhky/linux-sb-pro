import assert from "node:assert/strict";
import { createSectionRegistry } from "../core/dom-sections.mjs";

export default async function run() {
  const reg = createSectionRegistry();
  assert.equal(reg.render().innerHTML, "");

  reg.register("notif",  { order: 0,  render: () => ({ innerHTML: "<div>notif</div>" }) });
  reg.register("signin", { order: 10, render: () => ({ innerHTML: "<div>signin</div>" }) });

  const out = reg.render();
  assert.match(out.innerHTML, /notif/);
  assert.match(out.innerHTML, /signin/);
  assert.ok(out.innerHTML.indexOf("notif") < out.innerHTML.indexOf("signin"));

  reg.unregister("notif");
  assert.doesNotMatch(reg.render().innerHTML, /notif/);
}
