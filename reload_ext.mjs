import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");

const page = await b.contexts()[0].newPage();

// Navigate to the Tampermonkey extension detail page
await page.goto("chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo", { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Look for the Reload button
const reloadInfo = await page.evaluate(() => {
  // Try to find reload button in shadow DOM
  const manager = document.querySelector("extensions-manager");
  if (manager && manager.shadowRoot) {
    const detailView = manager.shadowRoot.querySelector("extensions-detail-view");
    if (detailView && detailView.shadowRoot) {
      const buttons = detailView.shadowRoot.querySelectorAll("cr-button, button");
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text === "Reload" || text === "重新加载") {
          return { found: true, text, id: btn.id };
        }
      }
    }
  }
  return { found: false, bodyText: document.body.innerText.substring(0, 500) };
});
console.log("Reload info:", JSON.stringify(reloadInfo));

// Try clicking via shadow DOM traversal
if (reloadInfo.found) {
  await page.evaluate(() => {
    const manager = document.querySelector("extensions-manager");
    const detailView = manager?.shadowRoot?.querySelector("extensions-detail-view");
    const buttons = detailView?.shadowRoot?.querySelectorAll("cr-button, button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Reload" || btn.textContent.trim() === "重新加载") {
        btn.click();
        break;
      }
    }
  });
  console.log("Reload clicked");
  await new Promise(r => setTimeout(r, 5000));
}

// Also try to find and click the update button if present
await page.evaluate(() => {
  const manager = document.querySelector("extensions-manager");
  const detailView = manager?.shadowRoot?.querySelector("extensions-detail-view");
  const buttons = detailView?.shadowRoot?.querySelectorAll("cr-button, button");
  for (const btn of buttons) {
    const text = btn.textContent.trim();
    if (text === "Update" || text === "更新") {
      btn.click();
      console.log("Update clicked");
      break;
    }
  }
});

await new Promise(r => setTimeout(r, 5000));

// Now test on linux.sb
await page.goto("https://linux.sb/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Clear cache
await page.evaluate(() => {
  const uw = window.unsafeWindow || window;
  if (uw.LSB && uw.LSB.storage) {
    uw.LSB.storage.del("user.current");
  }
});

// Reload
await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

const result = await page.evaluate(() => {
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
  
  return { hasFix, sidebarAvatar, panelAvatar, match: sidebarAvatar === panelAvatar };
});
console.log("Result:", JSON.stringify(result, null, 2));

if (result.match) {
  console.log("\n=== SUCCESS! ===");
} else {
  console.log("\n=== Still broken ===");
}

await b.close();
