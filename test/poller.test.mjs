import assert from "node:assert/strict";
import { makePoller } from "../core/poller.mjs";

export default async function run() {
  // Public surface
  const p = makePoller({
    name: "t",
    intervalMs: 100,
    backoffAfter: 2,
    backoffMs: 500,
    onTick: async () => {},
    document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
  });
  assert.equal(typeof p.start, "function");
  assert.equal(typeof p.stop, "function");
  assert.equal(typeof p.tick, "function");
  assert.equal(p.state, "stopped");

  // Validation
  assert.throws(() => makePoller({ name: "x" }), /onTick/);
  assert.throws(() => makePoller({ name: "x", onTick: "nope" }), /onTick/);
  assert.throws(() => makePoller({ name: "x", onTick: () => {}, intervalMs: 0 }), /intervalMs/);
  assert.throws(() => makePoller({ onTick: () => {} }), /name/);

  // Leader gate: a non-leader tab never ticks; the leader does.
  {
    let calls = 0;
    const p = makePoller({
      name: "gated-off",
      intervalMs: 30,
      onTick: async () => { calls++; },
      leader: { isLeader: () => false },
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
    });
    p.start();
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(calls, 0, "non-leader tab must never tick");
    p.stop();
  }
  {
    let calls = 0;
    const p = makePoller({
      name: "gated-on",
      intervalMs: 30,
      onTick: async () => { calls++; },
      leader: { isLeader: () => true },
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
    });
    p.start();
    await new Promise((r) => setTimeout(r, 90));
    assert.ok(calls >= 1, "leader tab must tick");
    p.stop();
  }
}
