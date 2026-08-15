import assert from "node:assert/strict";
import { createTabLeader } from "../lib/tab-leader.mjs";

// Simulate multiple tabs sharing one origin: a shared Map as localStorage,
// with storage events delivered to OTHER tabs synchronously.
function fakeOrigin() {
  const map = new Map();
  const tabs = [];
  function createTab() {
    const events = new Map(); // type -> fn[]
    const tab = {
      get: (k) => (map.has(k) ? map.get(k) : null),
      set: (k, v) => {
        map.set(k, v);
        for (const t of tabs) if (t !== tab) t.emit("storage", { key: k });
      },
      remove: (k) => {
        map.delete(k);
        for (const t of tabs) if (t !== tab) t.emit("storage", { key: k });
      },
      emit(type, e) { (events.get(type) || []).forEach((fn) => fn(e)); },
      fire(type, e) { this.emit(type, e); },
      addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
      removeEventListener(type, fn) { const a = events.get(type) || []; events.set(type, a.filter((f) => f !== fn)); },
    };
    tabs.push(tab);
    return tab;
  }
  return { createTab };
}

// Build a leader bound to a specific fake tab (with its event listeners).
function leaderFor(tab, extra = {}) {
  return createTabLeader({
    storage: tab,
    addEventListener: (t, fn) => tab.addEventListener(t, fn),
    removeEventListener: (t, fn) => tab.removeEventListener(t, fn),
    ...extra,
  });
}

export default async function run() {
  // 1) first tab becomes leader immediately
  {
    const o = fakeOrigin();
    const la = leaderFor(o.createTab(), { tabId: "A", now: () => 1000 }).start();
    assert.equal(la.isLeader(), true, "first tab must lead");
    assert.equal(la.tabId, "A");
  }

  // 2) second tab sees a fresh heartbeat -> not leader
  {
    const o = fakeOrigin();
    const la = leaderFor(o.createTab(), { tabId: "A", now: () => 1000 }).start();
    const lb = leaderFor(o.createTab(), { tabId: "B", now: () => 1100 }).start();
    assert.equal(la.isLeader(), true);
    assert.equal(lb.isLeader(), false, "fresh leader heartbeat must block takeover");
  }

  // 3) leader releases on beforeunload -> follower takes over via storage event
  {
    const o = fakeOrigin();
    const a = o.createTab(), b = o.createTab();
    const la = leaderFor(a, { tabId: "A", now: () => 2000 }).start();
    const lb = leaderFor(b, { tabId: "B", now: () => 2000 }).start();
    assert.equal(la.isLeader(), true);
    assert.equal(lb.isLeader(), false);
    a.fire("beforeunload", null); // release
    assert.equal(la.isLeader(), false, "released leader must step down");
    assert.equal(lb.isLeader(), true, "follower must take over after leader release");
  }

  // 4) stale heartbeat -> takeover (timeout)
  {
    const o = fakeOrigin();
    const old = o.createTab();
    old.set("lsb:tab-leader", JSON.stringify({ tabId: "OLD", ts: 5000 }));
    const c = o.createTab();
    const lc = leaderFor(c, { tabId: "C", now: () => 20000, timeoutMs: 10000 }).start();
    assert.equal(lc.isLeader(), true, "stale leader entry must be taken over");
  }

  // 5) leader:change events emitted
  {
    const o = fakeOrigin();
    const t = o.createTab();
    const events = [];
    const l = leaderFor(t, { tabId: "X", now: () => 0 });
    l.on((e) => events.push(e));
    l.start();
    assert.equal(l.isLeader(), true);
    assert.ok(events.some((e) => e.isLeader === true && e.tabId === "X"), "leader:change event must fire");
  }

  // 6) validation: storage adapter required
  assert.throws(() => createTabLeader({}), /storage adapter/);
  assert.throws(() => createTabLeader({ storage: { get: () => null } }), /storage adapter/);
}
