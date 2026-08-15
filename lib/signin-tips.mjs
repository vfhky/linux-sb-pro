// lib/signin-tips.mjs
// Top-of-page "you haven't signed in today" reminder bar, shown only while
// the auto-signin toggle is OFF. Pattern borrowed from Nodeseek Pro's
// signinTips (verified source: docs/superpowers/specs/2026-08-13-nodeseek-pro-analysis.md §3):
// date-level dedupe via an "ignore today" marker + one-click sign-in.
// Pure factory — storage / signin API / toast / document are injected.

export function todayKey(now) {
  const d = now instanceof Date ? now : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export function createSigninTips({
  storage,          // { get(name), set(name, value, ttlMs) }
  signin,           // { getAutoSignin(), getStatus(), performSignin() }
  user,             // { info } — sync view of the logged-in user
  toast = null,     // { show(message, opts) } (optional)
  document: doc = (typeof document !== "undefined" ? document : null),
  today = todayKey,
  strings = { text: "今天还没签到，记得去签到哦～", signin: "立即签到", later: "今天不提示" },
} = {}) {
  let el = null;

  function isIgnoredToday() { return storage.get("signin.tips.ignoreDate") === today(); }
  function markIgnored() { storage.set("signin.tips.ignoreDate", today(), 0); }
  function remove() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  async function show() {
    remove();
    if (!doc || !doc.body) return false;
    if (!(user && user.info && user.info.id)) return false;   // guest
    if (signin.getAutoSignin()) return false;                 // auto on → no tip
    if (isIgnoredToday()) return false;                       // "今天不提示"
    let status = "unknown";
    try { status = (await signin.getStatus()).status; } catch (e) { /* keep unknown */ }
    if (status === "signed-in") return false;
    if (status !== "not-signed-in" && status !== "unknown") return false;

    el = doc.createElement("div");
    el.className = "lsb-tip";
    el.innerHTML =
      '<div class="lsb-tip-inner">' +
      '<span class="lsb-tip-text"></span>' +
      '<a class="lsb-tip-action" data-lsb-tip="signin" href="#"></a>' +
      '<a class="lsb-tip-action" data-lsb-tip="later" href="#"></a>' +
      "</div>";
    el.querySelector(".lsb-tip-text").textContent = strings.text;
    el.querySelector('[data-lsb-tip="signin"]').textContent = strings.signin;
    el.querySelector('[data-lsb-tip="later"]').textContent = strings.later;

    el.querySelector('[data-lsb-tip="signin"]').addEventListener("click", async (ev) => {
      ev.preventDefault();
      let r = null;
      try { r = await signin.performSignin(); } catch (e) { r = null; }
      if (toast && typeof toast.show === "function") {
        if (r && r.ok) {
          const days = (r.stats && r.stats.total) ? "，累计签到 " + r.stats.total + " 天" : "";
          toast.show("签到成功 ✓" + days, { type: "success" });
        } else {
          toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
        }
      }
      remove();
    });
    el.querySelector('[data-lsb-tip="later"]').addEventListener("click", (ev) => {
      ev.preventDefault();
      markIgnored();
      remove();
    });

    (doc.body || doc.documentElement).appendChild(el);
    return true;
  }

  return { show, remove, isIgnoredToday, markIgnored };
}
