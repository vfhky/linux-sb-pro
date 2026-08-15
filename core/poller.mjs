// Generic poller: tick at a fixed interval while the document is visible,
// with an optional backoff after N consecutive errors.  Inject the
// `document` object so tests can run without a real DOM.  An optional
// `leader` gate ({ isLeader() }) makes only the leader tab tick, which
// pairs with lib/tab-leader.mjs for multi-tab coordination.
export function makePoller({ name, onTick, intervalMs = 60_000, backoffAfter = 3, backoffMs = 5 * 60_000, leader = null, document: doc = (typeof document !== "undefined" ? document : null) } = {}) {
  if (typeof onTick !== "function") throw new Error("makePoller: onTick must be a function");
  if (!(intervalMs > 0)) throw new Error("makePoller: intervalMs must be > 0");
  if (!name) throw new Error("makePoller: name required");

  const poller = {
    name,
    state: "stopped",
    start, stop, tick,
    get currentInterval() { return backoffUntil > Date.now() ? backoffMs : intervalMs; },
  };

  let timer = null;
  let errors = 0;
  let backoffUntil = 0;
  let runningTick = false;
  let visibilityHandler = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runOnce, poller.currentInterval);
  }

  async function runOnce() {
    if (poller.state !== "running") return;
    if (doc && doc.hidden) { schedule(); return; }
    // Multi-tab gate: only the leader tab ticks; followers just reschedule.
    if (leader && typeof leader.isLeader === "function" && !leader.isLeader()) { schedule(); return; }
    if (runningTick) { schedule(); return; }
    runningTick = true;
    try {
      await onTick();
      errors = 0;
      backoffUntil = 0;
    } catch (err) {
      errors++;
      if (errors >= backoffAfter) backoffUntil = Date.now() + backoffMs;
      if (typeof console !== "undefined") console.warn(`[${name}] tick failed (${errors})`, err);
    } finally {
      runningTick = false;
      schedule();
    }
  }

  function start() {
    if (poller.state === "running") return;
    poller.state = "running";
    if (doc && doc.addEventListener) {
      visibilityHandler = () => { if (!doc.hidden) runOnce(); };
      doc.addEventListener("visibilitychange", visibilityHandler);
    }
    runOnce();
  }

  function stop() {
    if (poller.state === "stopped") return;
    poller.state = "stopped";
    if (timer) { clearTimeout(timer); timer = null; }
    if (doc && doc.removeEventListener && visibilityHandler) {
      doc.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
  }

  async function tick() { await runOnce(); }

  return poller;
}
