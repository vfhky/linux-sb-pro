import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const EXT_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";

const page = await b.contexts()[0].newPage();
await page.goto(`chrome-extension://${EXT_ID}/options.html#nav=utils`, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Expand the Import from URL section
await page.evaluate(() => {
  const div = document.querySelector("#div_dXRpbHNfdXRpbHM_ur");
  if (div) {
    // Click on the section header
    const legend = div.querySelector("legend");
    if (legend) legend.click();
    else div.click();
  }
});
await new Promise(r => setTimeout(r, 2000));

// Fill the URL
await page.fill("#input_dXRpbHNfdXRpbHM_url", "https://update.greasyfork.org/scripts/590905.user.js");
console.log("URL filled");

// Check all install-related buttons
const allBtns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type=button], button"))
    .filter(b => b.offsetParent !== null)
    .map(b => ({
      text: b.value || b.textContent.trim(),
      id: b.id,
      visible: true,
    }));
});
console.log("Visible buttons:", JSON.stringify(allBtns, null, 2));

// Click the Install button for URL import
const installBtn = await page.$("#input_dXRpbHNfdXRpbHNfaV91cmw_bu");
if (installBtn) {
  const visible = await installBtn.isVisible();
  console.log("Install button found, visible:", visible);
  if (visible) {
    await installBtn.click();
    console.log("Install clicked");
    await new Promise(r => setTimeout(r, 8000));
    console.log("After install URL:", page.url());
  } else {
    // Force click
    await installBtn.click({ force: true });
    console.log("Force clicked Install");
    await new Promise(r => setTimeout(r, 8000));
    console.log("After force click URL:", page.url());
  }
} else {
  console.log("Install button NOT found");
}

await b.close();
