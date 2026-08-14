import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const EXT_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";
const SCRIPT_UUID = "e10006ff-2f59-4070-b76f-99437ad060c4";

const page = await b.contexts()[0].newPage();
const editorUrl = `chrome-extension://${EXT_ID}/options.html#nav=${SCRIPT_UUID}+editor`;
console.log("Opening editor...");
await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Paste the complete script
const newCode = readFileSync("dist/linux-sb-suite.user.js", "utf8");
console.log(`Pasting ${newCode.length} bytes...`);
await page.evaluate((code) => {
  const cmEl = document.querySelector(".CodeMirror");
  if (cmEl && cmEl.CodeMirror) {
    cmEl.CodeMirror.setValue(code);
  }
}, newCode);
console.log("Code pasted");

// Wait for CodeMirror to process
await new Promise(r => setTimeout(r, 3000));

// Switch to Settings tab and save
const settingsTabId = "div_dGFiX3NldHRpbmdzX2NvbnRlbnRkZXRhaWxzZTEwMDA2ZmYyZjU5NDA3MGI3NmY5OTQzN2FkMDYwYzQ";
console.log("Clicking Settings tab...");
await page.click(`#${settingsTabId}`);
await new Promise(r => setTimeout(r, 2000));

// Click Save button
const saveBtn = await page.$("#input_c2F2ZV9idXR0b25fZTEwMDA2ZmYtMmY1OS00MDcwLWI3NmYtOTk0MzdhZDA2MGM0_bu");
if (saveBtn) {
  const visible = await saveBtn.isVisible();
  console.log("Save button visible:", visible);
  if (visible) {
    console.log("Clicking Save...");
    await saveBtn.click();
    await new Promise(r => setTimeout(r, 5000));
    console.log("After save URL:", page.url());
  }
} else {
  console.log("Save button not found");
}

// Verify save by checking the editor again
console.log("Verifying save...");
await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

const verify = await page.evaluate(() => {
  const cmEl = document.querySelector(".CodeMirror");
  if (cmEl && cmEl.CodeMirror) {
    const val = cmEl.CodeMirror.getValue();
    return {
      length: val.length,
      hasFix: val.includes("(el || doc).querySelector(sel)"),
      version: val.match(/@version\s+(\S+)/)?.[1],
    };
  }
  return { error: "no CodeMirror" };
});
console.log("Verify:", JSON.stringify(verify));

await b.close();
