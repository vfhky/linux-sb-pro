import assert from "node:assert/strict";
import { formatRelativeTime } from "../lib/time-format.mjs";

const NOW = Date.parse("2026-08-15T12:00:00+08:00");

export default async function run() {
  assert.equal(formatRelativeTime(null, NOW), "");
  assert.equal(formatRelativeTime("", NOW), "");
  assert.equal(formatRelativeTime(NOW, NOW), "刚刚");
  assert.equal(formatRelativeTime(NOW - 5 * 1000, NOW), "刚刚");
  assert.equal(formatRelativeTime(NOW - 3 * 60 * 1000, NOW), "3 分钟前");
  assert.equal(formatRelativeTime(NOW - 2 * 3600 * 1000, NOW), "2 小时前");
  assert.equal(formatRelativeTime(NOW - 4 * 86400 * 1000, NOW), "4 天前");
  assert.equal(formatRelativeTime(NOW - 9 * 86400 * 1000, NOW), "2026-08-06");
  // future timestamps clamp to 刚刚
  assert.equal(formatRelativeTime(NOW + 3600 * 1000, NOW), "刚刚");
  // unparseable input falls back to the raw string
  assert.equal(formatRelativeTime("not-a-date", NOW), "not-a-date");
}
