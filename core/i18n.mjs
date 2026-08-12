// Minimal i18n helper.  Locale fallback chain: exact match -> language
// root (zh-CN -> zh) -> explicit fallback locale -> en -> key itself.
export function createI18n({ locale = "en", fallback = "en" } = {}) {
  const table = {};
  function add(map) { Object.assign(table, map); }
  function setLocale(loc) { locale = loc; }
  function pick(strings, loc) {
    if (!strings) return null;
    if (strings[loc] != null) return strings[loc];
    const root = loc.split("-")[0];
    if (strings[root] != null) return strings[root];
    if (strings[fallback] != null) return strings[fallback];
    if (strings.en != null) return strings.en;
    return null;
  }
  function t(key, loc) {
    const useLoc = loc || locale;
    const v = pick(table[key], useLoc);
    return v != null ? v : key;
  }
  return { add, setLocale, t, get locale() { return locale; } };
}
