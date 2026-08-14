import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const CDP_URL = "http://127.0.0.1:9222";
const DIST_PATH = "dist/linux-sb-suite.user.js";
const SCRIPT_ID = "590905";
const EDIT_URL = `https://greasyfork.org/zh-CN/scripts/${SCRIPT_ID}/versions/new`;

const b = await chromium.connectOverCDP(CDP_URL);

let page = null;
for (const ctx of b.contexts()) {
  for (const p of ctx.pages()) {
    if (p.url().includes("greasyfork")) { page = p; }
  }
}
if (!page) {
  page = await b.contexts()[0].newPage();
}

console.log(`Navigating to ${EDIT_URL}...`);
try {
  await page.goto(EDIT_URL, { waitUntil: "load", timeout: 60000 });
} catch (e) {
  console.log("Navigation may have timed out:", e.message);
}
console.log(`Current URL: ${page.url()}`);

await new Promise(r => setTimeout(r, 5000));

// Check for the code textarea
const hasCodeTA = await page.evaluate(() => {
  const ta = document.querySelector('textarea[name="script_version[code]"]');
  return ta ? { found: true, name: ta.name } : { found: false };
});
console.log("Code textarea:", JSON.stringify(hasCodeTA));

if (hasCodeTA.found) {
  const code = readFileSync(DIST_PATH, "utf8");
  console.log(`Updating with ${code.length} bytes...`);
  
  // Fill code
  await page.evaluate((newCode) => {
    const ta = document.querySelector('textarea[name="script_version[code]"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(ta, newCode);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
  }, code);
  console.log("Code filled");
  
  // Fill changelog
  await page.evaluate((changelog) => {
    const ta = document.querySelector('textarea[name="script_version[changelog]"]');
    if (ta) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      nativeSetter.call(ta, changelog);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, "v1.1.6 - Fix avatar scoped query: $() helper now accepts optional scope element so sidebar card avatar is read correctly");
  console.log("Changelog filled");
  
  // Click submit
  const submitClicked = await page.evaluate(() => {
    const btn = document.querySelector('input[type=submit][name="commit"]');
    if (btn) {
      btn.click();
      return { clicked: true, text: btn.value };
    }
    return { clicked: false };
  });
  console.log("Submit:", JSON.stringify(submitClicked));
  
  await new Promise(r => setTimeout(r, 5000));
  console.log(`After submit URL: ${page.url()}`);
  
  const success = !page.url().includes("/versions/new");
  if (success) {
    console.log("\n=== Greasy Fork update successful! ===");
  } else {
    console.log("\nUpdate may have failed.");
  }
} else {
  console.log("ERROR: Could not find code textarea");
}

await b.close();
