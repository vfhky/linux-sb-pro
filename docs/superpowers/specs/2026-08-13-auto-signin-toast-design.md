# Auto Sign-in Toast + 架构改进设计

基于：
- [Nodeseek Pro 调研报告](2026-08-13-nodeseek-pro-analysis.md)
- [LDStatus Pro 调研报告](2026-08-13-ldstatuspro-analysis.md)
- [功能借鉴设计提案](2026-08-13-feature-borrowing-proposal.md)

## 0. 项目约束

- 通用化、模块化、易扩展、工程化
- 永远不要做 Windows 计划任务
- 永远不要在 Windows 上跑定时任务
- 必须先在 Chrome 实测验证，再更新 Greasy Fork
- 永远只用登录用户的信息
- 永远不用"凭据"硬编码

## 1. 本次范围

### 1.1 Auto Sign-in Toast（新设计）

当自动签到开启时：
- 用户打开任意站内页面 → 立即检查一次签到状态 → 未签则自动签到
- 签到成功 / 失败 / 已签到 → 右下角 toast 浮层提示
- 5 分钟轮询器继续运行，每次成功也弹 toast
- 手动点击签到按钮成功也弹 toast

### 1.2 竞品分析报告（已完成）

- [Nodeseek Pro 调研报告](2026-08-13-nodeseek-pro-analysis.md) — 22 个功能点分析
- [LDStatus Pro 调研报告](2026-08-13-ldstatuspro-analysis.md) — 22 个类 / 架构分析
- [功能借鉴设计提案](2026-08-13-feature-borrowing-proposal.md) — 8 个选定功能、3 个 sprint

### 1.3 测试流程约束

工作原则：本地构建 → 本地安装到 Chrome → 实测验证 → 确认无误后更新 Greasy Fork。禁止跳过本地验证直接更新 Greasy Fork。

---

## 2. Toast 系统设计

### 2.1 架构定位

Toast 属于基础设施层，与 `LSB.storage`、`LSB.events` 平级，不通过 `LSB.register()` 注册：

```
LSB (root namespace)
  ├── storage, events, http, dom     (现有基础设施)
  ├── toast                          (新增基础设施)
  ├── core/   (config, logger, poller, settings, ...)
  ├── lib/    (纯 ESM 逻辑库)
  └── modules (user, signin, notif, ui, ...)  ← LSB.register()
```

### 2.2 模块设计

**文件**: `lib/toast.mjs`

```javascript
// 纯工厂函数，零外部依赖，可独立测试
export function createToastManager(opts = {}) {
  const {
    maxVisible = 3,
    gap = 8,
    durationMs = 3000,
    containerId = "lsb-toast-container",
  } = opts;

  // 内部状态
  let container = null;
  const queue = [];

  function ensureContainer() {
    if (container) return container;
    container = document.createElement("div");
    container.id = containerId;
    document.documentElement.appendChild(container);
    return container;
  }

  function show(message, { type = "info", durationMs: dur = durationMs } = {}) {
    if (!message || typeof message !== "string") return;

    const ctr = ensureContainer();
    const el = document.createElement("div");
    el.className = "lsb-toast";
    el.dataset.type = type;
    el.innerHTML = `<span class="lsb-toast-icon">${iconForType(type)}</span>` +
                   `<span class="lsb-toast-msg">${escapeHtml(message)}</span>`;
    el.addEventListener("click", () => dismiss(el));

    ctr.appendChild(el);
    queue.push(el);

    // 超出上限：移除最早的一条
    while (queue.length > maxVisible) {
      const oldest = queue.shift();
      dismissEl(oldest);
    }

    // 自动消失
    const timer = setTimeout(() => dismiss(el), dur);
    el._lsbToastTimer = timer;

    return el;
  }

  function dismiss(el) {
    if (!el || el._lsbToastDismissed) return;
    el._lsbToastDismissed = true;
    clearTimeout(el._lsbToastTimer);
    el.classList.add("lsb-toast-out");
    setTimeout(() => dismissEl(el), 200); // 等动画结束
  }

  function dismissEl(el) {
    const idx = queue.indexOf(el);
    if (idx >= 0) queue.splice(idx, 1);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  function destroy() {
    queue.slice().forEach(dismissEl);
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }

  return { show, dismiss, destroy };
}
```

### 2.3 API

| 方法 | 签名 | 说明 |
|------|------|------|
| `show` | `(message, { type, durationMs })` | 显示 toast，type: success/error/info |
| `dismiss` | `(el)` | 手动关闭某条 toast |
| `destroy` | `()` | 清理所有 toast + 容器，幂等 |

### 2.4 类型与视觉

| type | 左边框色 | 图标 | 用途 |
|------|---------|------|------|
| `success` | `#4ade80` | ✓ | 签到成功 |
| `error` | `#f87171` | ✗ | 签到失败 |
| `info` | `#60a5fa` | ℹ | 已签到/通用提示 |

### 2.5 队列与堆叠

- 最多同时显示 3 条，超出时移除最早的一条
- 新 toast 出现在容器底部（`flex-direction: column-reverse`）
- 每条 toast 独立 dismiss 定时器
- 用户可点击 toast 手动关闭

---

## 3. CSS 与主题适配

### 3.1 容器

```css
#lsb-toast-container {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  pointer-events: none;
}
```

### 3.2 单条 Toast

```css
.lsb-toast {
  pointer-events: auto;
  max-width: 300px;
  padding: 10px 14px;
  border-radius: 8px;
  font: 13px/1.4 system-ui, sans-serif;
  color: var(--lsb-fg, #eee);
  background: var(--lsb-bg, rgba(20, 22, 28, 0.94));
  border: 1px solid var(--lsb-border, rgba(255, 255, 255, 0.08));
  box-shadow: var(--lsb-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
  backdrop-filter: blur(8px);
  display: flex; align-items: center; gap: 8px;
  animation: lsb-toast-in 0.25s ease-out;
  transition: opacity 0.2s, transform 0.2s;
}
.lsb-toast.lsb-toast-out {
  opacity: 0;
  transform: translateX(20px);
}
@keyframes lsb-toast-in {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* 类型指示 */
.lsb-toast[data-type="success"] { border-left: 3px solid #4ade80; }
.lsb-toast[data-type="error"]   { border-left: 3px solid #f87171; }
.lsb-toast[data-type="info"]    { border-left: 3px solid #60a5fa; }
```

### 3.3 主题跟随

Toast 复用面板的 CSS 变量（`--lsb-bg`、`--lsb-fg`、`--lsb-border`、`--lsb-shadow`）。在 `applyPanelStyle()` 中，将 CSS 变量同时设置到 `document.documentElement`，使 toast 自然跟随主题切换。

---

## 4. 签到模块集成

### 4.1 signin 模块改动

**现有行为**：init 时只注册事件监听，不立即执行签到。5 分钟 poller 启动后第一次 tick 才签到。

**改进后**：init 时立即执行一次 `ensureSignedIn()`，然后启动 poller。

```javascript
// signin 模块 init 中新增
async function init() {
  // ... 现有事件监听注册 ...

  // 立即检查一次签到（页面加载时）
  if (user.info && user.info.id && getAutoSignin()) {
    try {
      const r = await ensureSignedIn();
      if (r && r.status === "signed-in" && r.action === "signed-in") {
        showSigninToast(r);
      } else if (r && r.status === "signed-in" && r.action === "none") {
        // 已签到（去重窗口内），不弹 toast
      }
    } catch (err) {
      log.warn("init signin check failed", err);
    }
  }

  // 启动 poller（现有逻辑）
  if (getAutoSignin()) _startAuto();
}
```

### 4.2 signin 模块数据流修正

当前 `performSignin()` 和 `ensureSignedIn()` 返回值不包含 `stats`（签到统计），但 toast 需要显示积分。需要修改返回值，将 `stats` 透传出来：

```javascript
// performSignin() 中，两种路径都需要返回 stats
// 路径 1: 已在签到页面
const fetched = await _fetchStatus(); // { status, csrf, hasForm, stats }
return { ok: true, status: "signed-in", source: "already-on-page", stats: fetched.stats };

// 路径 2: HTTP POST 签到
const after = await _fetchStatus();
return {
  ok: res.ok || after.status === "signed-in",
  status: after.status,
  source: "http-post",
  httpStatus: res.status,
  stats: after.stats,  // ← 新增
};
```

```javascript
// ensureSignedIn() 中，透传 stats
const r = await performSignin();
return { ...r, action: "signed-in" };  // stats 已包含在 r 中
```

### 4.3 Toast 消息内容

| 触发场景 | type | 消息 |
|---------|------|------|
| 自动签到成功 | `success` | 签到成功 ✓ +N 积分（N 从 result.stats.total 读取） |
| 手动签到成功 | `success` | 同上 |
| 签到失败 | `error` | 签到失败，请重试 |
| 已签到（去重） | 不弹 toast | — |
| 未登录 | 不弹 toast | — |

### 4.4 调用方式

```javascript
function showSigninToast(result) {
  if (!LSB.toast || typeof LSB.toast.show !== "function") return;
  if (result.ok && result.status === "signed-in") {
    const points = result.stats?.total ? ` +${result.stats.total} 积分` : "";
    LSB.toast.show(`签到成功 ✓${points}`, { type: "success" });
  } else if (!result.ok && result.reason) {
    if (result.reason !== "not-logged-in" && result.reason !== "unknown") {
      LSB.toast.show("签到失败，请重试", { type: "error", durationMs: 5000 });
    }
  }
}
```

### 4.4 手动签到也弹 toast

面板签到按钮点击后，`performSignin()` 返回结果，ui 模块在现有按钮文字变化逻辑之外，额外调用 `LSB.toast.show()`。

---

## 5. 错误处理与降级

| 场景 | 行为 |
|------|------|
| `LSB.toast` 未初始化 | 静默，签到流程正常进行 |
| `show()` 传入空 message | 静默忽略，不抛异常 |
| `durationMs` 超出范围 | 裁剪到 1000-30000ms |
| DOM 挂载失败 | 静默，后续 toast 调用无操作 |
| `destroy()` 重复调用 | 幂等安全 |
| 浏览器不支持 backdrop-filter | CSS 降级为纯色背景 |

---

## 6. 测试策略

### 6.1 新增测试

`test/toast.test.mjs`：

| 用例 | 覆盖 |
|------|------|
| `show()` 创建 DOM 元素 | 基本功能 |
| `show("", ...)` 静默忽略 | 参数校验 |
| 类型映射 | success/error/info → data-type |
| 队列上限 = 3 | 第 4 条挤掉第 1 条 |
| 自动 dismiss | durationMs 后元素移除 |
| 手动 dismiss | 点击关闭 |
| `destroy()` 清理 | 容器 + 定时器全部清除 |
| 幂等 `destroy()` | 多次调用不报错 |
| `durationMs` 裁剪 | 边界值 0 → 1000, 99999 → 30000 |

### 6.2 现有测试不变

- `checkin-parse.test.mjs` — 解析逻辑未改
- `notif-parse.test.mjs` — 通知解析未改
- 其他 core/lib 测试 — 均未改动

---

## 7. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/toast.mjs` | 新增 | `createToastManager()` 工厂函数 |
| `test/toast.test.mjs` | 新增 | 9 个测试用例 |
| `linux-sb-suite.user.js` | 修改 | 初始化 `LSB.toast`、注入 toast CSS、signin 模块 init 改动、ui 模块手动签到 toast |
| `dist/linux-sb-suite.user.js` | 构建 | `node build.mjs` 重新生成 |

---

## 8. 与已有功能借鉴提案的关系

本次 toast 功能是独立的新设计，不在[功能借鉴设计提案](2026-08-13-feature-borrowing-proposal.md)的 8 个功能中。它与提案中的 `signinTips`（顶部签到提醒条，自动签到关闭时）互补：

| 功能 | 触发条件 | 表现形式 |
|------|---------|---------|
| **Toast（本次）** | 自动签到开启，签到成功 | 右下角 toast 浮层 |
| **signinTips（提案）** | 自动签到关闭，今天未签 | 页面顶部黄底提示条 |

两者共同构成完整的签到体验闭环。

---

## 9. 验收标准

- [ ] `lib/toast.mjs` 纯函数，零外部依赖
- [ ] `test/toast.test.mjs` 9 个测试全部通过
- [ ] 开启自动签到，打开 linux.sb 任意页面 → 立即签到 → toast 提示
- [ ] 5 分钟轮询器继续工作，签到成功 → toast 提示
- [ ] 手动点击签到按钮 → toast 提示
- [ ] toast 跟随面板主题切换（light/dark）
- [ ] 3 条 toast 堆叠正确，超出自动移除
- [ ] Toast 点击可手动关闭
- [ ] 本地 Chrome 实测验证通过
- [ ] `node build.mjs` 构建成功
- [ ] dist/ 产物更新到 Greasy Fork