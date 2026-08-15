// Build a { key -> element } reference table for a container's [data-*]
// nodes. The UI module collects its static skeleton once (instead of
// re-querying per access); dynamic content (sections, notif list, toast)
// is still queried on demand.
//
// Pure: takes any node with querySelectorAll, returns a plain object.
// Duplicate keys: first occurrence wins (the template only has unique
// keys; this guards against accidental re-registration).
export function collectRefs(root, attr = "data-lsb") {
  const refs = {};
  if (!root || typeof root.querySelectorAll !== "function") return refs;
  root.querySelectorAll("[" + attr + "]").forEach((el) => {
    const key = el.getAttribute(attr);
    if (key && !(key in refs)) refs[key] = el;
  });
  return refs;
}
