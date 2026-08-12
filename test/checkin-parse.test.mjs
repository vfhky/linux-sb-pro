import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCheckinPage } from "../lib/checkin-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

export default async function run() {
  // --- Status detection: pending vs done ---
  {
    const out = parseCheckinPage(fx("daily-checkin-pending.html"));
    assert.equal(out.status, "not-signed-in", "pending fixture should yield not-signed-in");
    assert.equal(out.hasForm, true, "pending fixture should have a form");
    assert.equal(out.csrf, "test-csrf-token", "pending fixture csrf should match");
    assert.equal(out.stats.streak, 2);
    assert.equal(out.stats.total, 2);
  }
  {
    const out = parseCheckinPage(fx("daily-checkin-done.html"));
    assert.equal(out.status, "signed-in", "done fixture should yield signed-in");
    assert.equal(out.hasForm, false, "done fixture should NOT have a form");
    assert.equal(out.csrf, null, "done fixture has no csrf");
    assert.equal(out.stats.streak, 3);
    assert.equal(out.stats.total, 47);
  }

  // --- Edge: empty / malformed ---
  {
    const out = parseCheckinPage("");
    assert.equal(out.status, "unknown");
    assert.equal(out.hasForm, false);
    assert.equal(out.csrf, null);
  }
  {
    const out = parseCheckinPage(null);
    assert.equal(out.status, "unknown");
  }
  {
    const out = parseCheckinPage("<html>no card here</html>");
    assert.equal(out.status, "unknown");
  }

  // --- Legacy fallback: detect by button text + form csrf ---
  {
    const html = `<form action="/daily_checkin" method="post">
      <input name="_csrf" value="legacy-csrf">
      <button type="submit">立即签到</button>
    </form>`;
    const out = parseCheckinPage(html);
    assert.equal(out.status, "not-signed-in");
    assert.equal(out.csrf, "legacy-csrf");
  }

  // --- Edge: form with done button (button text 含 "已签到") ---
  {
    const html = `<form action="/daily_checkin" method="post">
      <input name="_csrf" value="abc">
      <button type="submit">已签到</button>
    </form>`;
    const out = parseCheckinPage(html);
    assert.equal(out.status, "signed-in");
  }

  // --- Regression: real /daily_checkin page (live capture, 2026-08-13) ---
  // Bug: _fetchStatus() used hardcoded ".daily-checkin-sub" which does not
  // exist on the dedicated checkin page; the real status element is
  // ".admin-plugin-summary > span". This test pins the real-page behavior
  // so a future regression on the parser is caught.
  {
    const out = parseCheckinPage(fx("daily-checkin-done-real.html"));
    assert.equal(out.status, "signed-in", "real /daily_checkin page should parse as signed-in");
    assert.equal(out.hasForm, false, "signed-in real page should not have a form");
    assert.equal(out.csrf, null, "signed-in real page should not have csrf");
    assert.equal(out.stats.streak, 4, "real page streak is 4");
  }

}
