# 功能借鉴设计提案

基于：
- [Nodeseek Pro 调研报告](2026-08-13-nodeseek-pro-analysis.md)
- [LDStatus Pro 调研报告](2026-08-13-ldstatuspro-analysis.md)

## 0. 项目约束（来自用户）

- 通用化、模块化、易扩展、工程化
- 永远不要做 Windows 计划任务
- 永远不要在 Windows 上跑定时任务
- 必须先在 Chrome 实测验证
- 永远只用登录用户的信息
- 永远不用"凭据"硬编码

## 1. 选定的 8 个新功能（按 P0→P2 排序）

### P0 —— 解决实际问题

| 功能 | 来源 | 工时 | 解决什么 |
|------|------|------|---------|
| `signinTips`（顶部签到提醒） | nodeseek | 2h | 关闭自动签到后，用户会漏签 |
| `Tab Leader`（多 tab 协调） | LDStatus | 2h | 多个 tab 打开论坛时，poller 重复触发 |
| `Storage.migrate`（版本化存储） | LDStatus | 1h | bump version 时旧 cache 不被清理（如 1.1.4 脏 cache） |

### P1 —— 体验提升

| 功能 | 来源 | 工时 | 解决什么 |
|------|------|------|---------|
| `Notifier`（里程碑通知） | LDStatus | 3h | 连续签到 N 天、积分破 N 时桌面通知 |
| `LRUCache`（通用缓存） | LDStatus | 1h | 用户卡片、用户摘要的内存缓存 |
| `timeChinese`（友好时间） | nodeseek | 1h | "2 小时前" 而不是 "2026-08-12 12:34" |
| `history`（浏览历史） | nodeseek | 3h | 高频操作：回看访问过的帖子/用户 |

### P2 —— 锦上添花

| 功能 | 来源 | 工时 | 解决什么 |
|------|------|------|---------|
| `visitedColor`（已访问染色） | nodeseek | 0.5h | 一眼看出"我看过的" |
| `userCardExt`（hover 用户卡） | nodeseek | 4h | 浏览回帖时快速了解陌生用户 |

**总估时**: 约 17.5h

## 2. 架构变化

### 2.1 新增 `core/` 文件

```
core/
  cache.mjs          # LRUCache (P1)
  storage.mjs        # 现有 storage + migrate (P0)
  notifier.mjs       # GM_notification 包装 (P1)
  tab-leader.mjs     # 多 tab 协调 (P0)
  observer.mjs       # 统一 MutationObserver (可选)
```

### 2.2 新增 `lib/` 文件

```
lib/
  time-format.mjs    # "2 小时前" 格式化 (P1)
  user-card.mjs      # 用户卡片 hover 数据 (P2)
  history-store.mjs  # 浏览历史存取 (P1)
  signin-tips.mjs    # 顶部签到提示条 (P0)
```

### 2.3 新增 `lib/` 文件（高阶）

```
lib/
  leaderboard.mjs    # 个人历史快照 (P2, 可选)
```

## 3. 模块注册顺序

```js
// boot order（从小到大）
storage      // 必须最先，所有模块都依赖
cache        // P1, 通用原语
notifier     // P1, 用 storage + GM_notification
tab-leader   // P0, 多 tab 协调
observer     // 可选, MutationObserver 收口

modules (in order):
  user            // 1
  notif           // 2  (用 cache)
  signin          // 3  (用 notifier)
  signinTips      // 4  (用 signin)        [P0 新]
  history         // 5  (用 storage)       [P1 新]
  userCardExt     // 6  (用 cache)         [P2 新]
  ui              // 最后
```

## 4. 数据流（signinTips 为例）

```
signinTips.init(ctx)
  ├─ ctx.store.get(`signin_tips.enabled`, true)  → false 时 return
  ├─ signin.getStatus()  → { status: "not-signed-in" }
  ├─ status === "not-signed-in" && auto_signin === false
  │    └─ DOM: 插入顶部黄底提示条
  │         ├─ [立即签到] 按钮 → signin.performSignin()
  │         └─ [今天不再提醒] 按钮 → ctx.store.set(`signin.${userId}.ignore_date`, today)
  └─ 监听 dom.onRouteChange 重新检查
```

## 5. 隐私与权限

- `Tab Leader`：用 localStorage + 时间戳，不上传任何数据
- `Notifier`：用 `GM_notification`（浏览器原生），不需要新权限
- `Storage.migrate`：纯本地，bump version 时清理
- `History`：纯本地 GM_*，用户可一键清空
- `CloudSync`（暂不做）：需要明确用户同意 + 隐私政策

## 6. 不在本批的功能

- `aiComment`（风险）
- `OAuthManager + CloudSync`（需要后端）
- `TopicExporter`（工时大，单独排期）
- `ActivityManager`（需要后端或纯本地化）
- `userRelation`（黑名单/好友，linux.sb 站规可能冲突）

## 7. 实施顺序（sprint 划分）

### Sprint A (5h) - 1.1.6
- Storage.migrate（清理旧脏 cache）
- Tab Leader（修多 tab 重复 poll）
- signinTips（漏签修复）

### Sprint B (5h) - 1.2.0
- LRUCache 抽到 core
- Notifier（连续签到 / 积分里程碑）
- timeChinese

### Sprint C (4h) - 1.3.0
- history（浏览历史）
- visitedColor
- userCardExt

## 8. 验收标准

每个新功能必须有：
- `lib/*.mjs` 纯函数实现
- `test/*.test.mjs` 单元测试（red → green）
- dev 源码 + build 产物（dist/）
- 实际在 Chrome 中验证（用 CDP）
- Greasy Fork 发布
- git commit + push

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 论坛改版导致选择器失效 | lib/ 解析器做容错，失败时只降级不抛错 |
| GM_* 在某些浏览器不支持 | 用 try/catch 包裹 + 降级到 console |
| 通知频繁打扰用户 | Notifier 限频：60s 最多 1 次 |
| 多 tab 协调冲突 | Tab Leader 用 `__ldsp_test__` 探测 + 5s 心跳 |
| 旧用户 cache 太大 | migrate 时按需清理过期项 |