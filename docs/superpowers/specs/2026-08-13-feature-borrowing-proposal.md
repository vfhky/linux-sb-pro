# 功能借鉴设计提案（基于真实源码验证后修正）

基于：
- [Nodeseek Pro 调研报告](2026-08-13-nodeseek-pro-analysis.md)（26 个 feature，依赖 layui）
- [LDStatus Pro 调研报告](2026-08-13-ldstatuspro-analysis.md)（19 个 class + 3 个 plain object）

## 0. 项目约束（来自用户）

- 通用化、模块化、易扩展、工程化
- 永远不要做 Windows 计划任务
- 永远不要在 Windows 上跑定时任务
- 必须先在 Chrome 实测验证，再更新 Greasy Fork
- 永远只用登录用户的信息
- 永远不用"凭据"硬编码
- 零外部依赖（nodeseek 依赖 layui，我们不学）

## 1. 选定的 8 个新功能（按 P0→P2 排序）

### P0 —— 解决实际问题

| 功能 | 来源 | 工时 | 解决什么 |
|------|------|------|---------|
| `toast`（签到成功提示） | 自主设计 + nodeseek 四类型模式 | 3h | 签到成功/失败后的视觉反馈。本次 spec 已覆盖 |
| `signinTips`（顶部签到提醒） | nodeseek | 2h | 关闭自动签到后，页面顶部黄底提示条，防止漏签 |
| `Tab Leader`（多 tab 协调） | LDStatus | 2h | 多 tab 打开论坛时 poller 重复触发。localStorage 心跳 + 选举 |

### P1 —— 体验提升

| 功能 | 来源 | 工时 | 解决什么 |
|------|------|------|---------|
| `Notifier`（里程碑通知） | LDStatus | 3h | 连续签到 N 天、积分破 N 时 `GM_notification` 桌面通知 |
| `LRUCache`（通用缓存） | LDStatus | 1h | 用户卡片、通知列表的内存缓存，减少 HTTP 请求 |
| `timeChinese`（友好时间） | nodeseek | 1h | "2 小时前" 而不是 "2026-08-12 12:34" |
| `history`（浏览历史） | nodeseek | 3h | 高频操作：回看访问过的帖子/用户 |

### P2 —— 锦上添花

| 功能 | 来源 | 工时 | 解决什么 |
|------|------|------|---------|
| `visitedColor`（已访问染色） | nodeseek | 0.5h | `:visited` 伪类 CSS，一眼看出"我看过的" |

**总估时**: 约 15.5h

## 2. 架构变化（修正后）

### 2.1 新增 `core/` 文件

```
core/
  cache.mjs          # LRUCache（Map 实现，参考 LDStatus）
  notifier.mjs       # GM_notification 包装（参考 LDStatus，60s 限频 + 去重）
  tab-leader.mjs     # 多 tab 协调（参考 LDStatus，5s 心跳 + 10s 超时 + beforeunload 释放）
```

### 2.2 新增 `lib/` 文件

```
lib/
  toast.mjs          # createToastManager() 工厂（自主设计，零外部依赖）
  time-format.mjs    # "2 小时前" 格式化（参考 nodeseek）
  history-store.mjs  # 浏览历史存取（参考 nodeseek）
  signin-tips.mjs    # 顶部签到提示条（参考 nodeseek signinTips）
```

### 2.3 不新增的

| 文件 | 原因 |
|------|------|
| `core/observer.mjs` | MutationObserver 收口目前不需要——只有 ui 模块在用 |
| `lib/user-card.mjs` | hover 用户卡片需要 Ajax + 缓存，P2 暂缓 |
| 任何外部依赖 | 保持零依赖原则 |

## 3. 模块注册顺序

```
boot order（基础设施层，不通过 LSB.register）:
  storage → cache → tab-leader → toast → notifier

modules (通过 LSB.register):
  user            // 1
  notif           // 2
  signin          // 3
  signinTips      // 4  [P0 新]
  history         // 5  [P1 新]
  ui              // 最后
```

## 4. 数据流（signinTips 为例，参考 nodeseek 真实实现）

```
signinTips.init(ctx)
  ├─ match: autoSignin === false 时生效
  ├─ 日期去重: today === ignore_date 或 last_date → 跳过
  ├─ DOM: 在页面顶部插入黄底提示条
  │    ├─ CSS: background: rgba(255,217,0,.8) + blink 动画
  │    ├─ [立即签到] → signin.performSignin() → toast
  │    └─ [今天不提示] → 写 ignore_date → 移除 tip
  └─ 监听 signin:auto-changed 事件 → 开关打开时移除 tip
```

## 5. 隐私与权限

- `Tab Leader`：localStorage + 时间戳，不上传任何数据
- `Notifier`：`GM_notification`（浏览器原生），不需要新权限
- `History`：纯本地 GM_*，用户可一键清空
- `CloudSync`：暂不做，需要后端服务

## 6. 不在本批的功能

- `aiComment`（风险 + 依赖外部 Key）
- `OAuthManager + CloudSync`（需要后端，LDStatus 依赖 `api.ldspro.qzz.io`）
- `TopicExporter`（工时大，单独排期）
- `ActivityManager`（需要后端或纯本地化）
- `userRelation`（黑名单/好友，linux.sb 站规可能冲突）
- `blockPosts / blockViewLevel`（nodeseek 特有，linux.sb 无此概念）
- `imageUpload`（nodeseek 特有，依赖 layui）

## 7. 实施顺序（sprint 划分）

### Sprint A (5h) - 1.2.0
- toast 系统（本次 spec 已设计）
- signin 页面加载时立即签到
- Tab Leader（修多 tab 重复 poll）

### Sprint B (5h) - 1.3.0
- signinTips（漏签修复）
- LRUCache 抽到 core
- Notifier（连续签到 / 积分里程碑）

### Sprint C (5h) - 1.4.0
- timeChinese
- history（浏览历史）
- visitedColor

## 8. 验收标准

每个新功能：
- 纯函数/类实现（lib/ 或 core/）
- 单元测试（test/*.test.mjs）
- 本地 Chrome 实测验证通过
- `node build.mjs` 构建成功
- 更新 Greasy Fork
- git commit + push

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 论坛改版导致选择器失效 | lib/ 解析器做容错，失败时只降级不抛错 |
| GM_* 在某些浏览器不支持 | try/catch 包裹 + 降级到 console |
| 通知频繁打扰用户 | Notifier 限频：60s 最多 1 次 |
| 多 tab 协调冲突 | TabLeader 用 localStorage 探测 + 5s 心跳 + beforeunload 释放 |
| 旧用户 cache 脏数据 | bump storage version 时调用 migrate 清理 |