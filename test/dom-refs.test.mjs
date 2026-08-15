import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { collectRefs } from "../lib/dom-refs.mjs";

const doc = (html) => parseHTML(html).document;

export default async function run() {
  // Collects all [data-lsb] nodes by key
  {
    const root = doc(`<div id="panel">
      <span data-lsb="dot"></span>
      <span data-lsb="name">x</span>
      <button data-lsb="signin"></button>
    </div>`);
    const refs = collectRefs(root);
    assert.equal(Object.keys(refs).length, 3);
    assert.equal(refs.dot, root.querySelector('[data-lsb="dot"]'));
    assert.equal(refs.name, root.querySelector('[data-lsb="name"]'));
    assert.equal(refs.signin, root.querySelector('[data-lsb="signin"]'));
  }
  // Duplicate key: first occurrence wins
  {
    const root = doc(`<div><span data-lsb="a" id="first"></span><span data-lsb="a" id="second"></span></div>`);
    const refs = collectRefs(root);
    assert.equal(refs.a, root.querySelector("#first"));
  }
  // Custom attribute name
  {
    const root = doc(`<div><span data-x="k1"></span><span data-x="k2"></span></div>`);
    const refs = collectRefs(root, "data-x");
    assert.equal(Object.keys(refs).length, 2);
    assert.ok(refs.k1 && refs.k2);
  }
  // Empty container / null root
  {
    assert.deepEqual(collectRefs(doc("<div></div>")), {});
    assert.deepEqual(collectRefs(null), {});
  }
}
