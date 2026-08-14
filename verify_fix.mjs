import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");

let page = null;
for (const ctx of b.contexts()) {
  for (const p of ctx.pages()) {
    if (p.url().includes("linux.sb")) { page = p; }
  }
}
if (!page) {
  page = await b.contexts()[0].newPage();
}

console.log("Navigating to linux.sb...");
await page.goto("https://linux.sb/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Check if the fix is active
const hasFix = await page.evaluate(() => {
  const scripts = document.querySelectorAll("script");
  for (const s of scripts) {
    if (s.textContent && s.textContent.includes("(el || doc).querySelector(sel)")) {
      return true;
    }
  }
  return false;
});
console.log("Script has fix:", hasFix);

// Clear cache
await page.evaluate(() => {
  const uw = window.unsafeWindow || window;
  if (uw.LSB && uw.LSB.storage) {
    uw.LSB.storage.del("user.current");
  }
});
console.log("Cache cleared");

// Reload
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Check avatar
const result = await page.evaluate(() => {
  const card = document.querySelector(".sidebar-card.user-card");
  const sidebarImg = card ? card.querySelector("img.avatar-img") : null;
  const sidebarAvatar = sidebarImg ? (sidebarImg.src || sidebarImg.getAttribute("src")) : null;
  
  const panelEl = document.querySelector("#lsb-panel");
  const panelAvatar = panelEl ? panelEl.querySelector("img[data-lsb='avatar']")?.src : null;
  
  const uw = window.unsafeWindow || window;
  const stored = uw.LSB ? uw.LSB.storage.get("user.current") : null;
  
  return {
    sidebarAvatar,
    panelAvatar,
    storageAvatar: stored?.avatarUrl,
    storageSource: stored?.source,
    match: sidebarAvatar === panelAvatar,
  };
});
console.log("Result:", JSON.stringify(result, null, 2));

if (result.match) {
  console.log("\n=== AVATAR FIX VERIFIED! ===");
} else {
  console.log("\n=== AVATAR STILL MISMATCHED ===");
}

await b.close();
