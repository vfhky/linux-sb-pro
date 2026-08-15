import assert from "node:assert/strict";
import { createLRUCache } from "../lib/lru-cache.mjs";

export default async function run() {
  // basic get/set/has/delete
  {
    const c = createLRUCache(3);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    assert.equal(c.has("a"), true);
    assert.equal(c.get("b"), 2);
    assert.equal(c.delete("a"), true);
    assert.equal(c.has("a"), false);
    assert.equal(c.get("missing"), undefined);
  }
  // eviction: oldest evicted first (LRU order)
  {
    const c = createLRUCache(3);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    c.set("d", 4); // evicts "a"
    assert.equal(c.has("a"), false);
    assert.equal(c.has("b"), true);
    assert.equal(c.has("c"), true);
    assert.equal(c.has("d"), true);
    assert.equal(c.size, 3);
  }
  // MRU refresh: getting a key moves it to the tail
  {
    const c = createLRUCache(3);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    c.get("a"); // a is now MRU
    c.set("d", 4); // evicts "b" (now LRU), not "a"
    assert.equal(c.has("b"), false);
    assert.equal(c.has("a"), true);
    assert.equal(c.has("d"), true);
  }
  // set existing key refreshes position
  {
    const c = createLRUCache(2);
    c.set("a", 1); c.set("b", 2);
    c.set("a", 10); // refresh
    c.set("c", 3);  // evicts "b"
    assert.equal(c.has("b"), false);
    assert.equal(c.get("a"), 10);
    assert.equal(c.get("c"), 3);
  }
  // clear + maxSize validation
  {
    const c = createLRUCache(2);
    c.set("a", 1); c.set("b", 2); c.clear();
    assert.equal(c.size, 0);
    assert.throws(() => createLRUCache(0), /maxSize/);
    assert.throws(() => createLRUCache(-1), /maxSize/);
  }
}
