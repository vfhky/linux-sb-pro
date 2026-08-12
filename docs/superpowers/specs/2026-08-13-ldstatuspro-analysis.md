# LDStatus Pro 调研报告

- **脚本**: `LDStatus Pro`
- **版本**: 3.9.0.3 (调研时)
- **源码规模**: 1,110,136 字节（约 18000 行）
- **目标站点**: `linux.do`, `idcflare.com`, `cdk.linux.do`, `credit.linux.do`
- **原始仓库**: https://github.com/caigg188/LDStatusPro

## 1. 核心模块（22 个类）

| 模块                  | 职责 |
|----------------------|------|
| `LRUCache`           | 通用 LRU 缓存（带 TTL） |
| `Storage`            | GM_* 封装，支持 migrate、过期、版本化 key |
| `Network`            | GM_xmlhttpRequest 封装，统一错误处理、重试 |
| `NetworkError`       | 自定义错误类型 |
| `HistoryManager`     | 每日数据快照（trust level 进度） |
| `ReadingTracker`     | 页面阅读时长追踪（事件节流、可见性、tab leader） |
| `Notifier`           | 里程碑通知（GM_notification） |
| `OAuthManager`       | OAuth 登录 + token 管理 + 自动续期 |
| `LeaderboardManager` | 排行榜缓存 + 5min 冷却 |
| `CloudSyncManager`   | 云同步（多设备设置同步） |
| `TicketManager`      | 工单管理 |
| `TopicExporter`      | 主题导出（JSON / Markdown） |
| `LDCManager`         | LDC 积分相关 |
| `CDKManager`         | CDK（兑换码）相关 |
| `MelonHelper`        | Melon（论坛代币）相关 |
| `FollowManager`      | 关注管理 |
| `Renderer`           | DOM 渲染器（把数据画成面板） |
| `ActivityManager`    | 我的活动查看 |
| `Panel`              | 主面板（UI 状态机） |
| `Utils`              | 工具（throttle、debounce、toSafeNumber 等） |
| `EventBus`           | 事件总线 |
| `TabLeader`          | 多 tab 协调（仅 leader 写数据，避免冲突） |

## 2. 架构亮点

### 2.1 类 + 依赖注入（DI）

每个能力是一个类，构造时接受其他实例：

```js
class LeaderboardManager {
  constructor(oauth, readingTracker, storage) { ... }
  async getLeaderboard(type) {
    const result = await this.oauth.api(`/api/leaderboard/${type}`);
    ...
  }
}
```

**好处**：
- 单元测试容易：传入 mock
- 依赖图清晰
- 不会因为全局变量重名出错

**对比**：linux.sb Suite 的 `LSB.register(name, factory, deps)` 走的是同样的路线（DI 风格）。

### 2.2 Storage 版本化

```js
class Storage {
  constructor() {
    this.PREFIX = 'ldsp_v';  // 版本化前缀
    this.MIGRATIONS = [
      { from: 1, to: 2, fn: (data) => ({ ...data, newField: defaultValue }) },
      { from: 2, to: 3, fn: (data) => ({ ...data, removedField: undefined }) }
    ];
  }
  
  get(key, defaultValue) {
    const raw = GM_getValue(`${this.PREFIX}${this.version}:${key}`);
    if (!raw) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  }
  
  migrate(username) {
    let data = this.get('schema', { version: 1 });
    while (data.version < this.MIGRATIONS.length) {
      data = this.MIGRATIONS[data.version - 1].fn(data);
      data.version++;
    }
    this.set('schema', data);
  }
}
```

**对比**：linux.sb Suite 现在是 `prefix: 'lsb:', version: 1` 但没有 migration 机制。LDStatus Pro 的 migrate 模式可以借鉴。

### 2.3 Tab Leader 选举（多 tab 协调）

```js
class TabLeader {
  elect() {
    const now = Date.now();
    if (now - this._lastElect > 10000) {
      const stored = localStorage.getItem(this.LEADER_KEY);
      const lastBeat = stored ? JSON.parse(stored).ts : 0;
      // 5 秒没收到心跳，宣布自己为 leader
      if (now - lastBeat > 5000) {
        localStorage.setItem(this.LEADER_KEY, JSON.stringify({ ts: now, id: this.id }));
        this.isLeader = true;
        this._onElect?.();
      }
    }
  }
}
```

**好处**：当用户开多个 tab 访问论坛时，只有 1 个 tab 真正写数据（ReadingTracker.save、CloudSync.push），避免重复 API 请求和 storage 冲突。

**对比**：linux.sb Suite 没有这个，多 tab 会重复 poll。值得加。

### 2.4 ReadingTracker（阅读时长统计）

亮点：
- **节流策略分级**：高频事件（mousemove, scroll）3 秒最多 1 次；低频事件（click, keydown）1 秒最多 1 次
- **页面可见性**：`visibilitychange` + `pageshow/pagehide` 兼容 Safari/iOS bfcache
- **passive + capture**：避免阻塞主线程
- **仅 leader 写数据**：避免多 tab 重复累加

**对比**：linux.sb Suite 没有阅读时长统计。这个功能适合"年度回顾"或"成就"类功能。

### 2.5 LRUCache

```js
class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);  // 移到末尾
    return value;
  }
  
  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.maxSize) {
      this.cache.delete(this.cache.keys().next().value);  // 删除最久未用
    }
    this.cache.set(key, value);
  }
}
```

**对比**：linux.sb Suite 没有 LRU。可以加到 `core/cache.mjs`。

### 2.6 OAuthManager + CloudSyncManager

- OAuth 登录后用 token 调远程 API
- 设置项云同步（用户在 A 设备改了设置，B 设备下次打开时自动同步）
- 用 `BroadcastChannel` 实现多 tab 实时同步
- `lastSyncTs` 防重复推送

**为什么值得借鉴**：linux.sb Suite 目前所有设置都存在 GM_*，换设备就丢。云同步可作为 v2.x 的增值功能。

### 2.7 ActivityManager（"我的活动"）

- 自动记录用户每天的活跃度（发帖、回帖、签到）
- 渲染成日历热力图
- 支持云同步

**对比**：linux.sb Suite 没有。值得做"个人年度回顾"。

### 2.8 TopicExporter（主题导出）

- 一键把整条主题导出为 JSON / Markdown
- 自动下载所有图片附件
- 保留引用关系

**为什么值得借鉴**：linux.sb 用户经常想归档好贴。

## 3. 借鉴优先级

### 3.1 P0 —— 一行 CSS 就能做

**Storage 版本号迁移**：把 `LSB.config.storage.version` 从 1 改成 2 时，加一个 `migrate()` 函数让旧数据自动升级。这样 1.1.4 → 1.1.5 时旧的脏 cache 会被清理。

### 3.2 P0 —— 中等成本高价值

**Tab Leader 选举**：linux.sb Suite 现在的 signin 自动签到 poller 在多 tab 时会重复触发。加 Tab Leader 后只在 1 个 tab 跑 poller，节省 API 调用。

**Notifier（里程碑通知）**：
- 签到连续 N 天通知
- 积分突破 N 通知
- 关注/被关注通知
- 用 `GM_notification` 而不是自己画弹窗，跨标签页统一

### 3.3 P1 —— 长期价值

**HistoryManager（数据快照）**：
- 每天存一份"当前积分、签到天数、通知数"
- 用于绘制"近 30 天趋势图"
- 历史趋势也是"成就"系统的基础

**LRUCache**：
- 抽到 `core/cache.mjs`
- 用于缓存通知列表、用户卡片、用户摘要
- 减少 HTTP 请求

### 3.4 P2 —— 大功能

**OAuthManager + CloudSyncManager**：
- 需要在 `ldcstore.com`（脚本作者自己搭的服务）注册 OAuth 应用
- 用户可以选"云同步设置"或仅本地
- 涉及隐私问题（设置同步 vs 数据收集），需要明确告知

**ActivityManager**：
- 需要服务端配合（上传匿名活动数据）
- 或者纯本地（用户自查看）

**TopicExporter**：
- 实现复杂（递归解析帖子树、保存图片）
- 适合做"工具页"而不是主面板

## 4. 不建议直接借鉴的

| 项                | 不建议的原因 |
|-------------------|------------|
| `LDCManager` / `CDKManager` / `MelonHelper` | 都是 linux.do 站点的代币/CDK 系统，linux.sb 不存在 |
| `TicketManager` | linux.do 的客服工单，linux.sb 没有 |
| `FollowManager` | linux.do Discourse 关注 API，linux.sb 不一定支持 |
| `OAuthManager + CloudSyncManager`（直接照搬） | 依赖作者自己搭的服务，不能照搬，可以借鉴架构 |
| 大部分 `*Manager` 类 | Discourse 特有 API，linux.sb 不一定兼容 |

## 5. 对架构的启发

1. **Storage migrate**：现在 1.1.4 → 1.1.5 时旧 cache 不被清理，需要 bump version 后清理
2. **Tab Leader**：避免多 tab 重复 poll
3. **LRUCache**：通用的缓存原语
4. **Notifier 抽象**：里程碑通知统一
5. **EventBus**：统一事件通信（现在 linux.sb 用 `LSB.events` on/emit，已经是这个）
6. **节流策略分级**：高频 vs 低频事件分开节流

## 6. 落地清单

| 优先级 | 功能 | 估时 | 备注 |
|--------|------|------|------|
| P0 | storage.migrate 模式 | 1h | bump version 时调用 |
| P0 | Tab Leader 选举 | 2h | 解决多 tab 重复 poll |
| P1 | Notifier（里程碑） | 3h | GM_notification 集成 |
| P1 | LRUCache 抽到 core | 1h | 给 signin/notif 缓存用 |
| P2 | HistoryManager（数据快照） | 4h | 趋势图基础 |
| P3 | TopicExporter | 8h+ | 工具页 |
| P3 | CloudSync | 8h+ | 需要后端 |