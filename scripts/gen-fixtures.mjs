#!/usr/bin/env node
// Regenerate the synthetic HTML fixtures under test/fixtures/ from the
// programmatic builders in lib/build-fixture.mjs.  Real captured
// fixtures live in test/fixtures-real/ (gitignored) and are NOT touched
// by this script.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFixture,
  DEFAULT_ITEMS,
  dailyCheckinCard,
  dailyCheckinPage,
  userCard,
  notificationPage,
} from "../lib/build-fixture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fxDir = join(__dirname, "..", "test", "fixtures");
mkdirSync(fxDir, { recursive: true });

// Legacy notif fixtures (kept for back-compat tests)
const legacy = [
  ["notif-page.html",          buildFixture({ items: DEFAULT_ITEMS, unread: 3, mode: "list" })],
  ["notifications-empty.html", buildFixture({ mode: "empty" })],
  ["notifications-many.html",  buildFixture({
    items: Array.from({ length: 8 }, (_, i) => ({
      id: i + 1, mention: i % 2 === 0,
      href: `/topic/${100 + i}`, title: `item ${i + 1}`,
    })),
    unread: 8, mode: "list",
  })],
  ["notifications-malformed.html", buildFixture({ mode: "malformed" })],
];

// New site fixtures (1.1.3 era)
const current = [
  // Daily checkin page (status text in .admin-plugin-summary span)
  ["daily-checkin-pending.html",
    dailyCheckinPage({ status: "pending", stats: { streak: 2, total: 2 } })],
  ["daily-checkin-done.html",
    dailyCheckinPage({ status: "done", stats: { streak: 3, total: 47 } })],
  // User cards
  ["user-card-logged-in.html",
    userCard({ loggedIn: true, userId: 16056, nickname: "myss", rank: "笔友", points: 177 })],
  ["user-card-visitor.html",
    userCard({ loggedIn: false, nickname: "guest" })],
  // Notification page (3 items: mention, reply, system)
  ["user-notifications.html",
    notificationPage({ items: [
      { kind: "mention", actor: "vfhky", content: '<p>在主题《<a href="/topic/100">测试主题</a>》中提到你：<a href="/user?username=myss">@myss</a></p>', url: "/topic/100" },
      { kind: "reply",   actor: "alice", content: '<p>在主题《<a href="/topic/101">另一个主题</a>》中回复了你：好的</p>',         url: "/topic/101" },
      { kind: "system",  actor: "system", content: '<p>欢迎加入 linux.sb</p>',                                                url: "/topic/1" },
    ]})],
];

for (const [name, body] of [...legacy, ...current]) {
  writeFileSync(join(fxDir, name), body, "utf8");
  console.log("wrote", name, body.length, "bytes");
}
