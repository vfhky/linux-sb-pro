import assert from "node:assert/strict";
import { parseHTML, Event } from "linkedom";
import { createSigninTips, todayKey } from "../lib/signin-tips.mjs";

function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { get: (k) => m.has(k) ? m.get(k) : null, set: (k, v) => m.set(k, v), map: m };
}
function makeDoc() { return parseHTML("<!doctype html><html><body></body></html>").document; }

export default async function run() {
  const TODAY = todayKey(new Date("2026-08-15T10:00:00+08:00"));

  // todayKey format
  assert.equal(TODAY, "2026-08-15");
  assert.equal(todayKey(new Date("2026-01-05T00:00:00Z")), "2026-01-05");

  const base = (over = {}) => {
    const storage = over.storage || memStore();
    const signin = over.signin || {
      getAutoSignin: () => false,
      getStatus: async () => ({ status: "not-signed-in" }),
      performSignin: async () => ({ ok: true, status: "signed-in", stats: { total: 12 } }),
    };
    const user = over.user || { info: { id: 1, nickname: "myss" } };
    const toast = over.toast || { show: () => {} };
    return createSigninTips({
      storage, signin, user, toast,
      document: over.document || makeDoc(),
      today: () => TODAY,
    });
  };

  // guest → no tip
  {
    const tips = base({ user: { info: null } });
    assert.equal(await tips.show(), false);
  }
  // auto-signin ON → no tip
  {
    const tips = base({ signin: { getAutoSignin: () => true, getStatus: async () => ({ status: "not-signed-in" }) } });
    assert.equal(await tips.show(), false);
  }
  // already ignored today → no tip
  {
    const storage = memStore({ "signin.tips.ignoreDate": TODAY });
    const tips = base({ storage });
    assert.equal(await tips.show(), false);
    assert.equal(tips.isIgnoredToday(), true);
  }
  // already signed in → no tip
  {
    const tips = base({ signin: { getAutoSignin: () => false, getStatus: async () => ({ status: "signed-in" }) } });
    assert.equal(await tips.show(), false);
  }
  // pending → tip rendered with two actions
  {
    const tips = base();
    const shown = await tips.show();
    assert.equal(shown, true);
    const doc = makeDoc();
    // show() appended to the injected doc
  }
  // pending renders into the injected document
  {
    const doc = makeDoc();
    const tips = base({ document: doc });
    assert.equal(await tips.show(), true);
    const bar = doc.querySelector(".lsb-tip");
    assert.ok(bar, "tip bar should exist");
    assert.equal(bar.querySelector(".lsb-tip-text").textContent, "今天还没签到，记得去签到哦～");
    assert.equal(bar.querySelector('[data-lsb-tip="signin"]').textContent, "立即签到");
    assert.equal(bar.querySelector('[data-lsb-tip="later"]').textContent, "今天不提示");
  }
  // click "今天不提示" → marks ignore + removes
  {
    const doc = makeDoc();
    const storage = memStore();
    const tips = base({ document: doc, storage });
    await tips.show();
    doc.querySelector('[data-lsb-tip="later"]').dispatchEvent(new Event("click", { cancelable: true }));
    assert.equal(storage.get("signin.tips.ignoreDate"), TODAY);
    assert.equal(doc.querySelector(".lsb-tip"), null, "tip removed after ignore");
    assert.equal(tips.isIgnoredToday(), true);
  }
  // click "立即签到" → performSignin called + toast success + removed
  {
    const doc = makeDoc();
    let performed = 0;
    let toastMsg = null;
    const tips = base({
      document: doc,
      signin: { getAutoSignin: () => false, getStatus: async () => ({ status: "not-signed-in" }), performSignin: async () => { performed++; return { ok: true, status: "signed-in", stats: { total: 12 } }; } },
      toast: { show: (msg) => { toastMsg = msg; } },
    });
    await tips.show();
    doc.querySelector('[data-lsb-tip="signin"]').dispatchEvent(new Event("click", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(performed, 1);
    assert.match(toastMsg, /签到成功/);
    assert.equal(doc.querySelector(".lsb-tip"), null, "tip removed after signin");
  }
}