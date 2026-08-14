import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const EXT_ID = "dhdgffkkebhmkfjojejmpbldmpobfkfo";
const SCRIPT_UUID = "e10006ff-2f59-4070-b76f-99437ad060c4";

const page = await b.contexts()[0].newPage();
await page.goto(`chrome-extension://${EXT_ID}/options.html#nav=${SCRIPT_UUID}+editor`, { waitUntil: "domcontentloaded", timeout: 10000 });
await new Promise(r => setTimeout(r, 5000));

// Get the full script content
const content = await page.evaluate(() => {
  const cmEl = document.querySelector(".CodeMirror");
  if (cmEl && cmEl.CodeMirror) {
    return cmEl.CodeMirror.getValue();
  }
  return "no CodeMirror";
});
console.log("Content length:", content.length);
console.log("Content:");
console.log(content);

await b.close();
