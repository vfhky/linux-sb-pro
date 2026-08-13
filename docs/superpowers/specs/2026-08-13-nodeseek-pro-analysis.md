# Nodeseek Pro 调研报告（基于真实源码验证）

- **脚本**: `Nodeseek Pro` (Greasy Fork #567109)
- **版本**: 1.0.8
- **源码规模**: 290,303 字节（约 4741 行）
- **目标站点**: `nodeseek.com`, `deepflood.com`（通过 `SITES` 数组配置双站点）
- **依赖**: 外部加载 `layui` 2.10.3（用于 toast/弹窗/设置面板），`highlight.js` 11.9.0
- **代码风格**: Vite 打包产物，每个 feature 为独立模块，有 `__vite_glob_*` 标记

## 1. 完整功能清单（26 个 feature，按源码顺序）

| ID | 类别 | 功能 | 关键实现 |
|----|------|------|---------|
| `autoJump` | 基础 | 外部链接重定向跳过（`/link?url=...`） | `location.href = url` 直接跳转 |
| `autoLoading` | 基础 | 列表页无限滚动加载 | `IntersectionObserver` + 分页参数 |
| `blockPosts` | 过滤 | 按关键词/用户屏蔽帖子 | `store.get("block_list")` 关键词匹配 |
| `blockViewLevel` | 过滤 | 按等级屏蔽帖子 | `store.get("block_view_level")` 阈值过滤 |
| `callout` | 排版 | `> [!info]` 等 Callout 块渲染 | 正则替换 + CSS 类映射 |
| `codeHighlight` | 排版 | 代码高亮 | 动态加载 `highlight.js` + 亮/暗主题切换 |
| `commentShortcut` | 交互 | 评论区快捷键 | J/K 导航、Shift+R 回复、/ 搜索 |
| `darkMode` | 主题 | 跟随系统暗色模式 | `prefers-color-scheme` + CSS 变量 |
| `history` | 工具 | 本地浏览历史记录 | `localStorage` + 抽屉面板渲染 |
| `imageSlide` | 排版 | 帖子内图片幻灯片浏览 | 点击放大 + 左右切换 |
| `instantPage` | 性能 | 鼠标悬停预取下一页 | `mouseover` 延迟 200ms → `fetch()` |
| `levelTag` | 排版 | 用户等级标签 | CSS 注入 + 等级名映射 |
| `menus` | 工具 | TM 菜单命令注册 | `GM_registerMenuCommand` + `GM_unregisterMenuCommand` |
| `quickComment` | 交互 | 自定义快捷回复模板 | 多组模板 + 下拉选择 + 填入 textarea |
| `aiComment` | 实验 | AI 自动回帖 | 需自备 Key，总开关 `AI = false` |
| `signIn` | 基础 | 每日自动签到 | `POST /api/attendance?random=N`，日期级去重 |
| `signinTips` | 基础 | 自动签到关闭时的顶部提醒条 | 黄底闪烁 banner + "今天不提示" |
| `smoothScroll` | 体验 | 平滑滚动 | 一行 CSS: `html{scroll-behavior:smooth}` |
| `userCardExt` | 社交 | 鼠标悬停用户卡片 | hover 延迟 300ms → Ajax 获取用户详情 |
| `visitedColor` | 体验 | 已访问链接染色 | CSS `:visited` 伪类 |
| `emailNavLink` | 工具 | 邮箱域名快捷跳转 | 正则匹配邮箱 → 链接化 |
| `timeChinese` | 排版 | 时间戳中文友好显示 | "刚刚/X分钟前/X小时前" |
| `imageUpload` | 工具 | 图片上传增强 | 粘贴/拖拽上传 + 进度条 |
| `openInNewTabFix` | 基础 | 修复外链在新标签页打开 | `target="_blank"` 注入 |
| `inlineUserInfo` | 社交 | 帖子作者区补全信息 | DOM 注入注册时间/积分 |
| `userRelation` | 社交 | 关注/拉黑 + 本地好友高亮 + 关键词黑名单 | `store` 持久化列表 + DOM 标记 |

## 2. 架构（已验证）

### 2.1 特性即模块（define 模式）

```javascript
// 真实源码签名（行 2865-2901）
const signIn = {
    id: "signIn",
    deps: ["ui"],           // 依赖声明（仅 "ui"）
    order: 80,              // 启动顺序
    cfg: {                  // 默认配置（路径式）
        sign_in: {
            ns: { enabled: true, method: 1, last_date: "", ignore_date: "" },
            df: { enabled: true, method: 1, last_date: "", ignore_date: "" }
        }
    },
    meta: {                 // 设置面板 UI 描述
        sign_in: {
            label: "自动签到", group: "🚀 基础功能",
            fields: { method: { type: "RADIO", label: "签到方式", valueType: "number",
                      options: [{ value: 1, text: "随机🍗" }, { value: 2, text: "5个🍗" }] } },
            hidden: ["last_date", "ignore_date"]
        }
    },
    match: ctx => ctx.site && ctx.loggedIn && ctx.store.get(`sign_in.${ctx.site.code}.enabled`, true),
    async init(ctx) {
        const code = ctx.site.code;
        const method = ctx.store.get(`sign_in.${code}.method`, 0);
        const now = (() => {
            const off = new Date().getTimezoneOffset() + 480;  // UTC+8
            const bj = new Date(Date.now() + off * 60000);
            return `${bj.getFullYear()}/${bj.getMonth() + 1}/${bj.getDate()}`;
        })();
        if (ctx.store.get(`sign_in.${code}.last_date`) === now) return;
        try {
            const r = await net.post(`/api/attendance?random=${method === 1}`);
            ctx.store.set(`sign_in.${code}.last_date`, now);
            if (r?.success) {
                ctx.ui.success?.(`签到成功！+${r.gain}🍗，共${r.current}🍗`);
            } else {
                ctx.ui.info?.(r?.message || "签到失败");
            }
        } catch (e) { ctx.ui.info?.(e?.message || "签到错误"); }
    }
};
```

### 2.2 共享 ctx 对象

```javascript
// 真实源码——ctx 在 boot() 时组装
const ctx = {
    site,           // { host, code, name }
    loggedIn,       // 从 DOM 检测
    store,          // { get(path, fallback), set(path, value), init(), getDefaults() }
    ui,             // { toast(msg, style), success(msg), info(msg), warning(msg), error(msg) }
    user,           // 当前用户信息
    $$, $, obs, uw, // 工具函数
};
```

### 2.3 Toast 系统（基于 layui）

```javascript
// 真实源码（行 3456-3460）
// ui 模块提供 toast 方法，底层调用 layui 的 layer.msg()
toast: (text, style) => {
    const idx = layer.msg(text, { offset: 't', area: ['100%', 'auto'], anim: 'slideDown' });
    layer.style(idx, Object.assign({ opacity: 0.9 }, style));
    return idx;
},
// 便捷方法：
info:    msg => ctx.ui.toast(msg, { "background-color": "#4D82D6" }),
success: msg => ctx.ui.toast(msg, { "background-color": "#57BF57" }),
warning: msg => ctx.ui.toast(msg, { "background-color": "#D6A14D" }),
error:   msg => ctx.ui.toast(msg, { "background-color": "#E1715B" }),
```

**关键发现**：nodeseek 的 toast 依赖外部 `layui` 库，linux-sb-suite 不能直接照搬（我们没有 layui）。但其 `{ success, info, warning, error }` 四类型 + 颜色映射的模式值得借鉴。

### 2.4 存储抽象（store）

```javascript
// 真实源码（行 131-146）
const store = {
    reg(id, cfg, meta) { ... },  // 注册模块的默认配置
    getDefaults() { ... },       // 聚合所有模块的 cfg
    init() {
        cfgCache = GM_getValue("settings", null) || {};
        merge(cfgCache, getDefaults());  // 缺失的 key 用默认值补全
        GM_setValue("settings", cfgCache);
        return cfgCache;
    },
    get(p, fb) { const v = getPath(this.init(), p); return v === undefined ? fb : v; },
    set(p, v) { setPath(this.init(), p, v); GM_setValue("settings", cfgCache); }
};
```

**特点**：所有设置存在一个 `GM_*` key 下（`settings`），通过点号路径访问（如 `sign_in.ns.enabled`）。初始化时用默认值补全缺失字段，避免"升级后新设置项缺失"的问题。

### 2.5 网络层（net）

```javascript
// 真实源码（行 149-160）
const net = {
    async fetch(url, { method = "GET", data, headers = {}, type = "json" } = {}) {
        const r = await fetch(url.startsWith("http") ? url : env.BASE_URL + url, {
            method, credentials: "include",
            headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...headers },
            body: data ? JSON.stringify(data) : undefined
        });
        return r[type]().catch(() => null);
    },
    get: (u, h, t) => net.fetch(u, { headers: h, type: t }),
    post: (u, d, h, t) => net.fetch(u, { method: "POST", data: d, headers: h, type: t })
};
```

### 2.6 模块启动（boot）

```javascript
// 真实源码（行 174-198）
function boot(ctx) {
    store.init();                                   // 1. 初始化存储
    // 拓扑排序（按 deps + order）
    const sorted = topologicalSort(modules);
    sorted.forEach(m => {
        if (m.match?.(ctx) !== false) {             // 2. match 早退检查
            try { m.init?.(ctx); } catch (e) { ... } // 3. 初始化
            if (ctx.watch) { ... }                   // 4. DOM 监听注册
        }
    });
}
```

## 3. signinTips 实现细节（可借鉴）

```javascript
// 真实源码（行 2914-2948）
const signinTips = {
    id: "signinTips",
    deps: ["ui"],
    order: 79,
    match(ctx) {
        if (!ctx.site || !ctx.loggedIn || !ctx.store.get("signin_tips.enabled", true)) return false;
        return ctx.store.get(`sign_in.${ctx.site.code}.enabled`, true) === false;  // 仅当自动签到关闭时
    },
    init(ctx) {
        addStyle("nsx-signtip", `.nsplus-tip{background:rgba(255,217,0,.8);padding:3px;text-align:center;animation:blink 5s ease infinite}...`);
        // 日期去重
        if (now === ctx.store.get(`sign_in.${code}.ignore_date`) || now === ctx.store.get(`sign_in.${code}.last_date`)) return;
        // 插入 header 顶部
        const header = $("header");
        const tip = document.createElement("div");
        tip.className = "nsplus-tip";
        tip.innerHTML = `<p>今天还没签到！【<a>随机🍗</a>】【<a>5个🍗</a>】【<a>今天不提示</a>】</p>`;
        header.appendChild(tip);
        // 点击签到 → POST API → 成功后移除 tip
        // 点击"今天不提示" → 写 ignore_date → 移除 tip
    }
};
```

## 4. 对 linux-sb-suite 的借鉴价值总结

| 借鉴点 | 优先级 | 说明 |
|--------|--------|------|
| toast 四类型模式 | P0 | `{ success, info, warning, error }` 颜色映射，与我们设计的 toast 一致 |
| signinTips 顶部提醒 | P0 | 自动签到关闭时页面顶部黄底提示，防止漏签 |
| 路径式存储 | P1 | `store.get("sign_in.ns.enabled")` 比扁平 key 更结构化 |
| 设置补全 | P1 | `merge(cfgCache, defaults)` 解决升级后新设置项缺失 |
| match 早退 | P1 | 模块在 `match` 返回 false 时跳过整个 init |
| 双站点 code | P2 | `ns`/`df` 前缀，linux-sb-suite 可用于 `lsb`/`lbi` |
| 日期字符串去重 | P2 | `YYYY/MM/DD` 格式比时间戳更直观 |
| 外部依赖管理 | 注意 | nodeseek 依赖 layui，linux-sb-suite 应保持零外部依赖 |