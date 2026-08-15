#!/usr/bin/env node
// describe-image.mjs — "read" a screenshot with a vision model so agents
// without image input can see it.
//
// Uses Zhipu GLM-4V (OpenAI-compatible chat/completions). API key comes
// from env ZHIPU_API_KEY or a gitignored .env in the repo root.
//
// Usage:
//   node scripts/describe-image.mjs <image.png> [--model glm-4v-flash] [--prompt "描述这张截图"]
//
// The image is sent as a base64 data URL; nothing is stored server-side.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- key resolution: env -> .env -> error ---
function loadEnv() {
  const envFile = join(ROOT, ".env");
  if (!existsSync(envFile)) return {};
  const out = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function getKey() {
  const env = loadEnv();
  const key = process.env.ZHIPU_API_KEY || env.ZHIPU_API_KEY;
  if (!key) {
    console.error("ZHIPU_API_KEY not found. Set it in the environment or create .env with:");
    console.error("  ZHIPU_API_KEY=<your zhipu key>");
    process.exit(2);
  }
  return key;
}

// --- args ---
const args = process.argv.slice(2);
const imagePath = args.find((a) => !a.startsWith("--"));
const model = (() => {
  const i = args.indexOf("--model");
  return i >= 0 && args[i + 1] ? args[i + 1] : "glm-4v-flash"; // free tier
})();
const prompt = (() => {
  const i = args.indexOf("--prompt");
  return i >= 0 && args[i + 1] ? args[i + 1] : "请详细描述这张截图的内容：布局、元素、文字、颜色、可能的异常。用中文回答。";
})();

if (!imagePath || !existsSync(imagePath)) {
  console.error("Usage: node scripts/describe-image.mjs <image.png> [--model glm-4v-flash] [--prompt ...]");
  process.exit(1);
}

// --- send ---
const dataUrl = "data:image/png;base64," + readFileSync(imagePath).toString("base64");

const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + getKey(),
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.3,
  }),
});

const body = await res.json();
if (!res.ok) {
  console.error("API error", res.status, JSON.stringify(body).slice(0, 500));
  process.exit(1);
}
const text = body.choices?.[0]?.message?.content ?? "(empty response)";
console.log("[" + model + "] " + imagePath + "\n" + "---\n" + text);
