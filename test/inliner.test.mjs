import assert from "node:assert/strict";
import { bundle, listLibFiles } from "../core/inliner.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export default async function run() {
  const files = listLibFiles(join(root, "lib"));
  assert.ok(files.length >= 3);
  assert.ok(files.some((f) => f.endsWith("notif-probe.mjs")));
  assert.ok(files.some((f) => f.endsWith("notif-parse.mjs")));
  assert.ok(files.some((f) => f.endsWith("panel-style-store.mjs")));

  const out = bundle(files);
  assert.match(out, /function probeEndpoint/);
  assert.match(out, /function parseNotifications/);
  assert.match(out, /function makeStore/);
  assert.doesNotMatch(out, /\bexport\s+function/);
  assert.doesNotMatch(out, /\bexport\s+const/);

  const fn = new Function("GM_getValue", "GM_setValue", "GM_deleteValue",
    out + "\nreturn { probeEndpoint, parseNotifications, makeStore, MAX_LIST, DEFAULT_POS, DEFAULT_THEME, validatePos, validateTheme };");
  const exposed = fn(() => null, () => {}, () => {});
  assert.equal(typeof exposed.probeEndpoint, "function");
  assert.equal(typeof exposed.parseNotifications, "function");
  assert.equal(typeof exposed.makeStore, "function");
}
