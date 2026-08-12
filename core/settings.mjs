// Tiny settings registry.  Each registered setting gets a getter and a
// setter with type-aware validation, plus a pub/sub for change events.
// Backed by GM_getValue / GM_setValue (so values persist across reloads).
export function createRegistry() {
  const defs = new Map();
  const listeners = new Set();
  const keyListeners = new Map();

  function validate(def, v) {
    if (def.type === "boolean") return typeof v === "boolean" ? v : null;
    if (def.type === "enum") return def.options.includes(v) ? v : null;
    if (def.type === "string") return typeof v === "string" ? v : null;
    if (def.type === "number") return Number.isFinite(v) ? v : null;
    return null;
  }

  function get(key) {
    const def = defs.get(key);
    if (!def) throw new Error("settings.get: unknown key " + key);
    let value = def.default;
    const raw = typeof GM_getValue === "function" ? GM_getValue(def.storageKey, null) : null;
    const v = validate(def, raw);
    if (v !== null) value = v;
    const set = (next) => {
      if (validate(def, next) === null) throw new Error("settings: invalid value for " + key + ": " + next);
      value = next;
      if (typeof GM_setValue === "function") GM_setValue(def.storageKey, next);
      for (const fn of keyListeners.get(key) || []) { try { fn(next); } catch (e) { if (typeof console !== "undefined") console.warn(e); } }
      for (const fn of listeners) { try { fn({ key, value: next }); } catch (e) { if (typeof console !== "undefined") console.warn(e); } }
    };
    const subscribe = (fn) => {
      if (!keyListeners.has(key)) keyListeners.set(key, new Set());
      keyListeners.get(key).add(fn);
      return () => keyListeners.get(key).delete(fn);
    };
    return { get: () => value, set, subscribe, def };
  }

  function register(def) {
    if (!def || !def.key) throw new Error("settings.register: key required");
    if (!def.type) throw new Error("settings.register: type required for " + def.key);
    def.storageKey = def.storageKey || ("lsb:setting:" + def.key);
    def.group = def.group || "general";
    def.label = typeof def.label === "string" ? { en: def.label } : (def.label || { en: def.key });
    defs.set(def.key, def);
  }

  function list() {
    return Array.from(defs.values()).sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.key.localeCompare(b.key);
    });
  }
  function groups() { return Array.from(new Set(list().map((d) => d.group))); }
  function on(event, fn) {
    if (event !== "change") throw new Error("settings.on: only change supported");
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { register, get, list, groups, on };
}
