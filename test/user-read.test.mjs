import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { readUserFromDocument, _userIdFromHref } from "../lib/user-read.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const doc = (html) => parseHTML(html).document;

const abs = (h) => { try { return new URL(h, "https://linux.sb").toString(); } catch { return h; } };
const dicebear = (id) => `https://linux.sb/app/avatars/bottts-neutral_${id}.svg`;

export default async function run() {
  // _userIdFromHref basic
  assert.equal(_userIdFromHref("/user/16056"), 16056);
  assert.equal(_userIdFromHref("/user/16056?tab=topics"), 16056);
  assert.equal(_userIdFromHref("/u/1"), null);
  assert.equal(_userIdFromHref(""), null);

  // -- Regression: /user/<other-id> must NOT read the page's user card. --
  // Real capture from /user/17615 (someone else). My nav-mine points at
  // /user/16056 ("myss"). The page's own user-card shows 17615.
  {
    const u = readUserFromDocument(doc(fx("user-page-other.html")), {
      currentPath: "/user/17615",
      absUrl: abs,
      dicebearForUserId: dicebear,
    });
    assert.ok(u, "should return a user");
    assert.equal(u.id, 16056, "must use nav-mine id, not the page owner id");
    assert.equal(u.isLoggedIn, true);
    assert.equal(u.source, "nav-mine-only", "must signal that sidebar was refused");
    // Critically: nickname/avatar/rank/points must be null because the
    // only sidebar card on the page belongs to the OTHER user.
    assert.equal(u.nickname, null, "nickname must NOT come from the other user");
    assert.equal(u.avatarUrl, null);
    assert.equal(u.rank, null);
    assert.equal(u.points, null);
    assert.equal(u.profileUrl, "https://linux.sb/user/16056");
  }

  // -- Home page (path = "/"), the sidebar card is the logged-in user. --
  {
    const u = readUserFromDocument(doc(fx("user-page-home.html")), {
      currentPath: "/",
      absUrl: abs,
      dicebearForUserId: dicebear,
    });
    assert.ok(u, "home page: should return a user");
    assert.equal(u.isLoggedIn, true);
    assert.equal(u.source, "user-card");
    assert.equal(u.id, 16056);
    assert.equal(u.nickname, "myss");
    // 笔友 - rank label is present
    assert.match(u.rank, /笔友/);
    // avatar is a dicebear-style URL
    assert.equal(u.avatarIsDicebear, true);
    assert.match(u.avatarUrl, /bottts-neutral/);
    assert.equal(u.profileUrl, "https://linux.sb/user/16056");
  }

  // -- Edge: when nav-mine is the login link, return null. --
  {
    const html = `<html><body><a class="nav-mine" href="/login">登录</a></body></html>`;
    const u = readUserFromDocument(doc(html), {
      currentPath: "/", absUrl: abs, dicebearForUserId: dicebear,
    });
    assert.equal(u, null);
  }

  // -- Edge: when no nav-mine AND no avatar-profile-link, return null. --
  {
    const html = `<html><body><p>Hello</p></body></html>`;
    const u = readUserFromDocument(doc(html), {
      currentPath: "/", absUrl: abs, dicebearForUserId: dicebear,
    });
    assert.equal(u, null);
  }

  // -- Edge: no currentPath (defensive: behaves like home, refuses nothing). --
  {
    const u = readUserFromDocument(doc(fx("user-page-home.html")), {
      absUrl: abs,
      dicebearForUserId: dicebear,
    });
    assert.ok(u, "no currentPath: should still parse");
    assert.equal(u.id, 16056);
    // Without a currentPath we cannot tell that we are on someone else's
    // page, so the lib falls back to reading the sidebar. This is a
    // documented limitation - the dev source always passes currentPath.
  }
}
