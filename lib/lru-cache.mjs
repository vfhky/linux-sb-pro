// lib/lru-cache.mjs
// Generic LRU cache (Map-based, O(1) get/set). Ported from LDStatus Pro's
// verified implementation (docs/superpowers/specs/2026-08-13-ldstatuspro-analysis.md §4).
export function createLRUCache(maxSize = 50) {
  if (!(maxSize > 0)) throw new Error("lru-cache: maxSize must be > 0");
  const cache = new Map();
  return {
    get size() { return cache.size; },
    get(key) {
      if (!cache.has(key)) return undefined;
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value); // move to tail (most recently used)
      return value;
    },
    set(key, value) {
      if (cache.has(key)) cache.delete(key);
      if (cache.size >= maxSize) cache.delete(cache.keys().next().value); // evict LRU
      cache.set(key, value);
      return value;
    },
    has(key) { return cache.has(key); },
    delete(key) { return cache.delete(key); },
    clear() { cache.clear(); },
  };
}
