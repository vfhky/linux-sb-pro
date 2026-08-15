// Multi-tab leader election (localStorage heartbeat + takeover + release).
// Only the leader tab runs pollers, so N open tabs on the same origin do
// not duplicate network requests.
//
// Design borrowed from LDStatus Pro (verified against its source): every tab
// writes a heartbeat { tabId, ts } under one key; a tab becomes leader when
// the stored entry is stale (timeoutMs) or is its own id. beforeunload
// releases the entry so takeover is instant; storage events + the heartbeat
// timer keep the rest in sync.
//
// Pure: the storage adapter and event listeners are injected so tests can
// simulate multiple tabs with a shared Map-backed stub.

export function createTabLeader(opts = {}) {
  const {
    storage,
    key = "lsb:tab-leader",
    heartbeatMs = 5000,
    timeoutMs = 10000,
    tabId = null,
    now = Date.now,
    addEventListener = null,
    removeEventListener = null,
  } = opts;
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function" || typeof storage.remove !== "function") {
    throw new Error("tab-leader: storage adapter with get/set/remove required");
  }

  const id = tabId || (Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
  let isLeaderFlag = false;
  let heartbeatTimer = null;
  let storageHandler = null;
  let unloadHandler = null;
  const listeners = new Set();

  function emit(change) {
    for (const fn of listeners) {
      try { fn(change); } catch (e) { /* ignore listener errors */ }
    }
  }

  function read() {
    try {
      const raw = storage.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function write(entry) { try { storage.set(key, JSON.stringify(entry)); } catch { /* quota/private mode */ } }

  function tryBecomeLeader() {
    const stored = read();
    const expired = !stored || !stored.ts || (now() - stored.ts) > timeoutMs;
    const mine = stored && stored.tabId === id;
    if (expired || mine) {
      write({ tabId: id, ts: now() });
      // Verify after write: a simultaneous writer may have won the race.
      const after = read();
      if (!after || after.tabId === id) {
        if (!isLeaderFlag) { isLeaderFlag = true; emit({ isLeader: true, tabId: id }); }
        return;
      }
    }
    if (isLeaderFlag) { isLeaderFlag = false; emit({ isLeader: false, tabId: id }); }
  }

  function release() {
    const stored = read();
    if (isLeaderFlag && stored && stored.tabId === id) {
      try { storage.remove(key); } catch { /* ignore */ }
      isLeaderFlag = false;
    }
  }

  return {
    get tabId() { return id; },
    isLeader() { return isLeaderFlag; },
    start() {
      tryBecomeLeader();
      if (!heartbeatTimer) heartbeatTimer = setInterval(tryBecomeLeader, heartbeatMs);
      if (addEventListener && !storageHandler) {
        storageHandler = (e) => { if (!e || e.key === key || e.key === null) tryBecomeLeader(); };
        addEventListener("storage", storageHandler);
        unloadHandler = () => release();
        addEventListener("beforeunload", unloadHandler);
      }
      return this;
    },
    stop() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (removeEventListener) {
        if (storageHandler) removeEventListener("storage", storageHandler);
        if (unloadHandler) removeEventListener("beforeunload", unloadHandler);
      }
      storageHandler = null;
      unloadHandler = null;
      return this;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
