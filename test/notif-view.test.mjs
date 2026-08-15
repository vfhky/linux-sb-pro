import assert from "node:assert/strict";
import { notifViewDiff } from "../lib/notif-view.mjs";

const item = (url, title) => ({ url, title });

export default async function run() {
  // First render always produces a patch (even for empty state)
  {
    const d = notifViewDiff(null, { unread: 0, list: [] });
    assert.ok(d, "first render must not be skipped");
    assert.equal(d.dotHidden, true);
    assert.equal(d.dotText, "");
  }
  // Identical state -> null (no DOM writes)
  {
    const state = { unread: 3, list: [item("/t/1", "a"), item("/t/2", "b")] };
    const d1 = notifViewDiff(null, state);
    assert.ok(d1);
    const d2 = notifViewDiff(state, { unread: 3, list: [item("/t/1", "a"), item("/t/2", "b")] });
    assert.equal(d2, null, "unchanged state must yield no patch");
  }
  // Unread count change
  {
    const d = notifViewDiff({ unread: 1, list: [] }, { unread: 3, list: [] });
    assert.ok(d);
    assert.equal(d.countChanged, true);
    assert.equal(d.listChanged, false);
    assert.equal(d.dotText, "3");
    assert.equal(d.dotHidden, false);
  }
  // Unread back to 0 -> hidden, empty text
  {
    const d = notifViewDiff({ unread: 3, list: [] }, { unread: 0, list: [] });
    assert.ok(d);
    assert.equal(d.dotHidden, true);
    assert.equal(d.dotText, "");
  }
  // Cap display at "9+"
  {
    const d = notifViewDiff(null, { unread: 12, list: [] });
    assert.equal(d.dotText, "9+");
  }
  // List content change with same count
  {
    const d = notifViewDiff(
      { unread: 2, list: [item("/t/1", "old")] },
      { unread: 2, list: [item("/t/1", "new title")] }
    );
    assert.ok(d);
    assert.equal(d.countChanged, false);
    assert.equal(d.listChanged, true);
  }
  // Malformed payloads are tolerated
  {
    const d = notifViewDiff(null, null);
    assert.ok(d);
    assert.equal(d.unread, 0);
    assert.equal(d.dotHidden, true);
    const d2 = notifViewDiff({ unread: 1, list: "nope" }, { unread: 1, list: "nope" });
    assert.equal(d2, null);
  }
}
