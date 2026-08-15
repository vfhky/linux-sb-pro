// lib/history-store.mjs
// Local browsing history for tracked pages (topics / user profiles).
// Pattern borrowed from Nodeseek Pro's history feature (see
// docs/superpowers/specs/2026-08-13-nodeseek-pro-analysis.md) — kept pure
// so tests can stub storage and the clock. The cap keeps GM storage bounded.

export const DEFAULT_CAP = 50;

/** Only pages worth remembering: topic threads and user profiles. */
export function isTrackableUrl(url) {
  try {
    const u = new URL(url, "https://linux.sb");
    return /^\/?\/?(?:topic|t|discussion|user)\//.test(u.pathname.replace(/^\/+/, "/"));
  } catch {
    return false;
  }
}

export function createHistoryStore({
  storage,               // { get(name), set(name, value, ttlMs) }
  now = Date.now,
  cap = DEFAULT_CAP,
  trackable = isTrackableUrl,
} = {}) {
  function list() {
    const arr = storage.get("history.entries");
    return Array.isArray(arr) ? arr : [];
  }

  /** Record a visit; returns the new list (newest first, deduped by URL). */
  function record(url, title) {
    if (!url || !trackable(url)) return list();
    const next = [{ url, title: title || "", ts: now() }, ...list().filter((e) => e.url !== url)].slice(0, cap);
    storage.set("history.entries", next, 0);
    return next;
  }

  function clear() {
    storage.set("history.entries", [], 0);
  }

  return { list, record, clear };
}
