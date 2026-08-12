// Generate HTML fixtures for notif parser tests.  Variants cover the
// site layouts we know about, plus a few edges (malformed, empty,
// overflow).  Kept pure so it runs anywhere (node, browser, etc).

// =====================================================================
// Legacy notif layout (ul.notif-list with data-id / data-mention)
// =====================================================================

function renderItem({ id, mention, href, title, age }) {
  return (
    `<li data-id="${id}" data-mention="${mention ? "true" : "false"}">` +
    `<a href="${href}">${title}</a>` +
    (age ? `<time>${age}</time>` : "") +
    `</li>`
  );
}

export function buildFixture({ items = [], unread = 0, mode = "list" } = {}) {
  if (mode === "empty") {
    return `<!doctype html><html><body>` +
      `<h1>通知中心</h1>` +
      `<ul class="notif-list"></ul>` +
      `<span class="notif-unread-count">0</span>` +
      `</body></html>`;
  }
  if (mode === "malformed") return "<html></html>";
  return `<!doctype html><html><body>` +
    `<h1>通知中心</h1>` +
    `<ul class="notif-list">${items.map(renderItem).join("")}</ul>` +
    `<span class="notif-unread-count">${unread}</span>` +
    `</body></html>`;
}

export const DEFAULT_ITEMS = [
  { id: 1, mention: true,  href: "/topic/100#reply-1", title: "@vfhky 在【测试主题】回复了你", age: "2 分钟前" },
  { id: 2, mention: false, href: "/topic/101",        title: "你关注的主题【新主题】有新回复", age: "10 分钟前" },
  { id: 3, mention: true,  href: "/topic/102#reply-5", title: "@other 在【另一主题】提到了你", age: "1 小时前" },
];

// =====================================================================
// Current linux.sb (1.1.3 era) layouts
// =====================================================================

/**
 * Home-page sidebar daily checkin card.
 * @param {object} [opts]
 * @param {"pending"|"done"} [opts.status="pending"]
 * @param {string} [opts.csrf="test-csrf-token"]
 * @param {{streak:number,total:number}} [opts.stats]
 * @param {number} [opts.reward] points to display in the badge when pending
 */
export function dailyCheckinCard({ status = "pending", csrf = "test-csrf-token", stats = { streak: 0, total: 0 }, reward = 75 } = {}) {
  if (status === "done") {
    return `<div class="card sidebar-card daily-checkin-card">` +
      `<div class="daily-checkin-wrap">` +
        `<div class="daily-checkin-head">` +
          `<div>` +
            `<div class="daily-checkin-title">每日签到</div>` +
            `<div class="daily-checkin-sub">今天已签到</div>` +
          `</div>` +
          `<span class="daily-checkin-badge done">已签到</span>` +
        `</div>` +
        `<div class="daily-checkin-stats">` +
          `<div><strong>${stats.streak}</strong><span>连续天数</span></div>` +
          `<div><strong>${stats.total}</strong><span>累计签到</span></div>` +
        `</div>` +
        `<div class="daily-checkin-action">` +
          `<div class="daily-checkin-done">已完成</div>` +
        `</div>` +
      `</div>` +
      `</div>`;
  }
  return `<div class="card sidebar-card daily-checkin-card">` +
    `<div class="daily-checkin-wrap">` +
      `<div class="daily-checkin-head">` +
        `<div>` +
          `<div class="daily-checkin-title">每日签到</div>` +
          `<div class="daily-checkin-sub">今天待签到</div>` +
        `</div>` +
        `<span class="daily-checkin-badge">+${reward} 积分</span>` +
      `</div>` +
      `<div class="daily-checkin-stats">` +
        `<div><strong>${stats.streak}</strong><span>连续天数</span></div>` +
        `<div><strong>${stats.total}</strong><span>累计签到</span></div>` +
      `</div>` +
      `<div class="daily-checkin-action">` +
        `<form class="post-action-form" method="post" action="/daily_checkin">` +
          `<input type="hidden" name="_csrf" value="${csrf}">` +
          `<button type="submit" class="daily-checkin-btn">签到</button>` +
        `</form>` +
      `</div>` +
    `</div>` +
    `</div>`;
}

/**
 * Dedicated /daily_checkin page (different layout from the sidebar card).
 * Status text lives in `.admin-plugin-summary span`.
 */
export function dailyCheckinPage({ status = "pending", csrf = "test-csrf-token", stats = { streak: 0, total: 0 } } = {}) {
  const statusText = status === "done" ? "今天已签到" : "今天待签到";
  const form = status === "done"
    ? `<div class="daily-checkin-done">已完成</div>`
    : `<form class="post-action-form" method="post" action="/daily_checkin">` +
      `<input type="hidden" name="_csrf" value="${csrf}">` +
      `<button type="submit" class="daily-checkin-btn">签到</button>` +
      `</form>`;
  return `<!doctype html><html><head><title>每日签到 - LINUX SB</title></head><body>` +
    `<div class="admin-list-panel plugin-manage-panel daily-checkin-page-panel">` +
      `<div class="admin-list-head">` +
        `<div class="admin-head-inline">` +
          `<div class="admin-head-left-slot">` +
            `<div class="admin-plugin-summary"><strong>每日签到</strong><span>${statusText}</span></div>` +
          `</div>` +
        `</div>` +
      `</div>` +
      `<div class="plugin-panel-body daily-checkin-page-body">` +
        `<div class="daily-checkin-stats daily-checkin-page-stats">` +
          `<div><strong>${stats.streak}</strong><span>连续天数</span></div>` +
          `<div><strong>${stats.total}</strong><span>累计签到</span></div>` +
        `</div>` +
        `<div class="daily-checkin-action daily-checkin-page-action">${form}</div>` +
      `</div>` +
    `</div>` +
    `</body></html>`;
}

/**
 * Right sidebar user card.
 * @param {object} [opts]
 * @param {boolean} [opts.loggedIn=true]
 * @param {number} [opts.userId=16056]
 * @param {string} [opts.nickname="myss"]
 * @param {string} [opts.rank="笔友"]
 * @param {number} [opts.points=177]
 * @param {string} [opts.avatarUrl] explicit avatar src; defaults to dicebear
 */
export function userCard({ loggedIn = true, userId = 16056, nickname = "myss", rank = "笔友", points = 177, avatarUrl = "https://linux.sb/app/avatars/bottts-neutral_24.svg" } = {}) {
  if (loggedIn) {
    return `<div class="card sidebar-card user-card">` +
      `<div class="user-wrap">` +
        `<div class="user-header">` +
          `<div class="user-header-info">` +
            `<a class="user-avatar-big" href="/user/${userId}">` +
              `<img class="avatar-img" src="${avatarUrl}" alt="${nickname}" loading="lazy">` +
            `</a>` +
            `<div>` +
              `<a class="user-name" href="/user/${userId}">${nickname}</a>` +
              `<div class="user-rank">${rank} · 积分 ${points}</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
        `<div class="user-links">` +
          `<a href="/user/${userId}?tab=topics">我的主题</a>` +
          `<a href="/user/${userId}?tab=replies">我的回帖</a>` +
          `<a href="/user/${userId}?tab=points_rewards">我的积分</a>` +
        `</div>` +
      `</div>` +
      `<a class="btn-post" href="/topic_edit">+ 发帖</a>` +
      `</div>`;
  }
  // Visitor variant: same card shell, but avatar is a <div> letter placeholder
  // and the name link points to /login.
  const letter = (nickname || "G").slice(0, 1).toUpperCase();
  return `<div class="card sidebar-card user-card">` +
    `<div class="user-wrap">` +
      `<div class="user-header">` +
        `<div class="user-header-info">` +
          `<div class="user-avatar-big visitor-avatar">${letter}</div>` +
          `<div>` +
            `<a class="user-name" href="/login">登录</a>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</div>` +
    `</div>`;
}

/**
 * One notification item in the current site structure
 * (li.post-item.notification-item inside ul.post-list).
 * @param {object} opts
 * @param {"mention"|"reply"|"system"} [opts.kind="mention"]
 * @param {string} opts.content - body HTML (can include <a> tags)
 * @param {string} [opts.url]
 * @param {string} [opts.actor="actor"]
 * @param {string} [opts.age="刚刚"]
 */
export function notificationItem({ kind = "mention", content = "", url = "/topic/100", actor = "actor", age = "刚刚" } = {}) {
  const kindZh = ({ mention: "提及", reply: "回复", system: "系统" })[kind] || "系统";
  return `<li class="post-item notification-item">` +
    `<div class="post-avatar"><a class="avatar-profile-link" href="/user/${actor}"><img class="avatar-img" src="/app/avatars/bottts-neutral_0.svg" alt="${actor}"></a></div>` +
    `<div class="post-body">` +
      `<div class="post-title-row notification-head">` +
        `<a class="post-title" href="/user/${actor}">${actor}</a>` +
        `<span class="post-user-group notification-kind">${kindZh}</span>` +
      `</div>` +
      `<div class="post-meta"><span>${age}</span></div>` +
      `<div class="post-content notification-content">${content}</div>` +
    `</div>` +
    `</li>`;
}

/**
 * Full /user/<id>?tab=notifications page body (just the post-list block).
 * @param {object} [opts]
 * @param {Array} [opts.items]
 */
export function notificationPage({ items = [] } = {}) {
  return `<ul class="post-list">${items.map(notificationItem).join("")}</ul>`;
}
