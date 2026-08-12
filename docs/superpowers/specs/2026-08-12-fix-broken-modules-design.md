# Spec: 修复 linux.sb 站点选择器错位（1.1.3）

**Date:** 2026-08-12
**Status:** Draft (pending user review)
**Repo:** `E:\gitHub\linux-sb-pro`
**Scope:** 在已发布的 1.1.2 基础上，把脚本里 4 个失效模块的选择器 / 端点改对。
**Supersedes:** `2026-08-12-notif-panel-polish-design.md` 里的 notif / signin 相关部分——本 spec 是它的补丁版，但只动 4 个文件、零架构变化。

## 1. Goal

把 1.1.2 上"装上去但实际没反应"的 4 个问题修掉，让脚本对当前站点版本真正工作：

1. **每日签到**：选择器全错（`.daily-signin` 应该是 `.daily-checkin-card`），按钮选择器也不对，签到 POST 没有接到 `core/poller`，"自动签到"开关开了等于没开。
2. **未读消息**：端点全错（`/notifications` 等 3 个候选全是 404），实际端点是 `/user/<myId>?tab=notifications`，且没有"未读"显式数字，需要靠"本地是否看过"算。
3. **访客态头像**：选择器 `.user-avatar-big img.avatar-img` 在访客态是 0 匹配（访客没有 img 元素，是 div + 字母占位），脚本拿不到头像 URL，pill 头像是断图。
4. **积分显示**：站点有完整的积分体系（`笔友 · 积分 177` 格式），脚本完全没碰。Tier 1 范围内只是**在 user 模块里把积分数据 parse 出来暴露给其他模块**，不在 pill 上展示（展示留给 Tier 2）。

约束：
- 严格 **read-only** 政策不变：唯一的写操作是 `/daily_checkin` POST（站点已有的用户行为），其他都不动。
- 不动 `core/` / `lib/` 的对外 API，只调整 `linux-sb-suite.user.js` 里模块内部对站点的具体选择器。
- 不新增依赖，不改 `build.mjs`。
- 数据驱动原则保持：选择器集中放在 `api/linuxSb.selectors`（已经在 L363-385），新增/调整都只动这一处。

## 2. Non-Goals

- 不做积分 pill 显示（Tier 2）。
- 不做 @提及高亮（Tier 2）。
- 不做"未读主题通知"（Tier 2）。
- 不做站点级深色模式（Tier 3）。
- 不做快捷键（Tier 3）。
- 不动 `core/settings` / `core/i18n` / `core/css` / `core/palettes` / `core/dom-sections` / `core/poller`。
- 不重写模块，仅就地改选择器。
- 不重命名 `signin` 模块（保持兼容；以后可以慢慢演化为 `points` 模块，但不在本 spec）。

## 3. Architecture

本 spec 不引入新模块、不改依赖关系、不改数据流。**纯选择器/端点修复 + 1 个新 lib 文件**。

### 3.1 改动清单

| 文件 | 改动 | 行数估计 |
|---|---|---|
| `linux-sb-suite.user.js` (`api/linuxSb.selectors`) | 调整 5-7 个 selector，新增 2 个 | ~15 行 |
| `linux-sb-suite.user.js` (`module: signin`) | 修按钮 selector、加积分 parse、把签到 POST 接到 `core/poller`、处理 CSRF 失效重取 | ~60 行 |
| `linux-sb-suite.user.js` (`module: notif`) | 端点改 `[/user/, /search]`、加 userId 解析、`notif-parse` 改 selector | ~40 行 |
| `linux-sb-suite.user.js` (`module: user`) | 加访客态头像 fallback、`积分` parse 暴露 `user.info.points` | ~20 行 |
| `lib/checkin-fetch.mjs` | **新文件**，纯 ESM，单一函数 `doCheckin(http, csrf, apiBase)` POST `/daily_checkin` 并返回替换后的卡片 HTML。**这里有 Node 可跑的纯函数**便于单测 | ~50 行 |
| `lib/checkin-parse.mjs` | **新文件**，纯 ESM，输入 `.daily-checkin-card` 节点（HTML 字符串），返回 `{ status: "pending"\|"done"\|"unknown", streakDays, totalDays }` | ~40 行 |
| `lib/notif-parse.mjs` | selector 从"找 heading + list class"改成"找 `li.post-item.notification-item`"，新增按 `.notification-kind` 分类 | ~30 行 |
| `test/checkin-parse.test.mjs` | **新文件**，6-8 个 case | ~80 行 |
| `test/notif-parse.test.mjs` | 调整已有 case 用新的 selector；新增"提及"和"系统"分类 case | ~30 行 |
| `lib/build-fixture.mjs` | 不需要改（gen-fixtures 会更新） |
| `scripts/gen-fixtures.mjs` | 加 1 行导出新 fixture 文件 | ~5 行 |
| `test/fixtures/daily-checkin-pending.html` | **新文件**，本地保存的待签到 HTML | 抓一份 |
| `test/fixtures/daily-checkin-done.html` | **新文件**，本地保存的已签到 HTML | 抓一份 |
| `test/fixtures/user-notifications.html` | **新文件**，本地保存的通知 tab HTML | 抓一份 |
| `test/fixtures/user-card-logged-in.html` | **新文件** | 抓一份 |
| `test/fixtures/user-card-visitor.html` | **新文件** | 抓一份 |
| `.build-meta.json` | `version: "1.1.2" -> "1.1.3"` | 1 行 |
| `README.md` | 选做：补一句"1.1.3 修了一组选择器，之前没反应的签到/通知现在能用了" | 1-2 行 |

**总计**：~370 行新增/修改，6 个新文件（含 fixtures）。

### 3.2 选择器修复对照表

所有改动都集中在 `api/linuxSb.selectors`（`linux-sb-suite.user.js` L363-385）以及 `signin/notif/user` 模块内部。

| 用途 | 现状（错的） | 改成 |
|---|---|---|
| 签到卡片 | `.sidebar-card.daily-checkin` | `.sidebar-card.daily-checkin-card` |
| 签到副标题（待签/已签）| `.daily-checkin-sub` | ✅ 不变 |
| 签到徽章 | 无 | 新增 `.daily-checkin-badge`（待签/已签）|
| 签到按钮 | `button[class*="signin"], button[class*="checkin"], a[class*="signin"]` | `form.post-action-form[action="/daily_checkin"] button[type="submit"]` |
| 通知容器 | `[class*="notif-list"], [class*="notif-"]`（按 notif-parse 内部用） | `li.post-item.notification-item` |
| 通知类型 | 无 | `.notification-kind`（提及 / 回复 / 系统）|
| 通知内容 | 无 | `.notification-content` |
| 访客态头像 | `.user-avatar-big img.avatar-img`（visitor 没有 img）| 加 fallback：先 img，没有就 `div.user-avatar-big`，取首字母 |
| 用户 ID 抓取 | 隐式：avatar link href | 显式：`.user-avatar-big` 的 `href` 解析出 `/user/(\d+)`，存在 `user.info.id` |
| 积分 | 未 parse | `.user-rank` 文本中 `积分 (\d+)`，存 `user.info.points` |
| 通知端点 | `/notifications`, `/notice`, `/user/notifications` | `/user/<id>?tab=notifications`（**注意：必须在 `notif` 模块 init 时拿到 `user.info.id` 后再 resolve**） |

### 3.3 `signin` 模块改造（核心）

当前 `signin` 模块（L616-770）只做选择器检查 + 一个 placeholder init，**没有任何"自动签到"逻辑**。本次改造让"自动签到"开关真生效。

数据流：

```
[settings]      signin.auto === true
    ↓
[signin]        init()  →  if user.info.id is set, schedule checkin check
    ↓
[core/poller]   5 分钟一次（间隔长一点，签到一天一次）
    ↓
[onTick]        if (.daily-checkin-badge) text is "待签到"
                    POST /daily_checkin (with _csrf from current page)
                    parse response → update local state
    ↓
[events]        emit "signin:status-changed" { status, streakDays, totalDays, awardedPoints? }
    ↓
[ui module]     暂不接（Tier 1 不做 pill 显示；只在控制台 log 一行）
```

**CSRF 处理**：实测发现站点的 `_csrf` token 在所有带 form 的页面上**值相同**（首页、帖子页等都是 `755f298186dc8ea...`），是 session 级 token。通知 tab 页（`/user/<id>?tab=notifications`）只有搜索 form，**没有 csrf 字段**。

策略：每次签到前从**当前页面**的 `<input name="_csrf">` 取值；如果当前页面没有 csrf（用户在通知 tab），本轮跳过，等下一个 5min tick。**不**主动 GET 首页去拿 csrf——避免无谓的页面加载。

**POST 失败处理**：
- 网络错误（`fetch` reject） → log + 不重试
- HTTP 200 但响应里 badge 仍是"待签到" → log + 不重试（可能是 CSRF 失效了，下次自动用最新 csrf）
- HTTP 200 + badge 变"已签到" → 标记完成

**关键安全点**：只在 `user.info.id` 存在、`signin.auto === true`、badge 是"待签到"、距离上次成功签到 ≥ 20 小时（防双重签到）时才 POST。

### 3.4 `notif` 模块改造

当前端点全 404，改为：

```js
notif: {
  // 单端点，因为需要 userId 参数化；通过 (apiBase + "/user/" + userId + "?tab=notifications") 拼
  candidates: ["/user/?tab=notifications"],  // 占位，实际由 notif 模块在 init 时把 userId 注入
  ...
}
```

**但 config 是静态对象**——不能动态注入 userId。两种选择：

**选项 A（推荐）**：把 `notif` 模块的 endpoint resolve 从 `config.notif.candidates` 抽出来，模块内部基于 `user.info.id` 构造。`config.notif.candidates` 退化为"可选备用探测路径"，主端点由模块代码生成。

```js
// module: notif
const endpoint = `${config.site.apiBase}/user/${user.info.id}?tab=notifications`;
```

简单粗暴，但违反了"config 驱动"原则（端点写死在代码里）。

**选项 B（更工程化）**：在 `config.notif` 里加一个 `endpoint(userId)` 函数而不是字符串数组：

```js
notif: {
  candidates: [],  // 留空
  endpoint(userId) { return `${LSB.config.site.apiBase}/user/${userId}?tab=notifications`; },
  ...
}
```

代码侧：`notif` 模块调用 `config.notif.endpoint(user.info.id)`。

**选 B**——和"数据驱动"原则一致，未来站点改 URL 也只动 config 一行。

`notif-parse.mjs` 同步改造：

```js
// 旧: 找 h\d "通知" 标题
// 新: 找 li.post-item.notification-item
function extractNotifications(html) {
  const items = [];
  const re = /<li\b[^>]*class\s*=\s*["'][^"']*\bnotification-item\b[^"']*["'][\s\S]*?<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    const kindMatch = block.match(/class\s*=\s*["'][^"']*\bnotification-kind\b[^"']*["'][^>]*>([\s\S]*?)<\//);
    const contentMatch = block.match(/class\s*=\s*["'][^"']*\bnotification-content\b[^"']*["'][^>]*>([\s\S]*?)<\//);
    const linkMatch = block.match(/<a\b[^>]*href\s*=\s*["']([^"']+)/i);
    if (!contentMatch) continue;
    items.push({
      kind: kindMatch ? stripTags(kindMatch[1]).trim() : "system",
      title: stripTags(contentMatch[1]).trim().slice(0, 120),
      url: linkMatch ? linkMatch[1] : null,
    });
    if (items.length >= MAX_LIST) break;
  }
  return items;
}
```

`unread` 字段在 HTML 里没有显式数字。**新策略**：用户进入通知 tab 后，本地记一个 `seenNotifIds: Set` 存到 `GM_setValue('lsb:notif:seenIds', JSON.stringify([...]))`；`unread = total - seen.size`。进入 `/user/<id>?tab=notifications` 页面时由 user 模块的路由 hook 自动 mark-seen。**这是 1.1.4 的事**，本 spec 暂不实现，`unread` 字段先固定返回 `list.length`（最简可用）。

### 3.5 `user` 模块改造

`user` 模块（L461-611）已经在 parse user card 了，但有两个缺口：

1. 访客态 avatar selector 不对
2. 积分字段没 parse

新增字段到 `user.info`：

```js
{
  id: "16056",          // 从 a.user-avatar-big href 解析
  name: "myss",         // a.user-name text
  rank: "笔友",         // 从 .user-rank text "笔友 · 积分 177" 拆分
  points: 177,          // 从 .user-rank text 解析
  avatarUrl: "/app/avatars/bottts-neutral_24.svg"  // 登录态
                  || null,  // 访客态为 null
  isGuest: false,       // 已有
}
```

avatar selector 兜底链：

```js
function pickAvatar(card) {
  if (!card) return null;
  const link = card.querySelector("a.user-avatar-big");
  if (!link) return null;
  const img = link.querySelector("img.avatar-img");
  if (img && img.src) return img.src;
  // 访客态：div.user-avatar-big.visitor-avatar
  const div = link.querySelector("div.user-avatar-big") || card.querySelector("div.visitor-avatar");
  if (div) {
    const letter = (div.textContent || "").trim().slice(0, 1);
    return letter ? { kind: "letter", letter } : null;
  }
  return null;
}
```

`user.info.avatar` 改成 `{ url: string, kind: "url" } | { letter: string, kind: "letter" } | null`，下游 `ui` 模块渲染时按 `kind` 决定 img 元素 vs 文字占位。

### 3.6 数据流总结

无新数据流。下面是改动后的关键链路：

```
[user card parse]  → user.info.{id, name, rank, points, avatar, isGuest}
    ↓
[signin init]      if !isGuest && settings.signin.auto → poller.start()
[notif init]       if !isGuest → endpoint = config.notif.endpoint(user.info.id); poller.start()
[ui module]        暂不动 pill（Tier 2 才会把积分、未读数接进 UI）
```

## 4. Files Touched

新增：
- `lib/checkin-fetch.mjs`
- `lib/checkin-parse.mjs`
- `test/checkin-parse.test.mjs`
- `test/fixtures/daily-checkin-pending.html`
- `test/fixtures/daily-checkin-done.html`
- `test/fixtures/user-notifications.html`
- `test/fixtures/user-card-logged-in.html`
- `test/fixtures/user-card-visitor.html`

修改：
- `linux-sb-suite.user.js`（`api/linuxSb.selectors`、`module: signin`、`module: notif`、`module: user`）
- `lib/notif-parse.mjs`
- `test/notif-parse.test.mjs`
- `scripts/gen-fixtures.mjs`（加 1 行新 fixture 导出）
- `.build-meta.json`（version bump）
- `README.md`（可选，1-2 行变更说明）

不动：
- `core/*`（除 poller 已在用，不需要改）
- `build/*`
- `build.mjs`（inliner 自动找到新 lib 文件，alpha 排序加入）
- `lib/build-fixture.mjs`
- 其他模块

## 5. Testing Strategy

按 TDD（红 → 绿 → 重构）：

1. **先写 fixture**：用 9444 探针 `evaluate` 抓真实页面的 `.daily-checkin-card` / `li.notification-item` / `.sidebar-card.user-card` 的 `outerHTML`，落到 `test/fixtures/*.html`。
2. **先写 `checkin-parse.test.mjs`**（红）：测试 pending / done 两种状态、连续天数、累计天数、空卡片 4 个 case。跑测试，确认红。
3. **写 `lib/checkin-parse.mjs`**（绿）：最小实现。
4. **更新 `notif-parse.test.mjs`**：把现有的"找 heading"case 改成"找 `li.notification-item`"，加 kind 分类 case。
5. **写 `lib/notif-parse.mjs`**：实现。
6. **所有新 lib 通过测试**。
7. **再改 `linux-sb-suite.user.js` 里模块**：选择器改完，跑 `node build.mjs` 重新打包，肉眼 + 控制台验证。
8. **端到端手测**（用户在本机 Tampermonkey 装上 dist）：登录态打开 linux.sb，pill 显示，签到按钮点一下成功，红点出。
9. **CDP 同步**：commit + push + 走 raw.githubusercontent.com → Greasy Fork。

测试命令：`npm test` 仍然 10+N 个 case 全过。

## 6. Risks & Mitigations

| 风险 | 缓解 |
|---|---|
| `_csrf` 跨页面失效，签到失败 | 每次签到前从当前页 form 取最新 csrf；失败时下一轮自然重试 |
| 自动签到一天触发多次（重复请求） | `signin` 模块本地记 `lastCheckinAt` 到 GM，24h 内不再 POST |
| 用户没登录时 `notif` 模块启动就报"用户未登录" | `notif.init` 先等 `user:changed`，isGuest=true 时不启动 poller |
| 站点 selector 二次改名 | 选择器集中在 `api/linuxSb.selectors`，下次只改一处 |
| 1.1.2 已装用户升级到 1.1.3 后 GM 里的旧值（如果有）| 检查兼容：旧 key 都是 `lsb:signin:*`、`lsb:notif:endpoint` 等，新 key 不冲突 |
| `notif-parse` 改 selector 导致现有 1.1.2 fixture 失效 | 同步更新 fixture（一次到位） |
| 自动签到 POST 被站点风控 | 频率低（5min 一次 + 24h 防重 + 只在 badge 待签时触发）+ 跟用户正常操作完全一致，被风控概率极低 |

## 7. Acceptance Criteria

1. 登录态访问 `https://linux.sb/`，pill 头像显示（不是断图）。
2. pill 下方有可点的"立即签到"按钮，点了之后：
   - badge 从"待签到"变"已签到"
   - 连续天数 +1
   - 控制台 log 一行 `[signin] checked in, streak=N`
3. 启用"自动签到"开关后，5 分钟内没人操作，脚本后台 POST 一次签到（用 DevTools Network 能看到）。
4. 通知红点出现条件：notification tab 有未读（数量 = list 长度，1.1.4 再做精确 unread 计数）。
5. `npm test` 全过，新加的 `checkin-parse.test.mjs` 6+ case 全过。
6. `node build.mjs` 一次成功，dist 体积 < 80KB。
7. Greasy Fork 1.1.3 公开版本号 = `.build-meta.json` 里的 1.1.3。

## 8. Out of Scope (Deliberately Deferred)

- Tier 2 全部：积分 pill 显示、@提及高亮、未读主题通知、快捷链接镜像。
- Tier 3 全部：站点级深色模式、置顶帖折叠、快捷键、长帖阅读时间、广告过滤。
- 把 `signin` 模块重命名为 `points`。
- 把硬编码的 `/user/<id>?tab=notifications` 进一步抽象成路由表（等真有第二个端点再做）。
- Node-side e2e（用 jsdom 模拟整页）——目前只测 lib 解析 + selectors，模块集成靠手测。

## 9. Open Questions

（这一节在用户 review 阶段回答，spec 落地前清空。）

- Q1: 通知模块的 `unread` 字段本 spec 简化为 `list.length`，你接受吗？还是宁可 1.1.3 不上 notif，等 1.1.4 一起做"本地 seen 集合"？
- Q2: 访客态头像用首字母占位显示（pill 上显示 "P" / "M"），还是直接隐藏头像位置只显示"访客"？
- Q3: 自动签到间隔是 5 分钟还是 10 分钟？5 分钟更"自动化"，10 分钟更保守。