import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const EXT_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";

const page = await b.contexts()[0].newPage();

// Step 1: Delete script via multi-select on scripts list
console.log("Step 1: Deleting script from list...");
await page.goto(`chrome-extension://${EXT_ID}/options.html#nav=scripts`, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Find and click the checkbox for the linux.sb script
const checkboxClicked = await page.evaluate(() => {
  const rows = document.querySelectorAll("tr");
  for (const row of rows) {
    if (row.textContent.includes("linux.sb")) {
      const cb = row.querySelector("input[type=checkbox]");
      if (cb) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        return { clicked: true, id: cb.id };
      }
    }
  }
  return { clicked: false };
});
console.log("Checkbox:", JSON.stringify(checkboxClicked));

await new Promise(r => setTimeout(r, 2000));

// Click the multi-select actions dropdown and select Delete
const deleteAction = await page.evaluate(() => {
  // Look for the actions dropdown
  const select = document.querySelector("select[id*='c2VsZWN0X3Ntcy']");
  if (select) {
    // Find the Delete option
    for (const opt of select.options) {
      if (opt.textContent.includes("Delete")) {
        select.value = opt.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return { selected: true, text: opt.textContent };
      }
    }
  }
  return { selected: false };
});
console.log("Delete action:", JSON.stringify(deleteAction));

await new Promise(r => setTimeout(r, 2000));

// Click the Start button to execute the action
const startBtn = await page.$("#input_TXVsdGlTZWxlY3RCdXR0b25fc3RhcnRfYnV0dG9u_bu");
if (startBtn) {
  console.log("Clicking Start...");
  await startBtn.click();
  await new Promise(r => setTimeout(r, 5000));
  console.log("After Start URL:", page.url());
}

// Check if script is gone
const hasScript = await page.evaluate(() => document.body.innerText.includes("linux.sb"));
console.log("Script still exists:", hasScript);

// Step 2: If deleted, install from GreasyFork
if (!hasScript) {
  console.log("\nStep 2: Installing from GreasyFork...");
  await page.goto("https://greasyfork.org/zh-CN/scripts/590905-linux-sb-%E5%8A%A9%E6%89%8B-linux-sb-suite", { waitUntil: "load", timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  
  const installLink = await page.$("a.install-link");
  if (installLink) {
    const href = await installLink.getAttribute("href");
    console.log("Install href:", href);
    
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 8000));
    console.log("After install URL:", page.url());
    
    // Handle Tampermonkey install page
    if (page.url().includes("tampermonkey")) {
      const btns = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("button, input"))
          .filter(b => /install|安装|更新|update/i.test(b.textContent || b.value || ""))
          .map(b => ({ text: b.textContent || b.value, id: b.id }));
      });
      console.log("Buttons:", JSON.stringify(btns));
      
      if (btns.length > 0) {
        await page.click(`#${btns[0].id}`);
        await new Promise(r => setTimeout(r, 5000));
        console.log("After button click URL:", page.url());
      }
    }
  }
}

await b.close();
