// lib/time-format.mjs
// Relative-time Chinese formatting. Pattern borrowed from Nodeseek Pro's
// timeChinese (docs/superpowers/specs/2026-08-13-nodeseek-pro-analysis.md):
// "刚刚 / N 分钟前 / N 小时前 / N 天前", older timestamps fall back to a date.
// Pure function — ready for the notif/history features that carry timestamps.
export function formatRelativeTime(input, now) {
  if (input == null) return "";
  const ts = new Date(input).getTime();
  if (!Number.isFinite(ts)) return String(input);
  const base = now == null ? Date.now() : Number(now);
  const diff = Math.max(0, base - ts);
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  if (diff < MIN) return "刚刚";
  if (diff < HOUR) return Math.floor(diff / MIN) + " 分钟前";
  if (diff < DAY) return Math.floor(diff / HOUR) + " 小时前";
  if (diff < 7 * DAY) return Math.floor(diff / DAY) + " 天前";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
