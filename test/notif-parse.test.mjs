import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseNotifications, MAX_LIST } from "../lib/notif-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

export default async function run() {
  // Full fixture -> unread, list with mention flag.
  {
    const out = parseNotifications(fx("notif-page.html"));
    assert.equal(out.unread, 3);
    assert.equal(out.list.length, 3);
    assert.equal(out.list[0].id, "1");
    assert.equal(out.list[0].isMention, true);
    assert.match(out.list[0].url, /\/topic\/100/);
    assert.match(out.list[0].title, /@vfhky/);
    assert.equal(out.list[1].isMention, false);
  }
  // Empty fixture -> 0 / [].
  {
    const out = parseNotifications(fx("notifications-empty.html"));
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // Malformed -> 0 / [], no throw.
  {
    const out = parseNotifications(fx("notifications-malformed.html"));
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // Overflow -> unread reports true count, list capped at MAX_LIST.
  {
    const out = parseNotifications(fx("notifications-many.html"));
    assert.equal(out.unread, 8);
    assert.equal(out.list.length, MAX_LIST);
    assert.equal(MAX_LIST, 5);
  }
  // Non-string input -> empty result, no throw.
  {
    assert.deepEqual(parseNotifications(null), { unread: 0, list: [] });
    assert.deepEqual(parseNotifications(undefined), { unread: 0, list: [] });
    assert.deepEqual(parseNotifications(""), { unread: 0, list: [] });
  }
}
