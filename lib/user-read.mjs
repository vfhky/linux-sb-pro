// Read the logged-in user info from a parsed HTML document.
//
// Two-page safety: on a linux.sb user-profile page, the page's own
// `.sidebar-card.user-card` shows the page's owner, not the logged-in
// viewer. We detect this case (page is /user/<id> AND id != my id)
// and refuse to read the sidebar card. Instead we fall back to the
// top-bar `a.nav-mine` for the id and to the avatar image's alt/ src.
//
// The function is pure (no DOM, no network) so it can be unit-tested
// with HTML fixtures. The caller is responsible for passing the
// parsed document and the helpers it needs.

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

/**
 * @param {Document} doc        - parsed HTML document (DOMParser output ok)
 * @param {object}   helpers
 * @param {string|null} helpers.currentPath - window.location.pathname, used to
 *                            detect "/user/<id>" pages so we can refuse to
 *                            trust the sidebar card when the page is NOT the
 *                            viewer's own profile.
 * @param {(s:string,el?:Element)=>string} helpers.absUrl - make href absolute
 * @param {(s:string)=>string|null} helpers.dicebearForUserId - synthesise a
 *                            placeholder avatar URL for visitors
 * @returns {object|null}      - the logged-in user descriptor, or null
 */
export function readUserFromDocument(doc, helpers) {
  const { absUrl, dicebearForUserId, currentPath } = helpers;
  const $ = (sel) => doc.querySelector(sel);
  const text = (el) => el ? (el.textContent || "").trim() : "";
  const attr = (el, name) => el ? el.getAttribute(name) : null;
  const src = (el) => el ? (el.src || el.getAttribute("src") || "") : "";

  // 1) nav-mine is the top-bar link, always the logged-in user.
  const navMine = $(SELECTORS.navMine);
  if (navMine) {
    const navText = text(navMine);
    const navHref = attr(navMine, "href") || "";
    if (/\/login\b/.test(navHref) || /登录/.test(navText)) return null;
    const myId = _userIdFromHref(navHref);

    // Two-page safety: refuse the sidebar card when the current page is
    // someone else's /user/<id> page. Detect this by comparing the page
    // path with the id we got from nav-mine.
    const isOwnUserPage = !!currentPath && new RegExp(`^/user/${myId}(?:/|$|\\?|#)`).test(currentPath);
    const isOtherUserPage = !!currentPath && /^\/user\/\d+/.test(currentPath) && !isOwnUserPage;
    if (isOtherUserPage) {
      // Sidebar card is the OTHER user. Only trust nav-mine.
      return {
        id: myId,
        nickname: null,
        avatarUrl: null,
        avatarIsDicebear: false,
        profileUrl: navHref ? absUrl(navHref) : null,
        rank: null,
        points: null,
        isLoggedIn: true,
        source: "nav-mine-only",
      };
    }

    // Home / own profile: read the sidebar card.
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
    return {
      id: myId,
      nickname: nickname || null,
      avatarUrl: avatarUrl || null,
      avatarIsDicebear,
      profileUrl: navHref ? absUrl(navHref) : null,
      rank: rankText || null,
      points,
      isLoggedIn: true,
      source: avatarImg ? "user-card" : "user-card-visitor",
    };
  }

  // 2) Fallback: any avatar-profile-link (last resort, isLoggedIn=false).
  const link = $(SELECTORS.anyAvatarLink);
  if (link) {
    const href = attr(link, "href") || "";
    const img = $("img", link);
    const id = _userIdFromHref(href);
    if (id) {
      return {
        id,
        nickname: attr(img, "alt") || null,
        avatarUrl: src(img) || null,
        avatarIsDicebear: !!img && /dicebear/i.test(src(img) || ""),
        profileUrl: absUrl(href),
        isLoggedIn: false,
        source: "avatar-link",
      };
    }
  }
  return null;
}

export function _userIdFromHref(href) {
  const m = (href || "").match(/^\/user\/(\d+)/);
  return m ? Number(m[1]) : null;
}
