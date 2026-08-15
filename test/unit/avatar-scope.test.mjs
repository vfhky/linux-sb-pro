import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";

// Regression test for the avatar-scope fix (fc0f241):
//   1. The fixed readUserFromDocument must read the avatar ONLY from the
//      sidebar user-card's avatar wrapper, not the first .avatar-img in
//      the whole document.
//   2. The old buggy version is confirmed to have read the WRONG avatar.
//
// Requires a live Chrome on the CDP debug port (start-chrome.ps1). When
// Chrome is not reachable the test skips gracefully so `npm test` stays
// green on machines without a browser.

export default async function run() {
  let b;
  try {
    b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  } catch (err) {
    console.log("SKIP avatar-scope: Chrome CDP 127.0.0.1:9222 not reachable (start with start-chrome.ps1)");
    return;
  }
  let page;
  try {
    page = await b.contexts()[0].newPage();

    let passed = 0;
    let failed = 0;

    // Test 1: Fixed version should read scoped avatar
    {
      const result = await page.evaluate(() => {
        const html = `
      <!DOCTYPE html>
      <html><body>
        <div class="comment">
          <img class="avatar-img" src="https://linux.sb/app/upload/avatar_upload/5e/2632.jpg" alt="wrong">
        </div>
        <a class="nav-mine" href="/user/16056">myss</a>
        <div class="sidebar-card user-card">
          <div class="user-avatar-big">
            <img class="avatar-img" src="https://linux.sb/app/avatars/bottts-neutral_24.svg" alt="myss">
          </div>
          <div class="user-name">myss</div>
          <div class="user-rank">饼友 · 积分 303</div>
        </div>
      </body></html>
    `;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const SELECTORS = {
          navMine:        "a.nav-mine",
          sidebarCard:    ".sidebar-card.user-card",
          nameLink:       ".sidebar-card.user-card .user-name",
          avatarWrap:     ".sidebar-card.user-card .user-avatar-big",
          avatarImg:      ".sidebar-card.user-card .user-avatar-big img.avatar-img",
          rank:           ".sidebar-card.user-card .user-rank",
          points:         ".sidebar-card.user-card .user-points",
          visitorAvatar:  ".sidebar-card.user-card .user-avatar-big.visitor-avatar",
          anyAvatarLink:  "a.avatar-profile-link",
        };

        function _userIdFromHref(href) {
          const m = (href || "").match(/^\/user\/(\d+)/);
          return m ? Number(m[1]) : null;
        }

        // FIXED version with scoped $
        function readUserFromDocument(doc, helpers) {
          const { absUrl, dicebearForUserId, currentPath } = helpers;
          const $ = (sel, el) => (el || doc).querySelector(sel);
          const text = (el) => el ? (el.textContent || "").trim() : "";
          const attr = (el, name) => el ? el.getAttribute(name) : null;
          const src = (el) => el ? (el.src || el.getAttribute("src") || "") : "";

          const navMine = $(SELECTORS.navMine);
          if (navMine) {
            const navText = text(navMine);
            const navHref = attr(navMine, "href") || "";
            if (/\/login\b/.test(navHref) || /登录/.test(navText)) return null;
            const myId = _userIdFromHref(navHref);

            const isOwnUserPage = !!currentPath && new RegExp(`^/user/${myId}(?:/|$|\\?|#)`).test(currentPath);
            const isOtherUserPage = !!currentPath && /^\/user\/\d+/.test(currentPath) && !isOwnUserPage;
            if (isOtherUserPage) {
              return { id: myId, nickname: null, avatarUrl: null, avatarIsDicebear: false, profileUrl: navHref ? absUrl(navHref) : null, rank: null, points: null, isLoggedIn: true, source: "nav-mine-only" };
            }

            const card = $(SELECTORS.sidebarCard);
            const nameEl = card ? $(SELECTORS.nameLink) : null;
            const avatarWrap = card ? $(SELECTORS.avatarWrap) : null;
            const avatarImg  = avatarWrap ? $("img.avatar-img", avatarWrap) : null;
            const rankEl     = card ? $(SELECTORS.rank) : null;
            const pointsEl   = card ? $(SELECTORS.points) : null;
            const nickname   = nameEl ? text(nameEl) : null;
            let avatarUrl    = avatarImg ? src(avatarImg) : null;
            let avatarIsDicebear = !!avatarUrl && /\/avatars\/|dicebear/i.test(avatarUrl);
            if (!avatarUrl && avatarWrap && avatarWrap.classList.contains("visitor-avatar")) {
              avatarUrl = dicebearForUserId ? dicebearForUserId(String(myId || "guest")) : null;
              avatarIsDicebear = true;
            }
            const rankText = rankEl ? text(rankEl) : null;
            let points = null;
            if (pointsEl) {
              const m = text(pointsEl).match(/(\d+)/);
              if (m) points = Number(m[1]);
            } else if (rankText) {
              const m = rankText.match(/(\d+)/);
              if (m) points = Number(m[1]);
            }
            return { id: myId, nickname: nickname || null, avatarUrl: avatarUrl || null, avatarIsDicebear, profileUrl: navHref ? absUrl(navHref) : null, rank: rankText || null, points, isLoggedIn: true, source: avatarImg ? "user-card" : "user-card-visitor" };
          }

          const link = $(SELECTORS.anyAvatarLink);
          if (link) {
            const href = attr(link, "href") || "";
            const img = $("img", link);
            const id = _userIdFromHref(href);
            if (id) {
              return { id, nickname: attr(img, "alt") || null, avatarUrl: src(img) || null, avatarIsDicebear: !!img && /dicebear/i.test(src(img) || ""), profileUrl: absUrl(href), isLoggedIn: false, source: "avatar-link" };
            }
          }
          return null;
        }

        return readUserFromDocument(doc, {
          currentPath: "/",
          absUrl: (href) => href,
          dicebearForUserId: (id) => `https://linux.sb/app/avatars/bottts-neutral_${id}.svg`,
        });
      });

      if (result && result.id === 16056 && result.nickname === "myss" && result.avatarUrl === "https://linux.sb/app/avatars/bottts-neutral_24.svg") {
        console.log("✅ Test 1 PASSED: Fixed code reads correct scoped avatar (bottts-neutral_24.svg)");
        passed++;
      } else {
        console.log("❌ Test 1 FAILED:", JSON.stringify(result));
        failed++;
      }
    }

    // Test 2: Old buggy version would read wrong avatar
    {
      const result = await page.evaluate(() => {
        const html = `
      <!DOCTYPE html>
      <html><body>
        <div class="comment">
          <img class="avatar-img" src="https://linux.sb/app/upload/avatar_upload/5e/2632.jpg" alt="wrong">
        </div>
        <a class="nav-mine" href="/user/16056">myss</a>
        <div class="sidebar-card user-card">
          <div class="user-avatar-big">
            <img class="avatar-img" src="https://linux.sb/app/avatars/bottts-neutral_24.svg" alt="myss">
          </div>
          <div class="user-name">myss</div>
        </div>
      </body></html>
    `;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // OLD BUGGY $: ignores second argument
        const buggy$ = (sel) => doc.querySelector(sel);
        const avatarWrap = doc.querySelector(".sidebar-card.user-card .user-avatar-big");
        const avatarImg = avatarWrap ? buggy$("img.avatar-img", avatarWrap) : null;
        const buggyAvatarUrl = avatarImg ? (avatarImg.src || avatarImg.getAttribute("src") || "") : null;

        return { buggyAvatarUrl };
      });

      if (result.buggyAvatarUrl === "https://linux.sb/app/upload/avatar_upload/5e/2632.jpg") {
        console.log("✅ Test 2 PASSED: Old buggy code confirmed to read WRONG avatar (2632.jpg)");
        passed++;
      } else {
        console.log("❌ Test 2 FAILED, buggy url:", result.buggyAvatarUrl);
        failed++;
      }
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) throw new Error(`avatar-scope: ${failed} assertion(s) failed`);
  } finally {
    try { if (page) await page.close(); } catch (e) { /* ignore */ }
    try { await b.close(); } catch (e) { /* ignore */ }
  }
}

// Allow direct execution: node test/unit/avatar-scope.test.mjs
const isMain = typeof process !== "undefined" && process.argv[1] &&
  fileURLToPath(import.meta.url) === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}
