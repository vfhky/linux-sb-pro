// Generate HTML fixtures for notif parser tests.  Variants cover the
// site layouts we know about, plus a few edges (malformed, empty,
// overflow).  Kept pure so it runs anywhere (node, browser, etc).
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
