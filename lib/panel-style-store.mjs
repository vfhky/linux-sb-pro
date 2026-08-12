// Storage adapter for the floating panel's position and theme.  Pure:
// takes a tiny { get, set } adapter (so tests can pass a Map-backed
// stub) and a key prefix; returns getters and setters with validation.
const POS = new Set(["TL", "TR", "BL", "BR"]);
const THEME = new Set(["light", "dark", "auto"]);

export const DEFAULT_POS = "BR";
export const DEFAULT_THEME = "auto";

export function validatePos(v) { return POS.has(v) ? v : null; }
export function validateTheme(v) { return THEME.has(v) ? v : null; }

export function makeStore(gm, prefix) {
  const POS_KEY = prefix + "pos";
  const THEME_KEY = prefix + "theme";
  return {
    getPos() { return validatePos(gm.get(POS_KEY)) || DEFAULT_POS; },
    setPos(v) {
      if (!validatePos(v)) throw new Error("invalid pos: " + v);
      gm.set(POS_KEY, v);
    },
    getTheme() { return validateTheme(gm.get(THEME_KEY)) || DEFAULT_THEME; },
    setTheme(v) {
      if (!validateTheme(v)) throw new Error("invalid theme: " + v);
      gm.set(THEME_KEY, v);
    },
  };
}
