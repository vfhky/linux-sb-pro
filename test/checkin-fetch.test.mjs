import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCheckinIO } from "../lib/checkin-fetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");

function stubHttp(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async getHtml(url) {
      calls.push(["get", url]);
      return responses[i++] || "";
    },
    async fetch(url, opts) {
      calls.push(["post", url, opts]);
      return { ok: true, status: 200, text: async () => responses[i++] || "" };
    },
  };
}

export default async function run() {
  // --- fetchStatus: parses html into structured result ---
  {
    const http = stubHttp([fx("daily-checkin-pending.html")]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const out = await io.fetchStatus();
    assert.equal(out.status, "not-signed-in");
    assert.equal(out.csrf, "test-csrf-token");
    assert.equal(out.hasForm, true);
    assert.equal(http.calls[0][1], "https://linux.sb/daily_checkin");
  }
  // --- submit: GET csrf -> POST -> GET verify ---
  {
    const http = stubHttp([
      fx("daily-checkin-pending.html"),  // 1st: GET csrf
      fx("daily-checkin-done.html"),     // 2nd: POST response (unused body)
      fx("daily-checkin-done.html"),     // 3rd: GET verify status
    ]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const r = await io.submit();
    assert.equal(r.status, "signed-in");
    assert.equal(r.action, "signed-in");
    assert.equal(http.calls.length, 3);
    assert.equal(http.calls[0][0], "get");
    assert.equal(http.calls[1][0], "post");
    const body = http.calls[1][2].body;
    assert.match(body, /_csrf=test-csrf-token/);
    assert.equal(http.calls[2][0], "get");
  }
  // --- submit when no csrf available ---
  {
    const http = stubHttp([fx("user-card-visitor.html")]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const r = await io.submit();
    assert.equal(r.status, "unknown");
    assert.match(r.reason, /no-csrf/);
    assert.equal(http.calls.length, 1); // no POST fired
  }
  // --- submit when already signed-in (no-op) ---
  {
    const http = stubHttp([fx("daily-checkin-done.html")]);
    const io = createCheckinIO({ http, base: "https://linux.sb" });
    const r = await io.submit();
    assert.equal(r.status, "signed-in");
    assert.equal(r.action, "none");
    assert.equal(http.calls.length, 1); // no POST fired
  }
}
