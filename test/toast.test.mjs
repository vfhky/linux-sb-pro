// test/toast.test.mjs
import assert from 'node:assert/strict';
import { createToastManager } from '../lib/toast.mjs';

// Minimal DOM stub for Node.js test environment
function createDOM() {
  const doc = {
    _children: [],
    documentElement: {
      appendChild(el) { doc._children.push(el); return el; },
      removeChild(el) {
        const i = doc._children.indexOf(el);
        if (i >= 0) doc._children.splice(i, 1);
        return el;
      },
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        dataset: {},
        _attrs: {},
        _children: [],
        _events: {},
        _parent: null,
        _removed: false,
        _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = v; },
        style: {},
        classList: {
          _items: [],
          add(cls) { if (!this._items.includes(cls)) this._items.push(cls); },
          remove(cls) { this._items = this._items.filter(function(c) { return c !== cls; }); },
          contains(cls) { return this._items.includes(cls); },
        },
        setAttribute(name, value) { this._attrs[name] = value; },
        getAttribute(name) { return this._attrs[name] || null; },
        appendChild(child) { child._parent = el; this._children.push(child); return child; },
        removeChild(child) {
          const i = this._children.indexOf(child);
          if (i >= 0) this._children.splice(i, 1);
          child._removed = true;
          return child;
        },
        addEventListener(evt, fn) {
          if (!this._events[evt]) this._events[evt] = [];
          this._events[evt].push(fn);
        },
        _fire(evt) {
          (this._events[evt] || []).forEach(function(fn) { fn.call(el); });
        },
        get parentNode() { return this._parent; },
      };
      return el;
    },
    getElementById(id) { return null; },
    querySelector(sel) { return null; },
  };
  // The toast module reads the global `document`; install the stub globally
  // so each test runs against a fresh DOM.
  globalThis.document = doc;
  return doc;
}

export default async function run() {
  // --- Test 1: show() creates a DOM element ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-toast', durationMs: 100 });
    const el = t.show('hello', { type: 'success' });
    assert.ok(el, 'show() should return an element');
    assert.equal(el.tagName, 'DIV', 'should be a div');
    assert.equal(el.dataset.type, 'success', 'data-type should be success');
    assert.ok(el._innerHTML.indexOf('hello') >= 0, 'innerHTML should contain message');
    t.destroy();
  }

  // --- Test 2: show("", ...) silently ignores empty message ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-empty' });
    const el = t.show('', { type: 'info' });
    assert.equal(el, undefined, 'empty message should return undefined');
    t.destroy();
  }

  // --- Test 3: show(null, ...) silently ignores ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-null' });
    const el = t.show(null, { type: 'info' });
    assert.equal(el, undefined, 'null message should return undefined');
    t.destroy();
  }

  // --- Test 4: type mapping → data-type attribute ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-types', durationMs: 100 });
    const success = t.show('ok', { type: 'success' });
    assert.equal(success.dataset.type, 'success');
    const error = t.show('fail', { type: 'error' });
    assert.equal(error.dataset.type, 'error');
    const info = t.show('info', { type: 'info' });
    assert.equal(info.dataset.type, 'info');
    t.destroy();
  }

  // --- Test 5: queue maxVisible=3, 4th evicts 1st ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-queue', maxVisible: 3, durationMs: 99999 });
    const a = t.show('a', { type: 'info' });
    const b = t.show('b', { type: 'info' });
    const c = t.show('c', { type: 'info' });
    const d = t.show('d', { type: 'info' });
    assert.ok(a._removed, '4th toast should evict the 1st');
    assert.ok(!b._removed, '2nd toast should still be present');
    assert.ok(!c._removed, '3rd toast should still be present');
    assert.ok(!d._removed, '4th toast should be present');
    t.destroy();
  }

  // --- Test 6: auto dismiss after durationMs ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-dismiss', durationMs: 10 });
    const el = t.show('auto-dismiss', { type: 'success' });
    assert.ok(!el._removed, 'should be visible before timeout');
    // durationMs is clamped to a 1000ms minimum, so wait past that
    await new Promise(function(r) { setTimeout(r, 1200); });
    assert.ok(el._lsbToastDismissed, 'should be marked dismissed');
    assert.ok(el.classList.contains('lsb-toast-out'), 'should have out class');
    t.destroy();
  }

  // --- Test 7: manual dismiss on click ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-click', durationMs: 99999 });
    const el = t.show('click me', { type: 'info' });
    el._fire('click');
    assert.ok(el._lsbToastDismissed, 'click should mark dismissed');
    await new Promise(function(r) { setTimeout(r, 250); });
    assert.ok(el._removed, 'element should be removed after animation');
    t.destroy();
  }

  // --- Test 8: destroy() cleans up all toasts and container ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-destroy', durationMs: 99999 });
    t.show('one', { type: 'info' });
    t.show('two', { type: 'success' });
    t.destroy();
    t.destroy(); // should not throw
  }

  // --- Test 9: idempotent destroy() ---
  {
    const doc = createDOM();
    const t = createToastManager({ containerId: 'test-idempotent' });
    t.destroy();
    t.destroy();
    t.destroy();
  }

  // --- Test 10: durationMs clamping ---
  {
    const doc = createDOM();
    const tShort = createToastManager({ containerId: 'test-clamp-short', durationMs: 0 });
    const tLong = createToastManager({ containerId: 'test-clamp-long', durationMs: 99999 });
    const el1 = tShort.show('clamped short', { type: 'info' });
    const el2 = tLong.show('clamped long', { type: 'info' });
    assert.ok(el1, 'short duration should not prevent show');
    assert.ok(el2, 'long duration should not prevent show');
    tShort.destroy();
    tLong.destroy();
  }
}
