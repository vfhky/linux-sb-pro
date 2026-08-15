# 借签功能落地状态（2026-08-15）

基于两份调研报告（`2026-08-13-ldstatuspro-analysis.md` / `2026-08-13-nodeseek-pro-analysis.md`）
与《功能借鉴设计提案》的落地记录。所有实现保持**零外部依赖**原则。

## 本轮新增（1.2.2-dev）

| 功能 | 来源 | 文件 | 说明 |
|------|------|------|------|
| signinTips 漏签提醒条 | nodeseek §3 | `lib/signin-tips.mjs` + `signinTips` 模块 | 自动签到关闭且今天未签到时，页面顶部黄条；「立即签到」/「今天不提示」（日期级去重） |
| LRUCache | LDStatus §4 | `lib/lru-cache.mjs` | O(1) Map 实现；已接入 `user.readFromUserPage`（页内缓存，maxSize 10） |
| Notifier 里程碑通知 | LDStatus §3 | `lib/notifier.mjs` + `notifier` 模块 | 连续签到 7/30/100/365 天、累计 100/365/1000 天、积分 100/500/1000/5000；持久化 achieved map + 60s 限频；`GM_notification` |
| timeChinese 相对时间 | nodeseek | `lib/time-format.mjs` | 「刚刚/N 分钟前/N 小时前/N 天前」，超 7 天回退日期；纯函数待接 history 等 |

## 之前已落地（1.2.x）

- TabLeader 多 tab 协调（LDStatus §2）→ `lib/tab-leader.mjs` + `LSB.tabLeader`
- toast 四类型（nodeseek §2.3）→ `lib/toast.mjs`
- LDStatus 面板 token/配色、Panel 状态机 → `core/palettes.mjs`、ui 模块

## 明确不借鉴

- OAuth + CloudSync / Ticket / CDK / LDC / Melon / Follow（LDStatus，需后端或 Discourse 特有）
- aiComment / blockPosts / imageUpload / instantPage（nodeseek，依赖外部 Key/layui/违背只读原则）
- userRelation（站规风险）

## 测试

`test/lru-cache.test.mjs`、`test/notifier.test.mjs`、`test/signin-tips.test.mjs`（linkedom DOM 桩）、
`test/time-format.test.mjs` — 随 `npm test` 运行（当前 22 个测试文件）。
## 1.2.3 新增

| 功能 | 来源 | 落地 |
|------|------|------|
| match(ctx) 模块门禁 | nodeseek §2.6 | `LSB.register(name, factory, deps, match)`，init 前短路（已用于 notifier） |
| history 浏览历史 | nodeseek | `lib/history-store.mjs` + `history` 模块（面板 section + 相对时间） |
| visitedColor 已访问染色 | nodeseek | `visited` 模块：`a.post-title:visited`（零侵入、跟随主题） |
| 面板展开状态持久化 | LDStatus Panel 状态机 | `panel.open` 存储，跨页面保持 |
| 品牌图标 / 首字母头像徽标 | 自研 UI | 替换 stormkit 灰圆 icon 与 DiceBear 灰底头像 |
