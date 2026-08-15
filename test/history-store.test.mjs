import assert from "node:assert/strict";
import { createHistoryStore, isTrackableUrl } from "../lib/history-store.mjs";

function memStore() {
  const m = new Map();
  return { get: (k) => m.has(k) ? m.get(k) : null, set: (k, v) => m.set(k, v), map: m };
}

export default async function run() {
  // isTrackableUrl
  assert.equal(isTrackableUrl("https://linux.sb/topic/12525"), true);
  assert.equal(isTrackableUrl("https://linux.sb/user/16056"), true);
  assert.equal(isTrackableUrl("https://linux.sb/"), false);
  assert.equal(isTrackableUrl("https://linux.sb/notifications"), false);
  assert.equal(isTrackableUrl("https://example.com/topic/1"), true); // any host, path-based
  assert.equal(isTrackableUrl(""), false);
  assert.equal(isTrackableUrl("not a url"), false);

  // record appends newest-first, dedupes by URL
  {
    const store = memStore();
    const h = createHistoryStore({ storage: store, now: () => 1000 });
    h.record("https://linux.sb/topic/1", "T1");
    h.record("https://linux.sb/topic/2", "T2");
    const list = h.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].url, "https://linux.sb/topic/2");
    assert.equal(list[1].url, "https://linux.sb/topic/1");
    // re-visiting T1 moves it to the front, no duplicate
    h.record("https://linux.sb/topic/1", "T1 again");
    const again = h.list();
    assert.equal(again.length, 2);
    assert.equal(again[0].url, "https://linux.sb/topic/1");
    assert.equal(again[0].title, "T1 again");
  }
  // untrackable pages are ignored
  {
    const store = memStore();
    const h = createHistoryStore({ storage: store, now: () => 1 });
    h.record("https://linux.sb/", "Home");
    assert.equal(h.list().length, 0);
  }
  // cap bounds the list
  {
    const store = memStore();
    const h = createHistoryStore({ storage: store, now: () => Date.now(), cap: 3 });
    for (let i = 1; i <= 5; i++) h.record("https://linux.sb/topic/" + i, "T" + i);
    const list = h.list();
    assert.equal(list.length, 3);
    assert.equal(list[0].url, "https://linux.sb/topic/5");
    assert.equal(list[2].url, "https://linux.sb/topic/3");
  }
  // clear empties
  {
    const store = memStore();
    const h = createHistoryStore({ storage: store, now: () => 1 });
    h.record("https://linux.sb/topic/1", "T1");
    h.clear();
    assert.equal(h.list().length, 0);
  }
}
