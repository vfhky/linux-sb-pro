import { chromium } from "playwright";

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");

// Try to find Tampermonkey in extension pages
const pages = [];
for (const ctx of b.contexts()) {
  for (const p of ctx.pages()) {
    pages.push(p.url());
  }
}
console.log("All pages:", pages);

// Try CDP to get targets
const cdpSession = await b.newBrowserCDPSession();
const targets = await cdpSession.send("Target.getTargets");
console.log("Targets:");
for (const t of targets.targetInfos) {
  console.log(`  ${t.type}: ${t.url} (${t.title})`);
}

// Find Tampermonkey service worker
const tmSw = targets.targetInfos.find(t => t.type === "service_worker" && t.url.includes("tampermonkey"));
if (tmSw) {
  console.log("Found TM service worker:", tmSw.targetId);
  
  // Attach to it
  const { sessionId } = await cdpSession.send("Target.attachToTarget", {
    targetId: tmSw.targetId,
    flatten: true,
  });
  console.log("Attached, sessionId:", sessionId);
  
  // Try to reload the extension
  await cdpSession.send("Runtime.evaluate", {
    expression: `chrome.runtime.reload()`,
    contextId: 1,
  });
  console.log("Reload command sent");
}

await cdpSession.detach();
await b.close();
