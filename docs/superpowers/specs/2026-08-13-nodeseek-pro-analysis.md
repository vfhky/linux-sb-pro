# Nodeseek Pro 调研报告

- **脚本**: `Nodeseek Pro` (Greasy Fork #567109)
- **版本**: 1.0.8 (调研时)
- **源码规模**: 290,303 字节（约 4700 行）
- **目标站点**: `nodeseek.com`, `deepflood.com`
- **原始仓库**: 由 `caigg188` 等人维护（Vite + 模块化打包）

## 1. 功能清单（22 个内置 feature）

| ID                | 类别        | 功能 |
|-------------------|------------|------|
| `autoJump`        | 基础        | 外部链接重定向（`/link?url=...`）直接跳过 |
| `autoLoading`     | 基础        | 列表页无限滚动加载，按等级屏蔽 |
| `signIn`          | 基础        | 每日自动签到（`/api/attendance?random=`），日期级去重 |
| `signinTips`      | 基础        | 自动签到关闭时，在页面顶部插入醒目的黄底签到提示条 |
| `callout`         | 排版        | `> [!info]` / `> [!warning]` 等 Callout 块渲染 |
| `codeHighlight`   | 排版        | 集成 `highlight.js` |
| `commentShortcut` | 交互        | 评论区快捷键（J/K 上下、Shift+R 回复、/ 搜索） |
| `darkMode`        | 主题        | 跟随系统的暗色模式切换 |
| `history`         | 工具        | 本地浏览历史记录（localStorage）+ 抽屉面板 |
| `imageSlide`      | 排版        | 帖子内图片幻灯片浏览 |
| `instantPage`     | 性能        | 鼠标悬停预取下一页（prefetch） |
| `levelTag`        | 排版        | 用户等级标签（VIP / 高级 / 普通） |
| `menus`           | 工具        | TM 菜单命令（`GM_registerMenuCommand`） |
| `quickComment`    | 交互        | 自定义快捷回复模板（多组） |
| `aiComment`       | 实验        | AI 自动回帖（需自备 Key） |
| `smoothScroll`    | 体验        | 平滑滚动 |
| `userCardExt`     | 社交        | 鼠标悬停显示用户卡片浮层 |
| `inlineUserInfo`  | 社交        | 帖子作者区展示更多信息（关注数、注册时长） |
| `userRelation`    | 社交        | 关注/拉黑按钮 + 本地好友高亮 + 关键词黑名单 |
| `visitedColor`    | 体验        | 已访问链接染色 |
| `timeChinese`     | 排版        | 时间戳中文友好显示（刚刚 / X 分钟前） |
| `emailNavLink`    | 工具        | 邮箱域名快捷跳转 |

## 2. 架构亮点

### 2.1 特性即模块（feature-as-module）

每个特性是一个纯数据对象，通过 `define(cfg)` 注册：

```js
const signIn = {
  id: "signIn",
  deps: ["ui"],
  order: 80,                  // 启动顺序
  cfg: { sign_in: { enabled: true, method: 1, last_date: "" } },
  meta: { sign_in: { label: "自动签到", group: "🚀 基础功能",
                     fields: { method: { type: "RADIO", options: [...] } } } },
  match: ctx => ctx.site && ctx.loggedIn && ...,
  init: async (ctx) => { ... }
};
```

**好处**：
- 特性互相独立，新增/删除只改一个 `define()` 调用
- `match` 函数让模块在不该运行时自动跳过
- `meta` 描述了 UI（label / group / fields），设置面板可自动生成
- `deps + order` 让启动顺序可声明式管理

### 2.2 共享 ctx（context）

所有模块共享一个 `ctx` 对象：

```js
{
  site, loggedIn, store, ui, user, $$, $, obs, uw, ...
}
```

模块通过 `init(ctx)` 拿到所需能力，没有跨模块的"单例查找"。

### 2.3 存储抽象（store）

- `store.get(path, fallback)` / `store.set(path, value)` — 路径式（如 `sign_in.ns.enabled`）
- 内部用 `merge()` + `Map` 聚合每个模块的 `cfg` defaults
- `getDefaults()` 总是返回合并后的完整默认树，避免"局部设置丢失"

### 2.4 网络层（net）

```js
const net = {
  get: async (url, opts) => fetch(BASE_URL + url, { credentials: "include", ...opts }),
  post: async (url, body, opts) => fetch(..., { method: "POST", body: JSON.stringify(body), ...opts })
};
```

**亮点**：所有 API 调用都通过 `BASE_URL` 拼接，避免硬编码域名，多站点（NS / DF）共用代码。

### 2.5 观察者（Observer）

```js
class Observer {
  watch(target, cb) { /* MutationObserver + 智能节流 */ }
  on(key, cb) { /* 自定义事件总线 */ }
}
```

统一管理 DOM 变更监听，避免每个模块各自 `new MutationObserver`。

## 3. 可借鉴到 linux.sb Suite 的点

### 3.1 `signinTips` —— 自动签到未开时的"顶部提醒条"

**当前 linux.sb Suite**：用户关闭自动签到后，唯一的提醒来自面板的"立即签到"按钮。如果用户忽略了面板，签到就漏了。

**借鉴方案**：当 `autoSignin=false` 且今天未签到时，在页面顶部插入一个醒目的提示条（黄底闪烁），提供"立即签到"和"今天不再提醒"两个动作。

**为什么值得做**：nodeseek 的 `signinTips` 是被多次提及的"小而有用"的功能，用户漏签率明显下降。

**实现成本**：低。复用现有 `signin.getStatus()` + `core/css.mjs`。

### 3.2 `history` —— 本地浏览历史抽屉

**当前 linux.sb Suite**：无。

**借鉴方案**：在面板里加一个"历史"图标，点击展开抽屉，列出最近 50 条访问的帖子/用户（按时间倒序，可点击跳转，可单条删除，可清空）。

**为什么值得做**：论坛用户经常回看自己浏览过的帖子/用户，这是高频操作。

**实现成本**：中。需要在 `core/poller` 之上加一个 `core/history.mjs`（或 `lib/history.mjs`），监听 `dom.onRouteChange`，写 GM_*。

### 3.3 `userCardExt` —— 鼠标悬停用户卡片

**当前 linux.sb Suite**：只能从面板进入自己的主页。

**借鉴方案**：鼠标悬停任何 `a.avatar-profile-link` 时，延迟 300ms 弹出小卡片，显示该用户的"积分/等级/加入时间"。

**为什么值得做**：浏览回帖时了解陌生用户非常常见。

**实现成本**：中。需要在 `lib/` 里实现 `parseUserCard(html)`，并对每个用户卡片做一次 `getHtml` + 缓存（5min TTL）。

### 3.4 `inlineUserInfo` —— 帖子作者区补全信息

**当前 linux.sb Suite**：帖子作者区（`li.post-item`）只显示头像+昵称，不显示积分。

**借鉴方案**：DOM 加载后，给每个 `li.post-item` 的 `.post-meta` 后追加"积分 N · 注册 N 天前"。

**为什么值得做**：和 userCardExt 类似，但更轻量（不需要 hover）。

**实现成本**：低-中。可以用 `lib/user-summary.mjs` 实现一个 `parseUserSummaryFromListItem(el)`，再用 `Observer` 监听帖子列表变更。

### 3.5 `quickComment` —— 自定义快捷回复模板

**当前 linux.sb Suite**：无。

**借鉴方案**：在设置面板里添加"快捷回复模板"管理（CRUD），回帖页 textarea 上方插入"模板选择下拉"，点击即填入。

**为什么值得做**：高频回帖用户节省大量打字时间。

**实现成本**：中-高。需要在 `core/settings` 之上做模板管理 UI。

### 3.6 `visitedColor` —— 已访问链接染色

**当前 linux.sb Suite**：无。

**借鉴方案**：用一个 `lib/visited-color.mjs` 注入一段 CSS，根据 `:visited` 给帖子标题染色（深色模式用浅紫，浅色模式用深紫）。

**为什么值得做**：一行 CSS 就能做，提升"我在哪里看过"的体感。

**实现成本**：极低。

### 3.7 `timeChinese` —— 时间戳中文显示

**当前 linux.sb Suite**：无。

**借鉴方案**：在面板的"最近通知"里，把 "2026-08-12 12:34" 替换成"2 小时前"。

**为什么值得做**：nodeseek 用户的实际反馈里这个功能被夸"很贴心"。

**实现成本**：低。`lib/time-format.mjs` 即可。

### 3.8 `instantPage` —— 悬停预取

**当前 linux.sb Suite**：无。

**借鉴方案**：监听 `mouseover` 帖子标题链接 200ms 后，调用 `fetch(url, { priority: "low" })`。

**为什么值得做**：让"点击进入"变得瞬时。

**实现成本**：低。

## 4. 不建议直接借鉴的

| 项                | 不建议的原因 |
|-------------------|------------|
| `aiComment`       | 涉及 LLM Key 管理、敏感操作（自动发评论），有违规风险；linux.sb 站规严格 |
| `callout`         | linux.sb 用的是标准 Markdown，nodeseek 的 Callout 语法（`> [!info]`）是 GitHub 风格，linux.sb 未必支持 |
| `codeHighlight`   | 现有 `code` 块已由论坛自身高亮（Prism），再叠一层会重复 |
| `darkMode`        | 论坛本身有暗色主题，重复 |
| `blockViewLevel`  | 是 nodeseek 的"按等级屏蔽"机制，linux.sb 没有这个概念 |

## 5. 对架构的启发

1. **特性即模块**：linux.sb Suite 现在的 `LSB.register()` 已经接近这个模式，但还缺少：
   - `meta` 描述（设置面板自动生成）
   - `match` 早退
   - `order` 显式声明
   - 路径式配置 `store.get(path)`
2. **共享 ctx**：现在用 DI 注入 `({ config, dom, events })`，可以扩展为更完整的 ctx（加入 `store`, `ui`, `obs`）
3. **Observer 单例**：现在每个模块自己 `MutationObserver`，可以收口
4. **net 层**：现在用 `LSB.http.getHtml`，已经是统一层，不变
5. **测试可借鉴性**：nodeseek 的 cfg / meta 模式让"特性"易于测试（输入 cfg → 期望 UI）

## 6. 具体落地建议（按性价比排序）

| 优先级 | 功能          | 预估工时 | 影响 |
|--------|--------------|---------|------|
| P0     | signinTips   | 2h      | 高（解决漏签） |
| P0     | visitedColor | 0.5h    | 中（一眼看出） |
| P1     | timeChinese  | 1h      | 中（体感好） |
| P1     | history      | 3h      | 高（高频） |
| P2     | userCardExt  | 4h      | 中（增强浏览） |
| P2     | inlineUserInfo | 2h    | 中（同上） |
| P3     | quickComment | 6h      | 高（但复杂） |
| P3     | instantPage  | 1h      | 低（锦上添花） |