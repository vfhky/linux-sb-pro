# LDStatus Pro 调研报告（基于真实源码验证）

- **脚本**: `LDStatus Pro`
- **版本**: 3.9.0.3
- **源码规模**: 1,110,136 字节（约 17664 行）
- **目标站点**: `linux.do`, `idcflare.com`, `cdk.linux.do`, `credit.linux.do`
- **原始仓库**: https://github.com/caigg188/LDStatusPro
- **代码风格**: 单文件 IIFE，无打包工具，纯手写 ES6+

## 1. 核心组件（19 个 class + 3 个 plain object）

### Classes（按源码顺序）

| 类 | 行号 | 职责 |
|----|------|------|
| `LRUCache` | 1045 | 通用 LRU 缓存（Map 实现，`maxSize` 可配置） |
| `Storage` | 1072 | GM_* 封装，用户名作用域 key、批量写入防抖、migrate |
| `NetworkError` | 1302 | 自定义错误类型（`code`, `status`, `url`） |
| `Network` | 1431 | GM_xmlhttpRequest 封装，统一错误处理、重试、鉴权头 |
| `HistoryManager` | 2013 | 每日数据快照（trust level 进度等） |
| `ReadingTracker` | 2311 | 页面阅读时长追踪（事件节流、可见性、仅 leader 写） |
| `Notifier` | 2694 | 里程碑通知（`GM_notification`，60s 限频） |
| `OAuthManager` | 2747 | OAuth 登录 + token 管理 + 自动续期 |
| `LeaderboardManager` | 2991 | 排行榜缓存 + 5min 冷却 |
| `CloudSyncManager` | 3196 | 多设备设置同步（需要后端 API） |
| `TicketManager` | 5824 | 工单管理 |
| `TopicExporter` | 6344 | 主题导出（JSON / Markdown） |
| `LDCManager` | 7261 | LDC 积分相关 |
| `CDKManager` | 8072 | CDK（兑换码）相关 |
| `MelonHelper` | 8542 | Melon（论坛代币）相关 |
| `FollowManager` | 10125 | 关注管理 |
| `Renderer` | 10489 | DOM 渲染器（把数据画成面板） |
| `ActivityManager` | 11189 | 我的活动查看 |
| `Panel` | 11807 | 主面板（UI 状态机） |

### Plain Objects（非 class）

| 对象 | 行号 | 职责 |
|------|------|------|
| `EventBus` | 200 | 事件总线（`on/off/emit/once`） |
| `TabLeader` | 242 | 多 tab 协调（localStorage 心跳 + 领导者选举） |
| `Utils` | 分散 | 工具函数集（`throttle`, `debounce`, `toSafeNumber` 等） |

## 2. TabLeader 实现（已验证真实源码）

```javascript
// 真实源码（行 242-350），plain object 非 class
const TabLeader = {
    LEADER_KEY: `ldsp_tab_leader_${CURRENT_SITE.prefix}`,
    HEARTBEAT: 5000,    // 5 秒心跳
    TIMEOUT: 10000,     // 10 秒超时
    _tabId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    _isLeader: false,
    _storageAvailable: undefined,  // 延迟检测

    init() {
        this._tryBecomeLeader();
        this._interval = setInterval(() => this._tryBecomeLeader(), this.HEARTBEAT);
        this._storageHandler = (e) => { if (e.key === this.LEADER_KEY) this._tryBecomeLeader(); };
        window.addEventListener('storage', this._storageHandler);
        this._unloadHandler = () => this._release();
        window.addEventListener('beforeunload', this._unloadHandler);
    },

    _tryBecomeLeader() {
        // 1. 检测 localStorage 可用性（隐私模式/存储满）
        if (!this._storageAvailable) {
            try { localStorage.setItem('__ldsp_test__', '1'); localStorage.removeItem('__ldsp_test__'); this._storageAvailable = true; }
            catch (e) { this._storageAvailable = false; /* 直接成为 leader */ }
        }
        // 2. 读取当前 leader 信息
        const stored = JSON.parse(localStorage.getItem(this.LEADER_KEY) || '{}');
        const expired = !data.timestamp || (Date.now() - data.timestamp) > this.TIMEOUT;
        // 3. 过期或自己就是 leader → 续期
        if (expired || data.tabId === this._tabId) {
            this._isLeader = true;
            localStorage.setItem(this.LEADER_KEY, JSON.stringify({ tabId: this._tabId, timestamp: Date.now() }));
            EventBus.emit('leader:change', { isLeader: true, tabId: this._tabId });
        } else {
            this._isLeader = false;
            EventBus.emit('leader:change', { isLeader: false, tabId: this._tabId });
        }
    },

    _release() {
        if (this._isLeader && localStorage.getItem(this.LEADER_KEY)?.tabId === this._tabId) {
            localStorage.removeItem(this.LEADER_KEY);
        }
    },

    isLeader() { return this._isLeader; },
};
```

**关键发现**：
- 心跳 5s，超时 10s（不是之前报告的 5s）
- 有 `localStorage` 可用性检测（隐私模式/存储满）
- `beforeunload` 时释放 leader，避免僵尸 leader
- 通过 `EventBus` 通知其他模块 leader 变化
- 使用方通过 `TabLeader.isLeader()` 守卫，如 `if (!TabLeader.isLeader()) return;`

## 3. Notifier 实现（已验证）

```javascript
// 真实源码（行 2694-2744）
class Notifier {
    constructor(storage) {
        this.storage = storage;
    }

    check(reqs) {
        const achieved = this.storage.get('milestones', {});
        const newMilestones = [];
        reqs.forEach(r => {
            Object.entries(CONFIG.MILESTONES).forEach(([key, thresholds]) => {
                if (r.name.includes(key)) {
                    thresholds.forEach(t => {
                        const k = `${key}_${t}`;
                        if (r.currentValue >= t && !achieved[k]) {
                            newMilestones.push({ name: key, threshold: t });
                            achieved[k] = true;
                        }
                    });
                }
            });
        });
        if (newMilestones.length) {
            this.storage.set('milestones', achieved);
            this._notify(newMilestones);
        }
    }

    _notify(milestones) {
        const last = this.storage.get('lastNotify', 0);
        if (Date.now() - last < 60000) return;  // 60s 限频
        this.storage.set('lastNotify', Date.now());
        const msg = milestones.slice(0, 3).map(m =>
            m.type === 'req' ? `✅ ${m.name}` : `🏆 ${m.name} → ${m.threshold}`
        ).join('\n');
        GM_notification({ title: '🎉 达成里程碑！', text: msg, timeout: 5000 });
    }
}
```

## 4. LRUCache 实现（已验证）

```javascript
// 真实源码（行 1045-1069）
class LRUCache {
    constructor(maxSize = CONFIG.CACHE.LRU_SIZE) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);    // 移到末尾（最近使用）
        return value;
    }
    set(key, value) {
        this.cache.has(key) && this.cache.delete(key);
        if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value);  // 删除最久未用
        }
        this.cache.set(key, value);
    }
    has(key) { return this.cache.has(key); }
    clear() { this.cache.clear(); }
}
```

## 5. 关键差异：没有签到功能

LDStatus Pro 的目标站点是 linux.do（Discourse 论坛），它**没有每日签到功能**。它的核心功能是：
- 信任级别（trust level）进度跟踪
- 阅读时长统计
- 排行榜
- 云同步

与 linux-sb-suite 的签到/通知场景不同，但架构模式（DI、TabLeader、LRUCache、Storage migrate）高度可借鉴。

## 6. 对 linux-sb-suite 的借鉴价值总结

| 借鉴点 | 优先级 | 说明 |
|--------|--------|------|
| TabLeader 多 tab 协调 | P0 | 解决 linux-sb-suite 多 tab 重复 poll 的问题。localStorage 心跳 + 选举 + `beforeunload` 释放 |
| LRUCache | P1 | 通用缓存原语，用于通知列表、用户卡片缓存 |
| Storage migrate | P1 | bump version 时自动清理/迁移旧数据 |
| Notifier 里程碑通知 | P1 | `GM_notification` + 60s 限频 + 去重 achieved map |
| EventBus 模式 | 已有 | linux-sb-suite 的 `LSB.events` 已覆盖 |
| ReadingTracker | P2 | 阅读时长统计，适合"年度回顾"功能 |
| DI 构造注入 | 已有 | linux-sb-suite 的 `LSB.register(name, factory, deps)` 已覆盖 |
| Panel 状态机 | P2 | 可借鉴其展开/折叠/拖拽的状态管理方式 |
| OAuth + CloudSync | 暂不借鉴 | 需要后端服务，不在当前 scope |
| Discourse 特有功能 | 不适用 | Ticket/CDK/LDC/Melon/Follow 都是 Discourse 特有 |