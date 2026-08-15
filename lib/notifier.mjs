// lib/notifier.mjs
// Milestone achievement notifications. Pattern borrowed from LDStatus Pro's
// Notifier (verified source: docs/superpowers/specs/2026-08-13-ldstatuspro-analysis.md §3):
// each milestone fires once (persisted "achieved" map) with a 60s rate limit.
// Pure factory — notify() is injected (the module wires GM_notification).
export const DEFAULT_MILESTONES = {
  streak: [7, 30, 100, 365],      // 连续签到 N 天
  total: [100, 365, 1000],        // 累计签到 N 天
  points: [100, 500, 1000, 5000], // 积分达到 N
};

export function createNotifier({
  storage,                       // { get(name), set(name, value, ttlMs) }
  notify = () => {},             // (title, text) — module injects GM_notification
  milestones = DEFAULT_MILESTONES,
  now = Date.now,
  rateLimitMs = 60_000,
} = {}) {
  let lastNotifyAt = 0;
  const LABELS = { streak: "连续签到", total: "累计签到", points: "积分" };

  function check(report) {
    if (!report) return [];
    const achieved = storage.get("notif.milestones") || {};
    const fresh = [];
    for (const [key, thresholds] of Object.entries(milestones)) {
      const value = report[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      for (const t of thresholds) {
        const k = key + ":" + t;
        if (value >= t && !achieved[k]) {
          achieved[k] = true;
          fresh.push({ key, threshold: t, value });
        }
      }
    }
    if (!fresh.length) return [];
    storage.set("notif.milestones", achieved, 0);
    if (now() - lastNotifyAt >= rateLimitMs) {
      lastNotifyAt = now();
      const lines = fresh.slice(0, 3).map((m) =>
        "🏆 " + (LABELS[m.key] || m.key) + " " + m.threshold + (m.key === "points" ? "" : " 天")
      );
      notify("🎉 达成里程碑！", lines.join("\n"));
    }
    return fresh;
  }

  return { check };
}
