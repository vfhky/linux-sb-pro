import assert from "node:assert/strict";
import { createI18n } from "../core/i18n.mjs";

export default async function run() {
  const i18n = createI18n({ locale: "zh-CN", fallback: "en" });
  i18n.add({ "panel.title": { zh: "面板", en: "Panel" }, "common.close": { zh: "关闭", en: "Close" } });
  assert.equal(i18n.t("panel.title", "zh-CN"), "面板");
  assert.equal(i18n.t("panel.title", "en"), "Panel");
  assert.equal(i18n.t("panel.title", "ja"), "Panel");
  assert.equal(i18n.t("missing", "en"), "missing");
  i18n.setLocale("en");
  assert.equal(i18n.t("common.close"), "Close");
}
