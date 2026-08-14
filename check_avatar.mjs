import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");

let page = null;
for (const ctx of b.contexts()) {
  for (const p of ctx.pages()) {
    if (p.url().includes("linux.sb") || p.url().includes("linux.bi")) { page = p; }
  }
}
if (!page) {
  page = await b.contexts()[0].newPage();
}

console.log("Navigating to linux.sb...");
await page.goto("https://linux.sb/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));
console.log("Page URL:", page.url());

// Check sidebar card avatar
const sidebar = await page.evaluate(() => {
  const card = document.querySelector(".sidebar-card.user-card");
  if (!card) return { error: "no sidebar card" };
  const img = card.querySelector("img.avatar-img");
  const nameEl = card.querySelector(".user-name");
  return {
    avatarSrc: img ? (img.src || img.getAttribute("src")) : null,
    nickname: nameEl ? nameEl.textContent.trim() : null,
  };
});
console.log("Sidebar card:", JSON.stringify(sidebar));

// Check the LSB panel avatar
const panel = await page.evaluate(() => {
  const panelEl = document.querySelector("#lsb-panel");
  if (!panelEl) return { error: "no LSB panel found" };
  const avatarEl = panelEl.querySelector("img[data-lsb='avatar']");
  return {
    avatarSrc: avatarEl ? avatarEl.src : null,
    panelVisible: panelEl.offsetParent !== null,
  };
});
console.log("Panel:", JSON.stringify(panel));

// Check LSB storage
const storage = await page.evaluate(() => {
  if (!window.LSB) return { error: "LSB not found" };
  try {
    return { user: window.LSB.storage.get("user.current") };
  } catch(e) {
    return { error: e.message };
  }
});
console.log("LSB storage:", JSON.stringify(storage));

// Check if the script has the fix
const hasFix = await page.evaluate(() => {
  // Check if the readUserFromDocument function uses the scoped $
  const scripts = document.querySelectorAll("script");
  for (const s of scripts) {
    if (s.textContent && s.textContent.includes("(el || doc).querySelector(sel)")) {
      return true;
    }
  }
  return false;
});
console.log("Script has fix:", hasFix);

await page.screenshot({ path: "screenshot_lsb_test.png", fullPage: false });
console.log("Screenshot saved");

await b.close();
