// Diff-style rendering for the notification badge/list.
// Pure: given the previous and next notification state, returns a patch
// describing ONLY what visibly changed, or null when nothing changed so
// the caller can skip DOM writes entirely (keeps the 60s poll from
// flashing the panel when data is unchanged).
export function notifViewDiff(prev, next) {
  const nextState = next || { unread: 0, list: [] };
  const unread = Number(nextState.unread) || 0;
  const list = Array.isArray(nextState.list) ? nextState.list : [];
  const prevUnread = prev ? Number(prev.unread) || 0 : null;
  // Symmetric with the next-side list handling: malformed / missing lists
  // are treated as empty on BOTH sides, so an identical malformed payload
  // yields no patch.
  const prevList = prev && Array.isArray(prev.list) ? prev.list : [];

  const listKey = (items) => items.map((i) => (i ? i.url + "|" + i.title : "")).join("\u0001");
  const nextKey = listKey(list);
  const prevKey = prevList ? listKey(prevList) : null;

  const countChanged = prevUnread !== unread;
  const listChanged = prevKey !== nextKey;
  // First render (prev === null) must always produce a patch.
  if (!countChanged && !listChanged) return null;

  return {
    unread,
    countChanged,
    listChanged,
    list,
    dotText: unread > 9 ? "9+" : (unread > 0 ? String(unread) : ""),
    dotHidden: unread === 0,
  };
}
