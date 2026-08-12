import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseNotifications, MAX_LIST } from "../lib/notif-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

export default async function run() {
  // --- New structure: li.post-item.notification-item ---
  {
    const out = parseNotifications(fx("user-notifications.html"));
    assert.ok(out.list.length >= 1, "should have at least one notification");
    assert.equal(out.unread, out.list.length);
    assert.equal(out.list[0].kind, "mention");
    assert.match(out.list[0].title, /@myss/);
  }
  // --- Empty new structure ---
  {
    const html = `<ul class="post-list"></ul>`;
    const out = parseNotifications(html);
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // --- Legacy shape: ul.notif-list with data-id / data-mention ---
  {
    const html = `<ul class="notif-list">
      <li data-id="1" data-mention="true"><a href="/topic/100">@vfhky hello</a></li>
    </ul>`;
    const out = parseNotifications(html);
    assert.equal(out.list.length, 1);
    assert.equal(out.list[0].id, "1");
    assert.equal(out.list[0].isMention, true);
    assert.match(out.list[0].url, /\/topic\/100/);
    assert.match(out.list[0].title, /@vfhky/);
  }
  // --- Legacy fixture: notif-page.html (3 items, unread 3) ---
  {
    const out = parseNotifications(fx("notif-page.html"));
    assert.equal(out.list.length, 3);
    assert.equal(out.unread, 3);
    assert.equal(out.list[0].id, "1");
    assert.equal(out.list[0].isMention, true);
  }
  // --- Legacy empty ---
  {
    const out = parseNotifications(fx("notifications-empty.html"));
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // --- Legacy malformed ---
  {
    const out = parseNotifications(fx("notifications-malformed.html"));
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  // --- Legacy overflow ---
  {
    const out = parseNotifications(fx("notifications-many.html"));
    assert.equal(out.unread, 8);
    assert.equal(out.list.length, MAX_LIST);
    assert.equal(MAX_LIST, 5);
  }
  // --- Empty / non-string input ---
  {
    const out = parseNotifications("");
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
  {
    const out = parseNotifications(null);
    assert.equal(out.unread, 0);
    assert.deepEqual(out.list, []);
  }
}
