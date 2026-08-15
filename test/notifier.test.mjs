import assert from "node:assert/strict";
import { createNotifier } from "../lib/notifier.mjs";

function memStore() {
  const m = new Map();
  return {
    get: (k) => m.has(k) ? m.get(k) : null,
    set: (k, v) => m.set(k, v),
    map: m,
  };
}

export default async function run() {
  // milestone fires once, then dedupes forever
  {
    const store = memStore();
    let notified = [];
    const n = createNotifier({ storage: store, notify: (t, x) => notified.push([t, x]), now: () => 1_000_000 });
    const fresh1 = n.check({ streak: 7, total: 100, points: 150 });
    assert.equal(fresh1.length, 3); // streak:7, total:100, points:100
    assert.equal(notified.length, 1);
    // same values again → no new milestones
    const fresh2 = n.check({ streak: 7, total: 100, points: 150 });
    assert.equal(fresh2.length, 0);
    assert.equal(notified.length, 1);
    // higher value crossing a NEW threshold still reports the new one only
    const fresh3 = n.check({ streak: 30, total: 100, points: 150 });
    assert.equal(fresh3.length, 1);
    assert.equal(fresh3[0].key, "streak");
    assert.equal(fresh3[0].threshold, 30);
  }
  // 60s rate limit suppresses the notify call but still records achievements
  {
    const store = memStore();
    const notifies = [];
    let t = 1_000_000; // large base so the first call passes the rate window
    const n = createNotifier({ storage: store, notify: (title, text) => notifies.push(text), now: () => t });
    n.check({ streak: 7 });                      // notify 1
    assert.equal(notifies.length, 1);
    t = 1_030_000; n.check({ total: 100 });      // +30s → recorded, not notified
    assert.equal(notifies.length, 1);
    t = 1_061_000; n.check({ points: 100 });     // +61s → rate window passed → notify
    assert.equal(notifies.length, 2);
  }
  // guards: null report / missing fields / invalid numbers
  {
    const store = memStore();
    const n = createNotifier({ storage: store });
    assert.deepEqual(n.check(null), []);
    assert.deepEqual(n.check({}), []);
    assert.deepEqual(n.check({ streak: "nope", total: NaN, points: -1 }), []);
    assert.deepEqual(n.check({ points: 99 }), []);   // below first threshold
  }
}