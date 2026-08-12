// Try each candidate URL in order.  Return the first one whose HTML body
// contains either a notification-shaped heading or a list-shaped element.
// Pure: depends only on the http adapter the caller injects.
const HEADING_RE = /<h\d[^>]*>\s*(?:通知(?:中心)?|提醒|消息|inbox|notifications?)\s*</i;
const LIST_CLASS_RE = /class\s*=\s*["'][^"']*\b(?:notif|notice|inbox|message)-?list\b/i;

function isNotifPage(html) {
  return HEADING_RE.test(html) || LIST_CLASS_RE.test(html);
}

export async function probeEndpoint(http, apiBase, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const base = String(apiBase || "").replace(/\/+$/, "");
  for (const path of candidates) {
    const url = base + path;
    const html = await http.getHtml(url);
    if (isNotifPage(html || "")) return url;
  }
  return null;
}
