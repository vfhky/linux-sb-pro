// Tiny registry of "panel sections".  Each module can contribute a
// section to the expanded panel; the registry returns them in order.
// Sections are pure: they receive the current state and return an
// element descriptor; ui renders them.
export function createSectionRegistry() {
  const sections = new Map();

  function register(name, def) {
    if (!name || typeof def !== "object" || typeof def.render !== "function") {
      throw new Error("dom-sections: bad def for " + name);
    }
    sections.set(name, { order: def.order || 0, render: def.render, hidden: def.hidden || (() => false) });
  }
  function unregister(name) { sections.delete(name); }
  function list() { return Array.from(sections.entries()).sort((a, b) => a[1].order - b[1].order); }
  function render(ctx) {
    let innerHTML = "";
    for (const [, def] of list()) {
      if (def.hidden(ctx)) continue;
      const r = def.render(ctx);
      if (r && r.innerHTML != null) innerHTML += r.innerHTML;
    }
    return { innerHTML };
  }
  return { register, unregister, list, render };
}
