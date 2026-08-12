#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, DEFAULT_ITEMS } from "../lib/build-fixture.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fxDir = join(__dirname, "..", "test", "fixtures");
mkdirSync(fxDir, { recursive: true });

const variants = [
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
for (const [name, body] of variants) {
  writeFileSync(join(fxDir, name), body, "utf8");
  console.log("wrote", name);
}
