import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const EXT_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";
const SCRIPT_UUID = "e10006ff-2f59-4070-b76f-99437ad060c4";

const page = await b.contexts()[0].newPage();

// Navigate to the script's Settings tab
console.log("Navigating to script Settings...");
await page.goto(`chrome-extension://${EXT_ID}/options.html#nav=${SCRIPT_UUID}+settings`, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Click "Check for userscript updates"
const updateBtn = await page.$("input[id*='c3RhcnRfdXBkYXRl']");
if (updateBtn) {
  const visible = await updateBtn.isVisible();
  console.log("Update button visible:", visible);
  if (visible) {
    console.log("Clicking Check for updates...");
    await updateBtn.click();
    await new Promise(r => setTimeout(r, 10000));
    console.log("After update URL:", page.url());
  } else {
    console.log("Update button not visible, force clicking...");
    await page.evaluate(() => {
      const btn = document.querySelector("input[id*='c3RhcnRfdXBkYXRl']");
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 10000));
    console.log("After force click URL:", page.url());
  }
} else {
  console.log("Update button not found");
}

// Check the script info to see if version changed
const scriptInfo = await page.evaluate(() => {
  const body = document.body.innerText;
  const versionMatch = body.match(/Version:\s*(\S+)/);
  const updateMatch = body.match(/Last updated:\s*(.+)/);
  return {
    version: versionMatch?.[1],
    lastUpdated: updateMatch?.[1],
  };
});
console.log("Script info:", JSON.stringify(scriptInfo));

// Now check on linux.sb
console.log("\nChecking linux.sb...");
await page.goto("https://linux.sb/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 8000));

// Clear cache and reload
await page.evaluate(() => {
  const uw = window.unsafeWindow || window;
  if (uw.LSB && uw.LSB.storage) {
    uw.LSB.storage.del("user.current");
  }
});
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
