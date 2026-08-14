import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const EXT_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";
const SCRIPT_UUID = "e10006ff-2f59-4070-b76f-99437ad060c4";

const page = await b.contexts()[0].newPage();
const editorUrl = `chrome-extension://${EXT_ID}/options.html#nav=${SCRIPT_UUID}+editor`;
console.log("Navigating to editor...");
await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Set the new code
const newCode = readFileSync("dist/linux-sb-suite.user.js", "utf8");
console.log(`Setting code (${newCode.length} bytes)...`);
await page.evaluate((code) => {
  const cmEl = document.querySelector(".CodeMirror");
  if (cmEl && cmEl.CodeMirror) {
    cmEl.CodeMirror.setValue(code);
  }
}, newCode);
console.log("Code set");

// Click the SCRIPT-SPECIFIC Settings tab
// The correct tab ID is: div_dGFiX3NldHRpbmdzX2NvbnRlbnRkZXRhaWxzZTEwMDA2ZmYyZjU5NDA3MGI3NmY5OTQzN2FkMDYwYzQ
const settingsTabId = "div_dGFiX3NldHRpbmdzX2NvbnRlbnRkZXRhaWxzZTEwMDA2ZmYyZjU5NDA3MGI3NmY5OTQzN2FkMDYwYzQ";
console.log("Clicking script-specific Settings tab...");
await page.click(`#${settingsTabId}`);
await new Promise(r => setTimeout(r, 2000));

// Check if the save button is now visible
const saveBtnInfo = await page.evaluate(() => {
  const btn = document.querySelector("input[name='save_button']");
  if (!btn) return { found: false };
  return {
    found: true,
    visible: btn.offsetParent !== null,
    id: btn.id,
    rect: btn.getBoundingClientRect(),
  };
});
console.log("Save button:", JSON.stringify(saveBtnInfo));

if (saveBtnInfo?.visible) {
  console.log("Clicking Save...");
  await page.click(`#${saveBtnInfo.id}`);
  await new Promise(r => setTimeout(r, 5000));
  console.log("After save URL:", page.url());
} else {
  console.log("Save button still not visible, force clicking...");
  await page.evaluate(() => {
    const btn = document.querySelector("input[name='save_button']");
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 5000));
  console.log("After force click URL:", page.url());
}

// Verify the save
const verifyUrl = `chrome-extension://${EXT_ID}/options.html#nav=${SCRIPT_UUID}+editor`;
await page.goto(verifyUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

const verify = await page.evaluate(() => {
  const cmEl = document.querySelector(".CodeMirror");
  if (cmEl && cmEl.CodeMirror) {
    const val = cmEl.CodeMirror.getValue();
    return { length: val.length, hasFix: val.includes("(el || doc).querySelector(sel)") };
  }
  return { error: "no CodeMirror" };
});
console.log("Verify:", JSON.stringify(verify));

await b.close();
