// I/O layer for the daily checkin flow. Takes an http adapter so tests
// can stub it. parseCheckinPage is the pure parser; this module wraps it
// with the fetch + submit dance.
import { parseCheckinPage } from "./checkin-parse.mjs";

export function createCheckinIO({ http, base }) {
  const URL = `${base}/daily_checkin`;

  async function fetchStatus() {
    const html = await http.getHtml(URL);
    return { ...parseCheckinPage(html), source: "http-fetch" };
  }

  async function submit() {
    const before = await fetchStatus();
    if (before.status === "signed-in") {
      return { ok: true, status: "signed-in", action: "none", source: "http-fetch", stats: before.stats };
    }
    if (!before.csrf) {
      return { ok: false, status: before.status, reason: "no-csrf-token", source: "http-fetch", stats: before.stats };
    }
    const body = new URLSearchParams({ _csrf: before.csrf }).toString();
    const res = await http.fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const after = await fetchStatus();
    return {
      ok: res.ok || after.status === "signed-in",
      status: after.status,
      action: "signed-in",
      source: "http-post",
      httpStatus: res.status,
      stats: after.stats,
    };
  }

  return { fetchStatus, submit, url: URL };
}
