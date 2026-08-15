// Parse a linux.sb notifications page into { unread, list }.
// Pure: takes HTML text, returns a plain object.  MAX_LIST caps the
// returned list size; unread is reported as the raw count even when
// the list is capped (the panel can show "5 of N").
//
// Two layouts are supported; the parser auto-detects:
//   1. Current site (1.1.3 era):
//      <ul class="post-list">
//        <li class="post-item notification-item">
//          <span class="post-user-group notification-kind">提及</span>
//          <div class="post-content notification-content">...</div>
//        </li>
//      </ul>
//      The "unread" count is derived from the number of items (the
//      real page does not expose a separate badge).
//
//   2. Legacy:
//      <ul class="notif-list">
//        <li data-id="N" data-mention="true|false"><a>...</a></li>
//      </ul>
//      with an optional <span class="notif-unread-count">N</span>.
//      The "unread" count is read from the badge (falls back to list length).

export const MAX_LIST = 5;

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function kindFromZh(text) {
  if (/提及|@|提到/.test(text)) return "mention";
  if (/回复|reply/i.test(text)) return "reply";
  return "system";
}

function extractUnreadLegacy(html) {
  const m = html.match(/class\s*=\s*["'][^"']*notif-unread-count["'][^>]*>\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function extractListLegacy(html) {
  const block = html.match(/<ul[^>]*class\s*=\s*["'][^"']*\bnotif-list\b[^"']*["'][\s\S]*?<\/ul>/i);
  if (!block) return [];
  const items = [];
  const liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(block[0])) !== null) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    const idMatch = attrs.match(/data-id\s*=\s*["']([^"']+)/i);
    const mention = /data-mention\s*=\s*["']true/i.test(attrs);
    const aMatch = body.match(/<a\b[^>]*href\s*=\s*["']([^"']+)[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) continue;
    const url = aMatch[1];
    const title = stripTags(aMatch[2]);
    items.push({
      id: idMatch ? idMatch[1] : url,
      url,
      title,
      isMention: mention,
      kind: mention ? "mention" : "system",
    });
    if (items.length >= MAX_LIST) break;
  }
  return items;
}

function extractListNew(html) {
  const items = [];
  let total = 0;
  // Match each <li class="...notification-item...">...</li> block.
  // Use a greedy-but-bounded approach: capture the <li> body via a
  // manual scan so nested <div>/<span> blocks parse correctly.
  const liRe = /<li\b[^>]*class\s*=\s*["'][^"']*\bnotification-item\b[^"']*["'][^>]*>/gi;
  let openMatch;
  while ((openMatch = liRe.exec(html)) !== null) {
    const start = liRe.lastIndex;
    // Walk forward, counting <div ...> opens minus </div> closes, until
    // we hit the matching </li>. Handles nested divs/p/spans correctly.
    const close = findMatchingClose(html, start, "li");
    if (close < 0) break;
    const body = html.slice(start, close);
    // Kind text lives inside the first .notification-kind element.
    const kindMatch = matchInner(body, "notification-kind", "span");
    const contentMatch = matchInner(body, "notification-content", "div");
    const linkMatch = body.match(/<a\b[^>]*href\s*=\s*["']([^"']+)/i);
    if (!contentMatch) {
      liRe.lastIndex = close + 5;
      continue;
    }
    // Count every well-formed item; only the returned list is capped.
    total++;
    if (items.length >= MAX_LIST) {
      liRe.lastIndex = close + 5;
      continue;
    }
    const kindZh = kindMatch ? stripTags(kindMatch) : "";
    const title = stripTags(contentMatch).slice(0, 240);
    items.push({
      id: linkMatch ? linkMatch[1] : title,
      url: linkMatch ? linkMatch[1] : null,
      title,
      kind: kindFromZh(kindZh),
    });
    liRe.lastIndex = close + 5;
  }
  return { list: items, total };
}

// Find the index of the matching </TAG> for an opening <TAG at position
// `start` (just past the opening tag).  Walks the substring, counting
// opens and closes, allowing for nested same-tag elements.  Returns -1
// if no match (malformed input).
function findMatchingClose(html, start, tag) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let i = start;
  // Build candidate positions by scanning both regexes.
  openRe.lastIndex = i;
  closeRe.lastIndex = i;
  let nextOpen = openRe.exec(html);
  let nextClose = closeRe.exec(html);
  while (depth > 0) {
    if (nextClose && (!nextOpen || nextClose.index < nextOpen.index)) {
      depth--;
      if (depth === 0) return nextClose.index;
      nextClose = closeRe.exec(html);
    } else if (nextOpen) {
      depth++;
      nextOpen = openRe.exec(html);
    } else if (nextClose) {
      depth--;
      if (depth === 0) return nextClose.index;
      nextClose = closeRe.exec(html);
    } else {
      return -1;
    }
  }
  return -1;
}

// Find the inner text of the first <TAG class="...className...">...</TAG>
// block within `html`.  Returns null if not found.
function matchInner(html, className, tag) {
  const re = new RegExp(
    `<${tag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const close = findMatchingClose(html, start, tag);
  if (close < 0) return null;
  return html.slice(start, close);
}

export function parseNotifications(html) {
  if (typeof html !== "string" || !html) return { unread: 0, list: [] };

  // New structure takes priority: it ships with the live site and the
  // "notification-item" class is unique to it.  unread is the RAW item
  // count (the page has no separate badge); only the returned list is
  // capped at MAX_LIST.
  if (/notification-item/.test(html)) {
    const { list, total } = extractListNew(html);
    return { unread: total, list };
  }

  // Legacy fallback.
  const list = extractListLegacy(html);
  return { unread: extractUnreadLegacy(html), list };
}
