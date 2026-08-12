// Parse a linux.sb daily checkin page (or sidebar card HTML) into a
// structured { status, csrf, hasForm, stats } object.
//
// Two layouts are supported:
//   1. Dedicated /daily_checkin page:
//      <div class="admin-plugin-summary"><strong>每日签到</strong><span>今天待签到</span></div>
//      <form class="post-action-form" action="/daily_checkin">
//        <input name="_csrf" value="...">
//        <button type="submit" class="daily-checkin-btn">签到</button>
//      </form>
//   2. Home sidebar card:
//      <div class="card sidebar-card daily-checkin-card">
//        <div class="daily-checkin-sub">今天待签到</div>
//        <form class="post-action-form" action="/daily_checkin">...</form>
//        (or, in done state, <div class="daily-checkin-done">已完成</div>)
//      </div>
//
// In both cases the parser is structure-agnostic: it looks for status
// text first, then csrf / form presence, then stats.

const STATUS_ZH = {
  "今天待签到": "not-signed-in",
  "今天已签到": "signed-in",
  "今日已签到": "signed-in",
  "已连续签到": "signed-in",
  "已签到": "signed-in",
  "未签到": "not-signed-in",
  "立即签到": "not-signed-in",
  "签到": "not-signed-in",
  "请先登录": "guest",
};

function detectStatus(text) {
  if (!text) return "unknown";
  for (const [zh, en] of Object.entries(STATUS_ZH)) {
    if (text.includes(zh)) return en;
  }
  return "unknown";
}

function findText(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

export function parseCheckinPage(html) {
  if (typeof html !== "string" || !html) {
    return { status: "unknown", csrf: null, hasForm: false, stats: { streak: 0, total: 0 } };
  }

  // Status text sources, in priority order.
  // 1) .admin-plugin-summary span (dedicated checkin page)
  // 2) .daily-checkin-sub (sidebar card)
  // 3) button text (legacy / fallback)
  const statusText = findText(html, [
    /<[^>]*class\s*=\s*["'][^"']*\badmin-plugin-summary\b[^"']*["'][\s\S]*?<span[^>]*>([\s\S]*?)<\//i,
    /<[^>]*class\s*=\s*["'][^"']*\bdaily-checkin-sub\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
    /<button\b[^>]*>([\s\S]*?)<\/button>/i,
  ]);

  // CSRF token from the checkin form (must be inside a form with action /daily_checkin).
  const csrfMatch = html.match(
    /<form\b[^>]*action\s*=\s*["']\/daily_checkin["'][^>]*>[\s\S]*?<input\b[^>]*name\s*=\s*["']_csrf["'][^>]*value\s*=\s*["']([^"']+)["']/i
  );

  // Form presence.
  const hasForm = /<form\b[^>]*action\s*=\s*["']\/daily_checkin["']/i.test(html);

  // Stats: pair of <strong>N</strong><span>label</span>.
  const stats = { streak: 0, total: 0 };
  const statRe = /<strong>(\d+)<\/strong>\s*<span>([^<]+)<\/span>/gi;
  let m;
  while ((m = statRe.exec(html)) !== null) {
    const n = Number(m[1]);
    const label = m[2].trim();
    if (/连续/.test(label)) stats.streak = n;
    else if (/累计/.test(label)) stats.total = n;
  }

  return {
    status: detectStatus(statusText || ""),
    csrf: csrfMatch ? csrfMatch[1] : null,
    hasForm,
    stats,
  };
}
