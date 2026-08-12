import assert from "node:assert/strict";
import { probeEndpoint } from "../lib/notif-probe.mjs";

export default async function run() {
  // First candidate that yields a recognizable page wins.  Function
  // short-circuits, so only one HTTP call.
  {
    const calls = [];
    const http = {
      async getHtml(url) {
        calls.push(url);
        return url.endsWith("/notifications") ? "<h1>通知</h1>" : "";
      },
    };
    const got = await probeEndpoint(http, "https://linux.sb", ["/notifications", "/notice"]);
    assert.equal(got, "https://linux.sb/notifications");
    assert.deepEqual(calls, ["https://linux.sb/notifications"]);
  }
  // All candidates probed when none match.
  {
    const calls = [];
    const http = { async getHtml(url) { calls.push(url); return "<h1>无关</h1>"; } };
    assert.equal(await probeEndpoint(http, "https://linux.sb", ["/notifications", "/notice"]), null);
    assert.deepEqual(calls, ["https://linux.sb/notifications", "https://linux.sb/notice"]);
  }
  // Matcher recognises list-shaped class even without heading.
  {
    const http = { async getHtml() { return "<ul class=\"notif-list\"></ul>"; } };
    assert.equal(await probeEndpoint(http, "https://x", ["/notice"]), "https://x/notice");
  }
  // Empty candidates -> null, no http calls.
  {
    const http = { async getHtml() { throw new Error("should not be called"); } };
    assert.equal(await probeEndpoint(http, "https://x", []), null);
  }
  // Trailing slashes on apiBase are stripped.
  {
    const http = { async getHtml() { return "<h1>通知</h1>"; } };
    assert.equal(await probeEndpoint(http, "https://x/", ["/n"]), "https://x/n");
  }
}
