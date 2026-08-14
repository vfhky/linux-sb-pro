import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");

// Close all Tampermonkey options pages to avoid interference
for (const ctx of b.contexts()) {
  for (const p of ctx.pages()) {
    if (p.url().includes("tampermonkey") || p.url().includes("dhdgffkkebhmkfjojejmpbldmpobfkfo")) {
      console.log("Closing:", p.url());
      await p.close();
    }
  }
}

await new Promise(r => setTimeout(r, 3000));

// Now reload linux.sb
const linuxPage = await b.contexts()[0].newPage();
await linuxPage.goto("https://linux.sb/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Clear cache
await linuxPage.evaluate(() => {
  const uw = window.unsafeWindow || window;
  if (uw.LSB && uw.LSB.storage) {
    uw.LSB.storage.del("user.current");
  }
});

// Reload again
await linuxPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Check
const result = await linuxPage.evaluate(() => {
  const scripts = document.querySelectorAll("script");
  let hasFix = false;
  for (const s of scripts) {
    if (s.textContent && s.textContent.includes("(el || doc).querySelector(sel)")) {
      hasFix = true;
      break;
    }
  }
  
  const card = document.querySelector(".sidebar-card.user-card");
  const sidebarImg = card ? card.querySelector("img.avatar-img") : null;
  const sidebarAvatar = sidebarImg ? (sidebarImg.src || sidebarImg.getAttribute("src")) : null;
  
  const panelEl = document.querySelector("#lsb-panel");
  const panelAvatar = panelEl ? panelEl.querySelector("img[data-lsb='avatar']")?.src : null;
  
  const uw = window.unsafeWindow || window;
  const stored = uw.LSB ? uw.LSB.storage.get("user.current") : null;
  
  return {
    hasFix,
    sidebarAvatar,
    panelAvatar,
    storageAvatar: stored?.avatarUrl,
    match: sidebarAvatar === panelAvatar,
  };
});
console.log("Result:", JSON.stringify(result, null, 2));

if (result.match) {
  console.log("\n=== SUCCESS! Avatar fixed! ===");
} else {
  console.log("\n=== Still broken ===");
}

await b.close();
