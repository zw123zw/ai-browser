# 浏览器命令设计架构（已实现）

> 本文档描述已实现的浏览器命令执行体系，基于实际代码 `src/browser/`、`src/input/`、`src/composables/`、`entrypoints/background.ts` 整理。
> 最后更新：2025-06-17（基于代码重写）

## Goal

设计浏览器命令的完整执行体系：语义骨架提取、`[command]` 指令格式、三重元素定位、完整事件触发、执行结果判定、失败重试机制、`[need_full]` 全页骨架兜底、标签页操作、视频控制。

本文档是统一输入架构的执行层实现，接收来自意图检测架构的 `[action]` 信号，负责在浏览器中实际执行操作。

---

## 一、整体架构概览

### 1.1 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  UI 层 — Vue 3 + Pinia                                          │
│  entrypoints/content/components/                                │
│  ChatPanel → InputBar → usePipeline()                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ processInput(text)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Composable 层 — usePipeline()                                  │
│  src/composables/usePipeline.ts                                 │
│  桥接 Vue 响应式 → Pipeline 回调，管理流式消息生命周期            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ callbacks
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Pipeline 层 — InputPipeline                                    │
│  src/input/pipeline.ts                                          │
│  路由 → Phase 1 → Phase 2 流式执行 → 重试循环                   │
├─────────────┬─────────────┬─────────────────────────────────────┤
│ InputRouter │ IntentDet.  │ ActionExecutor + SkeletonManager    │
│ src/input/  │ src/input/  │ src/browser/                        │
│ router.ts   │ intent-     │ action-executor.ts                  │
│             │ detector.ts │ skeleton.ts / local-html.ts         │
└─────────────┴─────────────┴─────────────────────────────────────┘
                            │ chrome.runtime.sendMessage
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Background 层 — Service Worker                                 │
│  entrypoints/background.ts                                      │
│  CORS 代理（proxy-fetch-stream）+ 标签页操作（tab-action）       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 骨架提取策略 | 每次重新提取（无缓存） | 简单可靠，永不过期，避免 DOM 变化导致缓存失效 |
| Phase 2 执行模式 | 流式单条执行（每次 1 条指令） | AI 执行一条后可看到最新页面状态，减少错误 |
| 重试策略 | 连续错误计数（最多 5 次） | 允许中间成功重置计数，避免单次失败中断整个流程 |
| 停止条件 | `done=1` 单一停止信号 | AI 在最后一步指令设置 `done:1`，系统执行后停止 |
| 元素定位 | 三重降级（elementId → fallbackSelector → 文本匹配） | 兼容骨架 ID 失效、CSS 选择器变化、纯文本兜底 |
| CORS 代理 | Background Service Worker | Manifest V3 限制，content script 无法直接跨域 |
| 标签页操作 | Background 代理 | chrome.tabs API 只在 background 中可用 |
| 指令去重 | completedKeys Set + cmdKey 匹配 | 防止 AI 重复输出已执行的指令 |

---

## 二、语义骨架提取

### 2.1 为什么不用原始 HTML

| 方式 | 大小 | Tokens 估算 |
|------|------|------------|
| 原始清洗 HTML | 15-60KB | 4000-15000 |
| 语义骨架 JSON | 2-8KB | 500-2000 |
| **节省** | **70-85%** | |

原始 HTML 90% 是布局容器（div/span），对 AI 定位元素没有帮助。

### 2.2 提取规则（实际实现）

**文件：** `src/browser/skeleton.ts`

**提取流程：**

```
doc.body.querySelectorAll('*')
    │
    ▼
① 可交互性检测 isClickable()
    │  ├─ 原生交互: a, button, input, select, textarea, label, summary, details
    │  ├─ contenteditable: true 或 ""
    │  ├─ 属性标记: [onclick], [role=button/link/menuitem/tab/option/switch/checkbox/radio], [tabindex]
    │  └─ CSS 样式: cursor:pointer
    │
    ▼
② 可见性检测 isElementVisible()
    │  ├─ display:none / visibility:hidden → 不可见
    │  └─ offsetParent !== null || position:fixed → 可见
    │
    ▼
③ 视口检测（垂直 + 水平）
    │  ├─ rect.top >= viewportHeight || rect.bottom <= 0 → 跳过
    │  ├─ rect.left >= viewportWidth || rect.right <= 0 → 跳过
    │  └─ rect.width < 1 || rect.height < 1 → 跳过
    │
    ▼
④ 提取元素信息 extractElement()
    │  ├─ 有文字 → text = 直接文字（截断 100 字符）
    │  ├─ 无文字 + 有图标子元素(svg/img/i/[class*=icon]) → text = "(icon)"
    │  ├─ 无文字 + 无图标 + 无 role + 无表单内容 → 跳过
    │  └─ 表单元素(input/textarea/select) 有 placeholder/value 时保留
    │
    ▼
⑤ 标注父级地标 findLandmarkParent()
    │  └─ 向上遍历: nav/header/main/aside/footer 或 role=navigation/banner/main 等
    │
    ▼
⑥ iframe 提取（同源 iframe）
    │  ├─ contentDocument 访问同源 iframe
    │  ├─ 坐标系叠加 iframe 自身偏移（vpOffsetX/vpOffsetY）
    │  ├─ parent 标记为 iframe.{id/class/name}（优先级: id > className[0] > name > "iframe"）
    │  └─ 跨域 iframe 通过 try/catch 跳过
    │
    ▼
⑦ 去重 + 过滤
    │  ├─ 父子同文本去重（保留子级，交互元素<a>/<button>不参与）
    │  ├─ 同级同文本去重（同一 parent 下，domParent 被移除时跳过去重）
    │  ├─ 空文本过滤（保留 a/button/input/select/textarea/有 role 的元素）
    │  └─ 上限 200 个元素（MAX_SKELETON_ELEMENTS）
    │
    ▼
输出 SemanticSkeleton
```

**实际代码：**

```typescript
// src/browser/skeleton.ts

const INTERACTIVE_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details']
const LANDMARK_TAGS = ['nav', 'header', 'main', 'aside', 'footer']
const LANDMARK_ROLES = ['navigation', 'banner', 'main', 'complementary', 'contentinfo']
const MAX_SKELETON_ELEMENTS = 200

function isClickable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (INTERACTIVE_TAGS.includes(tag)) return true
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true
  if (el.getAttribute('onclick')) return true
  const role = el.getAttribute('role')
  if (role && ['button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio'].includes(role)) return true
  if (el.getAttribute('tabindex')) return true
  try {
    const style = window.getComputedStyle(el)
    if (style.cursor === 'pointer') return true
  } catch {}
  return false
}

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return el.offsetParent !== null || style.position === 'fixed'
}

function getDirectText(el: HTMLElement): string {
  // 1. 直接子节点的文字
  // 2. 兜底: 子元素的 innerText（如 <a><span>关注</span></a>）
  // 3. 兜底: aria-label / title
  // 截断 100 字符
}
```

### 2.3 输出格式

```json
{
  "url": "https://www.example.com",
  "title": "示例网站",
  "elements": [
    {"id": "e1", "tag": "a", "text": "首页", "parent": "nav"},
    {"id": "e2", "tag": "input", "text": "(icon)", "parent": "header"},
    {"id": "e3", "tag": "button", "text": "登录"},
    {"id": "e4", "tag": "button", "text": "(icon)", "parent": "iframe.main"}
  ]
}
```

**实际类型定义（精简版）：**

```typescript
// src/browser/types.ts
interface SkeletonElement {
  id: string        // 唯一标识 e1, e2, ...
  tag: string       // 标签名
  text?: string     // 可见文字（截断 100 字符，含 ariaLabel/title/placeholder fallback）
  parent?: string   // 父级地标标签（nav/header/main/iframe.xxx）
}

interface SemanticSkeleton {
  url: string
  title: string
  elements: SkeletonElement[]
}
```

**注意：** 骨架元素只保留 `id`、`tag`、`text`、`parent` 四个字段。`href`、`src`、`type`、`placeholder`、`role`、`aria-label` 等属性不在骨架中。当视口骨架找不到目标时，AI 通过 `[need_full]` 获取全页骨架（同格式，覆盖所有可交互元素）。

### 2.4 SkeletonManager（骨架管理器）

```typescript
// src/browser/skeleton.ts
class SkeletonManager {
  getSkeleton(): SemanticSkeleton       // 视口骨架（每次重新提取）
  getFullSkeleton(): SemanticSkeleton   // 全页骨架（每次重新提取）
  invalidate(): void                     // 保留接口兼容，viewport 模式下无需操作
  dispose(): void                        // 保留接口兼容
  get cachedUrl(): string                // 保留接口兼容，始终返回 ""
}
```

**设计说明：** SkeletonManager 不缓存骨架，每次调用都重新提取。`getSkeleton()` 提取视口内骨架（200 元素上限），`getFullSkeleton()` 提取全页骨架（无上限）。这是因为 DOM 随时可能被 JavaScript 修改（SPA 路由、弹窗、懒加载），缓存会导致过期数据。简单可靠，永不过期。

### 2.5 全页骨架提取（`[need_full]` 兜底）

**文件：** `src/browser/local-html.ts`

当视口骨架无法定位目标元素时，AI 输出 `[need_full]` 标签，系统提取全页面所有可交互元素的骨架（与视口骨架格式一致），AI 直接使用 elementId 生成指令。

```typescript
export function extractFullPageSkeleton(): string | null
  // 1. 调用 extractFullSkeleton(document) 提取全页骨架
  // 2. 返回 JSON 字符串，未找到返回 null
```

**与视口骨架提取的区别：**

| 维度 | 视口骨架（`extractSkeleton`） | 全页骨架（`extractFullSkeleton`） |
|------|------------------------------|----------------------------------|
| 搜索范围 | 仅视口内 + 同源 iframe | 全页面 DOM + 同源 iframe |
| 可见性检查 | display:none + visibility:hidden + offsetParent | 同左（逻辑完全一致） |
| 视口检测 | ✅ 跳过视口外元素 | ❌ 跳过视口检测 |
| 元素上限 | 200 | 无上限 |
| 输出格式 | 结构化 JSON（id/tag/text/parent） | 同格式 |
| 用途 | AI 根据 elementId 精确定位（主路径） | AI 从全页元素中定位视口外目标（兜底） |

**提取流程：** 与视口骨架完全一致（可交互性检测 → 可见性检测 → 提取元素信息 → 地标标注 → iframe 提取 → 去重过滤），唯一区别是跳过视口边界检测，不限制元素数量。

**设计决策 — 不设元素上限：**

全页骨架的核心目的是找到视口骨架中没有的元素。设上限会导致目标元素可能被截断，使兜底机制不可靠。虽然复杂页面可能产生 500-1000 个元素（~10,000-20,000 tokens），但：
1. 去重逻辑（父子同文本、同级去重）显著减少元素数量
2. 这是兜底机制，仅在视口骨架找不到时触发，不是常态
3. 现代 LLM 上下文 128k+，一两万 tokens 的骨架完全可处理
4. 结构化骨架比 HTML 片段体积更可控、AI 更易理解

---

## 三、`[command]` 指令格式

### 3.1 指令结构

```typescript
// src/browser/types.ts
interface Command {
  action: string           // 操作类型
  elementId?: string       // 骨架元素 ID（主定位）
  fallbackSelector?: string // CSS 选择器（备选）
  text?: string            // type 操作输入文字
  url?: string             // navigate 目标 URL
  key?: string             // keyboard 按键
  direction?: string       // scroll 方向
  amount?: number          // scroll 像素
  ms?: number              // wait 毫秒
  description?: string     // 操作描述（日志 / 文本匹配兜底）
  tabAction?: 'newTab' | 'closeTab' | 'switchTab' | 'nextTab' | 'prevTab'
  tabQuery?: string        // switchTab 目标关键词
  done?: number            // 1=最后一步，0=还有步骤（用于停止判断）
  subAction?: string       // video 子操作（play/pause/volume/mute/seek/jump/speed/fullscreen）
  value?: number           // video 操作值（音量 0-1、快进秒数、播放速度等）
}
```

### 3.2 Action 能力域（16 种）

```
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
type        — 输入文字（需elementId+text）
clear       — 清空输入框（需elementId）
scroll      — 滚动页面（direction:up/down/top/bottom，amount:滚动像素，可选）
select      — 选择下拉框（需elementId+text）
keyboard    — 模拟按键（需key:Enter/Escape/Tab等，别名press）
focus       — 聚焦元素（需elementId）
hover       — 悬停元素（需elementId）
wait        — 等待（需ms）
newTab      — 打开新标签页
closeTab    — 关闭当前标签页
switchTab   — 切换到指定标签页（需tabQuery关键词，如"B站"、"淘宝"）
nextTab     — 切换到下一个标签页
prevTab     — 切换到上一个标签页
video       — 视频控制（需subAction: play/pause/volume/mute/unmute/seek/jump/speed）
```

### 3.3 `done` 标志

- `done: 0` — 中间步骤，还有后续操作
- `done: 1` — 最后一步，系统执行后立即停止

**停止条件：** AI 在最后一步指令设置 `done:1`，系统执行成功后 break 退出循环。

---

## 四、执行引擎（ActionExecutor）

**文件：** `src/browser/action-executor.ts`

### 4.1 三重元素定位

```typescript
private findElement(cmd: Command): HTMLElement | null {
  // 第一优先：elementId（骨架中的 id）
  if (cmd.elementId) {
    const el = document.querySelector(`[data-skeleton-id="${cmd.elementId}"]`)
    if (el) return el as HTMLElement
  }

  // 第二优先：fallbackSelector（CSS 选择器）
  if (cmd.fallbackSelector) {
    try {
      const el = document.querySelector(cmd.fallbackSelector)
      if (el) return el as HTMLElement
    } catch {} // 无效选择器，跳过
  }

  // 第三优先：文本内容匹配
  if (cmd.description) {
    const el = this.findByText(cmd.description)
    if (el) return el
  }

  return null
}
```

**不需要元素的操作：** `navigate`、`wait`、`scroll`、`keyboard`/`press`、`newTab`、`closeTab`、`switchTab`、`nextTab`、`prevTab` 不走元素定位。

**文本匹配 findByText() 策略：**

```
① 优先搜索交互元素（INTERACTIVE_TAGS + [role=button] + [onclick] + [tabindex]）
   匹配: textContent / aria-label / title / placeholder
    │
    ▼ 未找到
② 兜底搜索所有元素（覆盖 div/span + SVG 图标按钮）
   排除: script/style/svg
   匹配: textContent / aria-label / title / placeholder
   过滤: display:none / visibility:hidden
```

### 4.2 操作执行详情

#### click — 完整鼠标事件序列 + `<a>` 标签处理

```typescript
private async executeClick(el: HTMLElement): Promise<ActionResult> {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const mouseEventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }

  el.dispatchEvent(new MouseEvent('mousedown', mouseEventInit))
  el.dispatchEvent(new MouseEvent('mouseup', mouseEventInit))

  // <a> 标签：区分真实链接 vs JS 交互型链接
  if (el instanceof HTMLAnchorElement) {
    const href = el.getAttribute('href') || ''
    if (!href || href === '#' || href.startsWith('javascript:')) {
      // javascript: / # / 空 href → 依赖 JS 事件处理器，触发 click 事件
      el.dispatchEvent(new MouseEvent('click', mouseEventInit))
    } else if (el.href) {
      // 真实 URL → 根据 target 判断
      const target = el.target || '_self'  // 默认当前页面
      if (target === '_self') {
        window.location.href = el.href     // 当前页面跳转
      } else {
        const opened = window.open(el.href, target)
        if (!opened) window.location.href = el.href
      }
    }
  } else {
    el.dispatchEvent(new MouseEvent('click', mouseEventInit))
  }
  return { success: true, message: '点击成功' }
}
```

**设计说明：**
- 不使用 `el.click()`，而是手动 dispatch 完整的 mousedown → mouseup → click 事件序列
- `<a>` 标签区分真实链接（当前页面跳转或新标签页）和 JS 交互型链接（`javascript:`/`#`/空 href，触发 click 事件）
- 真实链接默认 `_self` 当前页面跳转，非 `_blank`（与早期设计不同）

#### type — React/Vue 兼容输入

```typescript
private async executeType(el: HTMLElement, text: string): Promise<ActionResult> {
  el.focus()
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // 使用 nativeInputValueSetter 绕过 React/Vue 受控组件
    const proto = el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (nativeSetter) {
      nativeSetter.call(el, text)
    } else {
      el.value = text
    }
  }

  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { success: true, message: `输入成功: ${text}` }
}
```

**设计说明：**
- 直接设置 `el.value` 会被 React/Vue 的受控组件覆盖
- 使用 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` 绕过框架拦截
- 必须触发 `input` + `change` 事件，否则框架不会感知到值变化
- `clear` 操作复用 `executeType(el, '')`

#### keyboard — 按键模拟 + 表单提交

```typescript
private async executeKeyboard(key: string): Promise<ActionResult> {
  const target = document.activeElement || document.body
  const keyEventInit = { key, code: this.getKeyCode(key), bubbles: true, cancelable: true }

  target.dispatchEvent(new KeyboardEvent('keydown', keyEventInit))
  target.dispatchEvent(new KeyboardEvent('keypress', keyEventInit))
  target.dispatchEvent(new KeyboardEvent('keyup', keyEventInit))

  // Enter 键：尝试提交表单（合成事件不触发浏览器默认行为）
  if (key === 'Enter') {
    // 优先从 activeElement 找 form
    if (target instanceof HTMLElement) {
      const form = target.closest('form')
      if (form) { form.requestSubmit(); return { success: true, message: '回车提交表单' } }
    }
    // 兜底：全局找搜索输入框并提交
    const searchInput = document.querySelector<HTMLInputElement>(
      'input[type="search"], input[name="q"], input[name="keyword"], input[name="wd"], input[placeholder*="搜索"], input[placeholder*="search"]'
    )
    if (searchInput) {
      const form = searchInput.closest('form')
      if (form) { form.requestSubmit(); return { success: true, message: '回车提交搜索表单' } }
    }
  }
  return { success: true, message: `键盘操作: ${key}` }
}
```

**getKeyCode() 映射：**

| key | code |
|-----|------|
| Enter | Enter |
| Escape/Esc | Escape |
| Tab | Tab |
| Backspace | Backspace |
| Delete | Delete |
| ArrowUp/Down/Left/Right | ArrowUp/Down/Left/Right |
| Home/End/PageUp/PageDown | Home/End/PageUp/PageDown |
| Space/空格 | Space |
| 单个字母 (a-z) | KeyA-KeyZ |
| 单个数字 (0-9) | Digit0-Digit9 |

#### navigate — Background 代理

```typescript
private async executeNavigate(url: string): Promise<ActionResult> {
  if (!url) return { success: false, message: '未指定 URL' }
  const response = await chrome.runtime.sendMessage({
    type: 'tab-action',
    action: 'newTab',
    url,
  })
  if (response?.success) {
    return { success: true, message: `新标签页打开: ${url}` }
  }
  return { success: false, message: response?.error || '导航失败' }
}
```

**设计说明：** 不直接使用 `window.open()`，而是通过 Background Service Worker 的 `chrome.tabs.create()` 打开，避免浏览器 popup 拦截。

#### scroll — 平滑滚动 + 重绘等待

```typescript
private async executeScroll(direction: string, amount?: number): Promise<ActionResult> {
  const scrollAmount = amount || window.innerHeight * 0.8
  switch (direction) {
    case 'up':     window.scrollBy(0, -scrollAmount); break
    case 'down':   window.scrollBy(0, scrollAmount); break
    case 'top':    window.scrollTo(0, 0); break
    case 'bottom': window.scrollTo(0, document.body.scrollHeight); break
  }
  // 等待浏览器完成滚动和重绘（两帧 + 500ms 保险）
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 500))))
  return { success: true, message: `滚动: ${direction}` }
}
```

#### video — 视频控制

```typescript
private async executeVideo(el: HTMLElement, subAction: string, value?: number): Promise<ActionResult> {
  // 找到 video 元素（可能是 el 本身，也可能是 el 的子元素或父元素附近）
  let video: HTMLVideoElement | null = null
  if (el instanceof HTMLVideoElement) {
    video = el
  } else {
    video = el.querySelector('video') || el.closest('video')
  }
  if (!video) return { success: false, message: '未找到视频元素' }

  switch (subAction) {
    case 'play':      await video.play(); return { success: true, message: '播放' }
    case 'pause':     video.pause(); return { success: true, message: '暂停' }
    case 'volume':    video.volume = Math.max(0, Math.min(1, value ?? 0.5)); video.muted = false; ...
    case 'mute':      video.muted = true; ...
    case 'unmute':    video.muted = false; ...
    case 'seek':      video.currentTime += (value ?? 10); ...  // 快进/快退（相对）
    case 'jump':      video.currentTime = value ?? 0; ...      // 跳转（绝对）
    case 'speed':     video.playbackRate = value ?? 1; ...
    case 'fullscreen': return { success: false, message: '全屏需要用户手势，请用 click 点击全屏按钮' }
  }
}
```

**设计说明：**
- `video` 操作会自动在 el 及其子元素/父元素中查找 `<video>` 标签
- `fullscreen` 因浏览器安全限制（需要用户手势）无法程序化调用，返回错误提示
- `seek` 是相对当前时间的快进/快退，`jump` 是绝对时间跳转

#### 标签页操作 — Background 代理

```typescript
private async executeTabAction(tabAction: 'newTab' | 'closeTab' | 'switchTab', tabQuery?: string): Promise<ActionResult> {
  const response = await chrome.runtime.sendMessage({
    type: 'tab-action',
    action: tabAction,
    query: tabQuery,
  })
  // ...
}
```

Background 处理逻辑（`entrypoints/background.ts`）：

| 操作 | 实现 |
|------|------|
| `newTab` | `chrome.tabs.create({ url })` |
| `closeTab` | `chrome.tabs.remove(sender.tab.id)` |
| `switchTab` (关键词) | `chrome.tabs.query({})` → title/url 匹配（含站点别名映射）→ `chrome.tabs.update(target, { active: true })` + `chrome.windows.update(windowId, { focused: true })` |
| `switchTab` (next/prev) | `chrome.tabs.query({ currentWindow: true })` → 计算 `(activeIndex ± 1) % tabs.length` → 切换 |

**站点别名映射：** `switchTab` 支持常见站点的别名，如 "B站" → 匹配 "bilibili"/"哔哩哔哩"，"油管" → 匹配 "youtube" 等。

---

## 五、完整处理流水线

### 5.1 流程概览（实际代码）

```
用户输入 "点击登录按钮"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  InputRouter（字符串分割，零 AI）                         │
│  src/input/router.ts → route(ctx)                        │
│                                                         │
│  /stop → { type: 'builtin', command, args }              │
│  /翻译 中文 → { type: 'builtin', command: 'unknown' }    │
│  其余 → { type: 'ai' }                                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 意图检测（流式输出 + 标签检测）                 │
│  src/input/intent-detector.ts → detectPhase1()           │
│                                                         │
│  输入：用户文本（无骨架）                                  │
│  消息构建：历史上下文（最近6条，去重数据）+ system prompt  │
│  Prompt：二分类                                          │
│    - 需要操作 → [action]                                  │
│    - 聊天 → 自然语言回复                                  │
│  禁止输出 [command]                                      │
│                                                         │
│  流式输出时检测操作标签：                                 │
│    正则: /\[(?:action|command)|(?:action|command)\]/     │
│    检测到 → clearContent=true，清掉流式内容               │
│    用户只看到"正在执行操作..."                             │
│                                                         │
│  结果：                                                   │
│    isChat=true + responseText → 流式展示聊天 → 结束      │
│    isChat=false → [action] → 进入 Phase 2                │
└─────────────────────────────────────────────────────────┘
    │
    ├── 聊天 → 流式展示 → 结束
    │
    └── [action] ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: 流式执行（每次 1 条指令 + 重试循环）            │
│  src/input/pipeline.ts → processPhase2WithRetry()        │
│                                                         │
│  核心循环：                                               │
│  while (consecutiveErrors < 5):                          │
│    1. 检查 abort signal（用户中途停止）                   │
│    2. 重新提取骨架（SkeletonManager.getSkeleton()）       │
│    3. 根据进入模式选择 coreRule（首次/流式/重试）          │
│    4. 调用 AI 生成 1 条指令（callStreamingAI）            │
│    5. 解析标签 → 分支处理                                │
│                                                         │
│  分支处理（优先级：command > need_full）：                 │
│    [command] → 指令去重检查 → ActionExecutor.execute()    │
│      成功 → completedKeys.add, consecutiveErrors=0       │
│           → done=1? break : wait 500ms → 下一轮          │
│      失败 → consecutiveErrors++, 记录 lastError → 重试   │
│    [need_full] → extractFullPageSkeleton() → 重试        │
│    无标签 → break（所有步骤完成）                         │
│                                                         │
│  超过 5 次连续错误 → "未找到对应元素，请准确说出您的需求" │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  聊天中展示执行结果 → 结束
```

### 5.2 Phase 1 流式标签检测（详细）

```typescript
// src/input/pipeline.ts → process()

callbacks.onChatStart()
let phase1StreamedContent = ''
let phase1ActionTagDetected = false

const p1 = await this.detector.detectPhase1(ctx.text, (delta, reasoningDelta) => {
  // reasoning → 更新思考内容
  if (reasoningDelta) callbacks.onChatDelta('', reasoningDelta)

  if (delta) {
    phase1StreamedContent += delta

    if (!phase1ActionTagDetected) {
      callbacks.onChatDelta(delta)  // 正常流式更新

      // 检测操作标签 → 清掉内容
      // 关键词必须带 [ 或 ]，防止聊天中提到 "action" 等词误触发
      if (/\[(?:action|command)|(?:action|command)\]/.test(phase1StreamedContent)) {
        phase1ActionTagDetected = true
        callbacks.onChatDelta('', undefined, true)  // clearContent=true
      }
    }
  }
})

// 聊天 → 用完整回复替换"思考中"
if (p1.isChat && p1.responseText) {
  callbacks.onChatDelta(p1.responseText)
  callbacks.onChatEnd()
  return
}

// [action] → Phase 2
callbacks.onActionDetected()
await this.processPhase2WithRetry(ctx.text, callbacks)
```

**用户体验：**
- 聊天：流式打字效果 → 完整回复
- 操作：思考中... → 正在执行操作... → 🔧 正在执行第 N 条指令 → ✅/❌ 结果

### 5.3 Phase 2 流式执行循环

> 核心设计：AI 每次只生成 1 条指令，系统立即执行并反馈结果，AI 根据最新页面状态决定下一步。

**与旧版批量执行的区别：**

| 维度 | 旧版（批量） | 新版（流式单条） |
|------|------------|----------------|
| AI 输出 | 一次输出所有指令 | 每次只输出 1 条 |
| 执行方式 | 逐条执行全部指令 | 执行 1 条 → 反馈 → AI 再生成下一条 |
| 骨架新鲜度 | 执行中途骨架可能过期 | 每步都重新提取骨架 |
| 错误恢复 | 整批重做 | 只重试失败的那一步 |
| 指令去重 | 无 | completedKeys Set 防止重复执行 |

**流程示例：**

```
用户: "切换到短信登录，输入手机号18674069215，点击发送验证码"

AI 首次回复:
  [command]{"action":"click","elementId":"e23","description":"短信登录","done":0}[/command]

系统执行: click e23 ✅ → completed=[{action:"click",elementId:"e23"}] → 等待 500ms

AI 第二次回复（带骨架 + 已完成列表）:
  [command]{"action":"type","elementId":"e30","text":"18674069215","description":"手机号","done":0}[/command]

系统执行: type e30 ✅ → completed=[...,{action:"type",elementId:"e30"}] → 等待 500ms

AI 第三次回复:
  [command]{"action":"click","elementId":"e45","description":"获取验证码","done":1}[/command]

系统执行: click e45 ✅ → done=1 → 停止
```

```typescript
// src/input/pipeline.ts → processPhase2WithRetry()

private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void> {
  const completed: Array<{ action: string; elementId?: string; description?: string }> = []
  const completedKeys = new Set<string>()  // 指令去重 key 集合
  let consecutiveErrors = 0
  let lastError = ''
  let lastFailedCommand = null
  let lastFullSkeleton: string | null = null

  while (consecutiveErrors < MAX_RETRY) {
    // ★ 检查 abort signal，支持用户中途停止
    const signal = this.options.getSignal?.()
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')

    // 每轮重新提取骨架
    const skeleton = this.skeletonManager.getSkeleton()

    // 根据进入模式选择 coreRule
    const isFirstEntry = completed.length === 0 && !lastError
    const coreRule = isFirstEntry ? MODE_FIRST : (lastError ? MODE_RETRY : MODE_STREAMING)

    // AI 生成 1 条指令
    const phase2Result = await this.callStreamingAI(text, skeleton, completed, lastError, lastFailedCommand, lastFullSkeleton, coreRule)

    // ── 无标签 → AI 无输出，任务完成 ──
    if (!phase2Result.commands?.length && !phase2Result.needFull) break

    // ── command → 执行单条指令（优先于 need_full） ──
    if (phase2Result.commands?.length) {
      const cmd = phase2Result.commands[0]

      // ★ 指令去重：和已完成的指令比较，重复则跳过执行
      const cmdKey = `${cmd.action}:${cmd.url || cmd.elementId || cmd.description || ''}`
      if (completedKeys.has(cmdKey)) {
        if (cmd.done === 1) break
        continue
      }

      callbacks.onCommandsParsed([cmd], completed.length + 1)
      const result = await this.executor.execute(cmd)
      callbacks.onCommandResult(cmd.action, result.success, result.message)

      if (result.success) {
        completed.push({ action: cmd.action, elementId: cmd.elementId, description: cmd.description })
        completedKeys.add(cmdKey)
        consecutiveErrors = 0
        lastError = ''
        lastFailedCommand = null
        lastFullSkeleton = null

        if (cmd.action === 'navigate') this.skeletonManager.invalidate()

        // ★ done=1 → 最后一步完成，停止
        if (cmd.done === 1) break

        // command 成功 → 跳过同响应的 need_full，等骨架刷新后下一轮处理
        await new Promise(resolve => setTimeout(resolve, 500))
        continue
      } else {
        lastError = `[${cmd.action}] ${result.message}`
        lastFailedCommand = { action: cmd.action, elementId: cmd.elementId, description: cmd.description, text: cmd.text, url: cmd.url }
        consecutiveErrors++
        callbacks.onRetryMessage(...)
        // command 失败 → 继续检查 need_full
      }
    }

    // ── need_full → 提取全页骨架后重试 ──
    if (phase2Result.needFull) {
      const fullSkeleton = extractFullPageSkeleton()
      lastError = '当前视口骨架未找到目标元素，已提取全页骨架'
      lastFailedCommand = null
      lastFullSkeleton = fullSkeleton
      consecutiveErrors++
      continue
    }
  }

  if (consecutiveErrors >= MAX_RETRY) {
    callbacks.onError('未找到对应元素，请准确说出您的需求')
  } else if (completed.length > 0) {
    callbacks.onAllCommandsDone?.(text, completed.map(c => ({ action: c.action, elementId: c.elementId })))
  }
}
```

### 5.4 流式 AI 调用（每次 1 条指令）

```typescript
// src/input/pipeline.ts → callStreamingAI()

private async callStreamingAI(
  text: string,
  skeleton: SemanticSkeleton,
  completed: Array<{ action: string; elementId?: string; description?: string }>,
  lastError: string,
  lastFailedCommand?: { action: string; elementId?: string; description?: string; text?: string; url?: string } | null,
  lastFullSkeleton?: string | null,
  coreRule = MODE_STREAMING,
): Promise<Phase2Result> {
  const adapter = createAdapter(model.provider || settings.provider)

  const systemPrompt = PHASE2_SYSTEM_PROMPT
    .replace('{coreRule}', coreRule)
  const userContent = buildStreamingUserMessage(text, skeleton, completed, lastError || undefined, lastFailedCommand || undefined, lastFullSkeleton || undefined)

  let fullResponse = ''
  await adapter.chat(
    { baseUrl, apiKey, modelName, messages: [{ role: 'user', content: `${systemPrompt}\n\n${userContent}` }], signal },
    (chunk) => { if (chunk.delta) fullResponse += chunk.delta },
  )

  const tags = extractTags(fullResponse)

  // 流式模式：只取第一条指令
  const firstCommand = tags.commands?.slice(0, 1)

  return {
    commands: firstCommand,
    needFull: tags.needFull,
    rawAiOutput: fullResponse,
  }
}
```

**用户消息构建 buildStreamingUserMessage()：**

```typescript
function buildStreamingUserMessage(text, skeleton, completed, lastError, lastFailedCommand, fullSkeleton): string {
  const parts = []
  parts.push(`[原始请求] 用户: "${text}"`)

  if (completed.length > 0) {
    const completedList = completed.map((c, i) =>
      `${i + 1}. ${c.action}${c.elementId ? ` ${c.elementId}` : ''}${c.description ? ` (${c.description})` : ''}`
    ).join('\n')
    parts.push(`[已完成] ${completedList}`)
  }

  if (lastError) {
    const errorParts = [`[上次错误] ${lastError}`]
    if (lastFailedCommand) errorParts.push(`[失败指令] ${JSON.stringify(lastFailedCommand)}`)
    parts.push(errorParts.join('\n'))
  }

  if (fullSkeleton) parts.push(`[全页骨架]\n${fullSkeleton}`)

  parts.push(`[当前页面骨架]\n${JSON.stringify(skeleton)}`)

  return parts.join('\n\n')
}
```

**消息组成：**

| 字段 | 条件 | 作用 |
|------|------|------|
| `[原始请求]` | 始终 | AI 知道用户的完整意图 |
| `[已完成]` | completed.length > 0 | AI 知道哪些步骤已完成，不重复执行 |
| `[上次错误]` | lastError 有值 | AI 知道哪里失败，调整策略 |
| `[失败指令]` | lastFailedCommand 有值 | AI 看到具体的失败指令 JSON |
| `[全页骨架]` | fullSkeleton 有值 | need_full 触发时的全页骨架，AI 直接用 elementId |
| `[当前页面骨架]` | 始终 | 页面可能已变化，AI 基于当前状态生成指令 |

### 5.5 指令去重机制

```typescript
// src/input/pipeline.ts
const cmdKey = `${cmd.action}:${cmd.url || cmd.elementId || cmd.description || ''}`
if (completedKeys.has(cmdKey)) {
  // 重复指令，跳过执行
  if (cmd.done === 1) break  // 重复指令 done=1，停止
  continue
}
```

**设计说明：** 在流式单条执行模式下，AI 可能重复输出已执行的指令。`completedKeys` Set 存储已成功执行的指令 key（格式 `action:identifier`），重复时跳过执行。

---

## 六、聊天中展示

### 6.1 usePipeline 回调 → 消息映射

**文件：** `src/composables/usePipeline.ts`

| 回调 | 消息格式 | 消息类型 |
|------|---------|---------|
| `onChatStart` | 创建占位消息（`status: 'streaming'`） | assistant |
| `onChatDelta` | 流式追加内容（打字机效果） | assistant |
| `onChatEnd` | `status: 'streaming'` → `'done'` | assistant |
| `onActionDetected` | `content = '正在执行操作...'`, `status = 'done'` | assistant |
| `onCommandsParsed` | 移除占位消息，添加 `🔧 **正在执行第 N 条指令：**\n1. **action** — description` | system |
| `onCommandResult` | `✅ **action** — message` 或 `❌ **action** — message` | system |
| `onAllCommandsDone` | 存为 assistant 消息 `已执行: action(desc); action(url)` | assistant |
| `onRetryMessage` | 移除占位消息，添加 `🔄 **正在重试第 N 条指令：**\n1. **action** — description` | system |
| `onError` | `❌ 未找到对应元素，请准确说出您的需求` | system |

### 6.2 流式消息生命周期

```
onChatStart()
  │  创建 reactive({ content: '', status: 'streaming' })
  │  push 到 conversation.messages
  ▼
onChatDelta(delta)  ←── Phase 1 流式回调
  │  currentStreamingMsg.content += delta
  │  触发 Vue 响应式更新 → UI 打字机效果
  ▼
┌─── 聊天路径 ───┐    ┌─── 操作路径 ───┐
│ onChatDelta(   │    │ onActionDetected│
│   responseText)│    │ content='执行中'│
│ onChatEnd()    │    │ status='done'   │
│ status='done'  │    └────────────────┘
└────────────────┘           │
                             ▼
                     onCommandsParsed()
                       │ 移除占位消息
                       │ addSystemMessage('🔧...')
                       ▼
                     onCommandResult() × N
                       │ addSystemMessage('✅/❌...')
                       ▼
                     onAllCommandsDone()
                       │ push assistant 消息
                       ▼
                     结束
```

---

## 七、Tag 解析器

**文件：** `src/input/tag-parser.ts`

```typescript
interface ExtractedTags {
  chatText?: string                              // [chat] 内的文本
  commands?: Command[]                           // [command] 列表
  isAction: boolean                              // 是否包含 [action]
  needFull?: boolean                              // [need_full]
  hasAnyTag: boolean                             // 是否提取到了任何标签
  rawText: string                                // 原始文本
}

function extractTags(rawText: string): ExtractedTags
  // 正则匹配 [chat], [command](多条), [action], [need_full]
  // 支持闭合标签 [tag]...[/tag] 和非闭合 fallback [tag]{...}
  // [need_full] 无需 JSON 解析，检测到标签即触发

function isChatOnlyReply(tags: ExtractedTags): boolean
  // 无操作标签 + 有文本 = true

function getChatText(tags: ExtractedTags): string
  // [chat] 标签内容 → 否则 rawText
```

**标签解析优先级：**

```
[chat]      → 纯聊天回复
[action]    → 需要操作（Phase 1 输出）
[command]   → 浏览器指令（支持多条，流式模式只取第一条）
[need_full] → 需要全页骨架兜底
```

**解析策略：**
1. 闭合标签优先：`[tag]...[/tag]`
2. 非闭合 fallback：`[tag]{...}`（取标签后的整个 JSON 对象）
3. `[need_full]` 无需 JSON，检测到标签即触发

---

## 八、提示词管理

**文件：** `src/input/prompts.ts`

### 8.1 能力域（所有 Prompt 共用）

```typescript
export const CAPABILITY_DOMAIN = `\`\`\`
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
type        — 输入文字（需elementId+text）
clear       — 清空输入框（需elementId）
scroll      — 滚动页面（direction:up/down/top/bottom，amount:滚动像素，可选）
select      — 选择下拉框（需elementId+text）
keyboard    — 模拟按键（需key:Enter/Escape/Tab等，别名press）
focus       — 聚焦元素（需elementId）
hover       — 悬停元素（需elementId）
wait        — 等待（需ms）
newTab      — 打开新标签页
closeTab    — 关闭当前标签页
switchTab   — 切换到指定标签页（需tabQuery关键词，如"B站"、"淘宝"）
nextTab     — 切换到下一个标签页
prevTab     — 切换到上一个标签页
\`\`\``
```

### 8.2 Phase 1 提示词（二分类）

```typescript
export const PHASE1_SYSTEM_PROMPT = `\`\`\`
你是浏览器扩展的 AI 助手，负责判断用户输入是否需要浏览器操作。

判断规则：
- 需要操作页面 → [action]
- 纯聊天/问答 → 自然语言回复

操作类型：打开/搜索/点击/输入/滚动/播放/暂停/翻译/下载等

示例：
- "打开B站" → [action]
- "继续播放" → [action]
- "搜索Vue教程" → [action]
- "今天天气怎么样" → 直接回答
- "你好" → 直接回答

输出格式（严格二选一）：
1. [action]（单独输出，无其他内容）
2. 自然语言回复（纯聊天内容）

禁止输出 [command]、操作结果（"已执行"等）或分析说明。
\`\`\``
```

### 8.3 Phase 2 提示词（操作决策 — 统一模板）

**设计原则**：一套 system prompt 模板，通过 `{coreRule}` 占位符运行时替换，适配三种进入模式。user message 只放数据，不含指令说明。

```typescript
export const PHASE2_SYSTEM_PROMPT = `\`\`\`
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
{coreRule}

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=这是最后一步，任务全部完成 0=还有后续步骤
- 单步任务（打开网站、搜索、滚动等）必须 done:1，禁止拆成多步
- 根据[已完成]指令判断：用户请求的操作已全部完成时，必须设置 done:1
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_full] 当前视口骨架找不到目标时，输出此标签获取全页骨架：
[need_full]
- 系统会返回全页面所有可交互元素的骨架（格式同上）
- 收到全页骨架后，直接用 elementId 生成 [command]

能力域：
${CAPABILITY_DOMAIN}

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]
- [need_full] 不需要闭合，单独输出即可
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [command] / [need_full] 标签，其他内容一律禁止。
\`\`\``
```

**模板替换常量：**

```typescript
// 三种进入模式
export const MODE_FIRST = '每次只生成1条指令，系统执行后反馈结果再生成下一条。'
export const MODE_STREAMING = '按照以下信息和格式，生成下一条指令。'
export const MODE_RETRY = '上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。'
```

**替换逻辑（pipeline.ts）：**

```typescript
const isFirstEntry = completed.length === 0 && !lastError
const coreRule = isFirstEntry ? MODE_FIRST : (lastError ? MODE_RETRY : MODE_STREAMING)

const systemPrompt = PHASE2_SYSTEM_PROMPT
  .replace('{coreRule}', coreRule)
```

### 8.4 用户消息构建（buildStreamingUserMessage）

**统一函数**：三种进入模式共用一个 `buildStreamingUserMessage`，根据参数动态组装字段。

```typescript
function buildStreamingUserMessage(
  text: string,                    // 用户原始输入
  skeleton: SemanticSkeleton,      // 最新页面骨架
  completed: Array<{...}>,         // 已执行步骤
  lastError?: string,              // 错误描述
  lastFailedCommand?: {...},       // 失败的指令 JSON
  fullSkeleton?: string,           // need_full 触发时的全页骨架 JSON
): string
```

**字段组装逻辑：**

| 字段 | 条件 | 格式 |
|------|------|------|
| `[原始请求]` | 始终 | `用户: "点击登录"` |
| `[已完成]` | `completed.length > 0` | `1. navigate https://...\n2. click e3 (登录)` |
| `[上次错误]` | `lastError` 有值 | `[click] 元素不可见` |
| `[失败指令]` | `lastFailedCommand` 有值 | `{"action":"click","elementId":"e5","description":"登录"}` |
| `[全页骨架]` | `fullSkeleton` 有值 | need_full 触发时的全页骨架 |
| `[当前页面骨架]` | 始终 | `{"url":"...","elements":[...]}` |

### 8.5 发送给 AI 的完整内容（三种场景）

#### 场景 1：首次进入

`completed=[], lastError='', isFirstEntry=true`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
每次只生成1条指令，系统执行后反馈结果再生成下一条。

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=这是最后一步，任务全部完成 0=还有后续步骤
- 单步任务（打开网站、搜索、滚动等）必须 done:1，禁止拆成多步
- 根据[已完成]指令判断：用户请求的操作已全部完成时，必须设置 done:1
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_full] 当前视口骨架找不到目标时，输出此标签获取全页骨架：
[need_full]
- 系统会返回全页面所有可交互元素的骨架（格式同上）
- 收到全页骨架后，直接用 elementId 生成 [command]

能力域：
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
type        — 输入文字（需elementId+text）
clear       — 清空输入框（需elementId）
scroll      — 滚动页面（direction:up/down/top/bottom，amount:滚动像素，可选）
select      — 选择下拉框（需elementId+text）
keyboard    — 模拟按键（需key:Enter/Escape/Tab等，别名press）
focus       — 聚焦元素（需elementId）
hover       — 悬停元素（需elementId）
wait        — 等待（需ms）
newTab      — 打开新标签页
closeTab    — 关闭当前标签页
switchTab   — 切换到指定标签页（需tabQuery关键词，如"B站"、"淘宝"）
nextTab     — 切换到下一个标签页
prevTab     — 切换到上一个标签页

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]
- [need_full] 不需要闭合，单独输出即可
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [command] / [need_full] 标签，其他内容一律禁止。

────────────────────────────────────

[原始请求] 用户: "点击登录"

[当前页面骨架]
{"url":"https://example.com","title":"登录页","elements":[
  {"id":"e1","tag":"input","text":"","parent":"main"},
  {"id":"e2","tag":"input","text":"","parent":"main"},
  {"id":"e3","tag":"button","text":"登录","parent":"main"}
]}
```

#### 场景 2：流式执行（成功后下一步）

`completed=[{action:"navigate",url:"https://example.com"}], lastError='', isFirstEntry=false`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
按照以下信息和格式，生成下一条指令。

═══ 指令 ═══
...（同上，省略重复部分）

────────────────────────────────────

[原始请求] 用户: "点击登录"

[已完成]
1. navigate https://example.com

[当前页面骨架]
{"url":"https://example.com","title":"登录页","elements":[
  {"id":"e1","tag":"input","text":"","parent":"main"},
  {"id":"e2","tag":"input","text":"","parent":"main"},
  {"id":"e3","tag":"button","text":"登录","parent":"main"}
]}
```

#### 场景 3：错误重试 — 指令执行失败

`completed=[{action:"navigate",...}], lastError="[click] 元素不可见", lastFailedCommand={action:"click",elementId:"e5",description:"登录"}, isFirstEntry=false`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。

═══ 指令 ═══
...（同上）

────────────────────────────────────

[原始请求] 用户: "点击登录"

[已完成]
1. navigate https://example.com

[上次错误] [click] 元素不可见
[失败指令] {"action":"click","elementId":"e5","description":"登录"}

[当前页面骨架]
{"url":"https://example.com","title":"登录页","elements":[
  {"id":"e1","tag":"input","text":"","parent":"main"},
  {"id":"e2","tag":"input","text":"","parent":"main"},
  {"id":"e3","tag":"button","text":"登录","parent":"main"}
]}
```

#### 场景 4：错误重试 — need_full 触发后

`completed=[{action:"navigate",...}], lastError='当前视口骨架未找到目标元素，已提取全页骨架', lastFailedCommand=null, lastFullSkeleton='{"url":"...","elements":[...,{"id":"e150","tag":"a","text":"收藏","parent":"main"},...]}', isFirstEntry=false`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。

═══ 指令 ═══
...（同上）

────────────────────────────────────

[原始请求] 用户: "收藏页面"

[已完成]
1. navigate https://example.com/article/123

[上次错误] 当前视口骨架未找到目标元素，已提取全页骨架

[全页骨架]
{"url":"https://example.com/article/123","title":"文章详情","elements":[
  {"id":"e6","tag":"a","text":"首页","parent":"header"},
  {"id":"e10","tag":"a","text":"(icon)","parent":"header"},
  {"id":"e150","tag":"a","text":"收藏","parent":"main"},
  {"id":"e151","tag":"button","text":"收藏本片","parent":"main"},
  {"id":"e57","tag":"a","text":"推荐本片"}
]}

[当前页面骨架]
{"url":"https://example.com/article/123","title":"文章详情","elements":[
  {"id":"e6","tag":"a","text":"首页","parent":"header"},
  {"id":"e10","tag":"a","text":"(icon)","parent":"header"},
  {"id":"e57","tag":"a","text":"推荐本片"}
]}
```

### 8.6 字段对比总结

| 字段 | 首次进入 | 流式执行 | 错误重试 |
|------|:-------:|:-------:|:-------:|
| `{coreRule}` | 每次只生成1条指令，系统执行后反馈结果再生成下一条。 | 按照以下信息和格式，生成下一条指令。 | 上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。 |
| `[原始请求]` | ✅ | ✅ | ✅ |
| `[已完成]` | ❌ | ✅ | ✅ |
| `[上次错误]` | ❌ | ❌ | ✅ |
| `[失败指令]` | ❌ | ❌ | ✅ |
| `[全页骨架]` | ❌ | ❌ | ✅/❌ |
| `[当前页面骨架]` | ✅ | ✅ | ✅ |

### 8.7 IntentDetector 消息构建

**文件：** `src/input/intent-detector.ts`

IntentDetector 的 `callAI()` 方法构建消息列表：

1. 获取历史上下文（最近 6 条消息，过滤空内容）
2. 清洗重数据 `stripHeavyData()`：
   - 去掉骨架 JSON（`页面骨架:` 后的所有内容）
   - 去掉全页骨架 JSON（`[全页骨架]:` 后的所有内容）
3. 拼接 system prompt 到用户消息前面（`用户输入: ${userContent}`）
4. 兼容不支持 system role 的 API

```typescript
// 历史消息清洗
function stripHeavyData(content: string): string {
  result = content.replace(/页面骨架:\n[\s\S]*?(?=\n\n|$)/g, '页面骨架: [已省略]')
  result = result.replace(/```html\n[\s\S]*?\n```/g, '[HTML已省略]')
  return result
}
```

---

## 九、关键方法签名

### InputPipeline

```typescript
// src/input/pipeline.ts
class InputPipeline {
  constructor(options: PipelineOptions)

  async process(ctx: InputContext, callbacks: PipelineCallbacks): Promise<void>
    // 主入口: 路由 → Phase 1 → Phase 2

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void>
    // 流式执行循环: 连续错误 < 5 次, 每次 1 条指令

  private async callStreamingAI(text, skeleton, completed, lastError, lastFailedCommand, lastFullSkeleton, coreRule): Promise<Phase2Result>
    // 调用 AI 生成 1 条指令（流式），只取第一条 [command]
}
```

### PipelineOptions

```typescript
interface PipelineOptions {
  getSettings: () => AppSettings
  getModelId?: () => string
  getSkillList?: () => string
  getRecentMessages?: () => Array<{ role: 'user' | 'assistant'; content: string }>
  getSignal?: () => AbortSignal | undefined
  onSkillActivate?: (name: string, userText: string) => Promise<{ success: boolean; message: string }>
  onBuiltinCommand?: (command: string, args: string) => void
}
```

### IntentDetector

```typescript
// src/input/intent-detector.ts
class IntentDetector {
  constructor(options: IntentDetectorOptions)

  async detectPhase1(text: string, onChunk?): Promise<Phase1Detection>
    // 返回: { isChat, responseText?, rawText }

  async detectPhase2(text: string, skeleton: SemanticSkeleton): Promise<Phase2Result>
    // 返回: { commands?, needFull?, rawAiOutput }
    // 保留接口，流式模式下由 pipeline.callStreamingAI() 替代

  private async callAI(scene, systemPrompt, userContent, onChunk?): Promise<string>
    // scene: 'Phase1' | 'Phase2'
}
```

### ActionExecutor

```typescript
// src/browser/action-executor.ts
class ActionExecutor {
  async execute(cmd: Command): Promise<ActionResult>
  private findElement(cmd: Command): HTMLElement | null  // 三重定位
  private findByText(text: string): HTMLElement | null    // 文本模糊匹配
}
```

### SkeletonManager

```typescript
// src/browser/skeleton.ts
function extractSkeleton(doc: Document, scope?: 'viewport' | 'full'): SemanticSkeleton
function extractFullSkeleton(doc: Document): SemanticSkeleton  // scope='full' 的快捷方式
class SkeletonManager {
  getSkeleton(): SemanticSkeleton       // 视口骨架（每次重新提取）
  getFullSkeleton(): SemanticSkeleton   // 全页骨架（每次重新提取）
  invalidate(): void                     // 保留接口兼容
  dispose(): void                        // 保留接口兼容
  get cachedUrl(): string                // 保留接口兼容
}
```

### TagParser

```typescript
// src/input/tag-parser.ts
function extractTags(rawText: string): ExtractedTags
function isChatOnlyReply(tags: ExtractedTags): boolean
function getChatText(tags: ExtractedTags): string
```

### usePipeline

```typescript
// src/composables/usePipeline.ts
function usePipeline(): {
  isProcessing: Ref<boolean>
  processInput: (text: string) => Promise<void>
  executeCommand: (cmd: Command) => Promise<ActionResult>
  addSystemMessage: (content: string) => void
  abort: () => void
}
```

---

## 十、Background Service Worker

**文件：** `entrypoints/background.ts`

### 10.1 消息类型

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `aib-toggle` | Background → Content | 切换抽屉显示/隐藏 |
| `proxy-fetch` | Content → Background | 代理非流式 HTTP 请求（避免 CORS） |
| `proxy-fetch-stream` | Content → Background | 代理流式 HTTP 请求（SSE） |
| `stream-chunk` | Background → Content | 转发 SSE 数据块 |
| `stream-end` | Background → Content | SSE 流结束 |
| `stream-error` | Background → Content | SSE 流错误 |
| `abort-stream` | Content → Background | 中止进行中的 SSE 流 |
| `tab-action` | Content → Background | 标签页操作（newTab/closeTab/switchTab） |
| `read-local-file` | Content → Background | 读取本地文件（Content Script 无法 fetch file://） |
| `aib-drawer-changed` | Content → Background | 抽屉状态变化，广播到其他标签页 |
| `aib-drawer-sync` | Background → Content | 同步其他标签页的抽屉状态 |

### 10.2 流式代理流程

```
Content Script                     Background                      AI API
     │                                │                              │
     │── proxy-fetch-stream ─────────►│                              │
     │                                │── fetch(url) ──────────────►│
     │◄── { requestId } ─────────────│                              │
     │                                │◄── SSE chunks ──────────────│
     │◄── stream-chunk (buffer) ─────│                              │
     │◄── stream-chunk (buffer) ─────│                              │
     │◄── ... ───────────────────────│                              │
     │                                │◄── stream end ──────────────│
     │◄── stream-end ────────────────│                              │
     │                                │                              │
     │── abort-stream ──────────────►│                              │
     │                                │── reader.cancel() ─────────►│
     │◄── stream-end ────────────────│                              │
```

**中止机制：** `activeStreams` Map 存储 `{ reader, tabId }`，key 为 requestId。中止时 `reader.cancel()` + 从 Map 删除 + 通知 content script。

### 10.3 标签页操作

```typescript
// entrypoints/background.ts

// 站点别名映射（用户说法 → 实际标题/URL 关键词）
const SITE_ALIASES: Record<string, string[]> = {
  'b站': ['bilibili', '哔哩哔哩'],
  '淘宝': ['taobao', '淘宝'],
  '京东': ['jd.com', '京东'],
  '百度': ['baidu', '百度'],
  '谷歌': ['google', '谷歌'],
  'github': ['github'],
  '掘金': ['juejin', '掘金'],
  '知乎': ['zhihu', '知乎'],
  '微博': ['weibo', '微博'],
  '抖音': ['douyin', '抖音', 'tiktok'],
  'youtube': ['youtube', 'youtube'],
  '油管': ['youtube', 'youtube'],
  'twitter': ['twitter', 'x.com'],
  '推特': ['twitter', 'x.com'],
  '网易': ['163.com', '网易'],
  '腾讯': ['qq.com', '腾讯'],
  '必应': ['bing', '必应'],
}
```

---

## 十一、目录结构

```
src/
├── browser/
│   ├── types.ts                    # SkeletonElement, Command, ActionResult, INTERACTIVE_TAGS
│   ├── skeleton.ts                 # extractSkeleton() + extractFullSkeleton() + SkeletonManager（无缓存，每次重新提取）
│   ├── action-executor.ts          # ActionExecutor（16 种操作 + 三重定位 + 完整事件序列）
│   ├── local-html.ts               # extractFullPageSkeleton()（全页骨架提取，兜底用）
│   └── index.ts
├── input/
│   ├── types.ts                    # InputContext, InputResult, PipelineCallbacks
│   ├── router.ts                   # InputRouter → builtin/ai 分流（/ 前缀解析）
│   ├── intent-detector.ts          # IntentDetector（Phase 1 二分类 + Phase 2 保留接口 + 历史消息清洗）
│   ├── pipeline.ts                 # InputPipeline（流式单条执行 + 连续错误重试 + 指令去重 + abort 支持）
│   ├── tag-parser.ts               # extractTags() + isChatOnlyReply() + getChatText() + need_full 检测
│   ├── prompts.ts                  # 所有 AI 提示词（Phase1/Phase2 + 3 种模式常量 + 消息构建函数）
│   └── index.ts
├── composables/
│   └── usePipeline.ts              # Vue 集成（流式消息生命周期 + 回调 → 消息映射 + abort 支持）
├── adapters/
│   ├── base.ts                     # BaseAdapter 抽象类
│   ├── openai.ts                   # OpenAIAdapter（支持 OpenAI + Anthropic 协议）
│   ├── qwen.ts                     # Qwen 适配器
│   ├── wenxin.ts                   # Wenxin 适配器
│   ├── proxy.ts                    # proxyFetch + proxyFetchStream（Background 代理）
│   └── index.ts                    # createAdapter() 工厂函数
├── stores/
│   ├── settings.ts                 # useSettingsStore（全局设置 + 跨标签页同步）
│   ├── conversations.ts            # useConversationsStore（对话管理 + 流式响应）
│   └── voice.ts                    # useVoiceStore（语音状态）
└── ...

entrypoints/
├── background.ts                   # Service Worker（CORS 代理 + 标签页操作 + 流管理 + 站点别名）
└── content/
    ├── index.ts                    # Content Script 入口（Shadow DOM + Vue 挂载）
    ├── App.vue                     # 根组件（FloatingButton + ChatDrawer + Settings）
    └── components/
        ├── ChatPanel.vue           # 文本聊天界面
        ├── InputBar.vue            # 输入框（文本 + 文件附件）
        ├── MessageList.vue         # 消息列表
        ├── MessageItem.vue         # 单条消息渲染
        └── ...
```

---

## 十二、数据流完整图

```
用户输入 "切换到短信登录，输入手机号18674069215，点击发送验证码"
    │
    ▼
┌─ InputRouter.route() ─────────────────────────────────────┐
│  /前缀? → No → { type: 'ai' }                             │
└───────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Phase 1: IntentDetector.detectPhase1() ──────────────────┐
│  历史消息(6条) + system prompt + 用户文本                   │
│  → adapter.chat() 流式                                     │
│  → 流式回调: onChatStart → onChatDelta × N                 │
│  → 检测 [action] → clearContent → onActionDetected         │
│  → return { isChat: false }                                │
└───────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Phase 2: processPhase2WithRetry() ───────────────────────┐
│                                                            │
│  ┌─ 第 1 步 ───────────────────────────────────────────┐  │
│  │ skeleton = getSkeleton() → 200 个元素                │  │
│  │ coreRule = MODE_FIRST（首次进入）                     │  │
│  │ callStreamingAI(text, skeleton, [], "", null, null)   │  │
│  │   → AI: [command]{click,e23,短信登录,done:0}         │  │
│  │   → extractTags → commands=[{click,e23}]             │  │
│  │ cmdKey = "click:e23" → completedKeys 无 → 执行       │  │
│  │ onCommandsParsed([{click,e23}], 1)                   │  │
│  │ executor.execute({click,e23})                         │  │
│  │   → findElement: [data-skeleton-id="e23"] ✓          │  │
│  │   → mousedown → mouseup → click ✅                   │  │
│  │ onCommandResult("click", true, "点击成功")            │  │
│  │ completed = [{action:"click",elementId:"e23"}]        │  │
│  │ completedKeys = {"click:e23"}                         │  │
│  │ done !== 1 → wait 500ms                               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ 第 2 步 ───────────────────────────────────────────┐  │
│  │ skeleton = getSkeleton() → 页面已切换到短信登录       │  │
│  │ coreRule = MODE_STREAMING（流式执行）                  │  │
│  │ callStreamingAI(text, skeleton, [completed], "")      │  │
│  │   → AI: [command]{type,e30,18674069215,done:0}       │  │
│  │ cmdKey = "type:e30" → completedKeys 无 → 执行        │  │
│  │ executor.execute({type,e30})                          │  │
│  │   → findElement: [data-skeleton-id="e30"] ✓          │  │
│  │   → focus → nativeInputValueSetter → input+change ✅  │  │
│  │ onCommandResult("type", true, "输入成功")             │  │
│  │ completed = [..., {action:"type",elementId:"e30"}]    │  │
│  │ done !== 1 → wait 500ms                               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ 第 3 步 ───────────────────────────────────────────┐  │
│  │ skeleton = getSkeleton()                              │  │
│  │ callStreamingAI(text, skeleton, [completed], "")      │  │
│  │   → AI: [command]{click,e45,获取验证码,done:1}       │  │
│  │ executor.execute({click,e45}) → ✅                    │  │
│  │ done === 1 → break                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  onAllCommandsDone(text, completed)                         │
│  → assistant 消息存入对话历史                               │
└───────────────────────────────────────────────────────────┘
    │
    ▼
  聊天展示：
  ✅ click — 点击成功
  ✅ type — 输入成功: 18674069215
  ✅ click — 点击成功
  已执行: click(短信登录); type(手机号); click(获取验证码)
```

---

## 十三、错误处理与重试

### 13.1 错误类型

| 错误类型 | 触发条件 | 处理方式 |
|---------|---------|---------|
| 元素未找到 | `findElement()` 返回 null | `lastError = "[action] 未找到目标元素"` → consecutiveErrors++ → 重试 |
| 执行异常 | `execute()` 抛出异常 | `lastError = "[action] 执行异常: ..."` → consecutiveErrors++ → 重试 |
| need_full | AI 输出 `[need_full]` 标签 | `extractFullPageSkeleton()` → consecutiveErrors++ → 重试 |
| AI 无输出 | adapter 返回空字符串 | `break`（视为任务完成） |
| 无有效标签 | extractTags 未提取到任何标签 | `break`（视为任务完成） |
| AI 请求失败 | adapter.chat() 抛出异常 | 返回空结果 → `break` |
| AbortError | 用户中止 | 向上抛出，processInput 捕获并显示"已停止" |
| 指令重复 | completedKeys 匹配 | 跳过执行，done=1 时 break |

### 13.2 重试策略

```
consecutiveErrors = 0
completedKeys = new Set()

while (consecutiveErrors < 5):
  检查 abort signal → 如果中止，抛出 AbortError
  提取骨架
  AI 生成 1 条指令

  无标签 → break（任务完成）

  command:
    指令去重检查 → 重复则跳过
    执行指令
    成功 → completed.push, completedKeys.add, consecutiveErrors=0
         → done=1? break : wait 500ms → 下一轮
    失败 → lastError, lastFailedCommand, consecutiveErrors++
         → 继续检查 need_full

  need_full:
    extractFullPageSkeleton() → lastFullSkeleton
    consecutiveErrors++ → 继续循环

if (consecutiveErrors >= 5):
  "未找到对应元素，请准确说出您的需求"
```

**关键：** 使用"连续错误"而非"总尝试次数"。中间成功会重置计数，允许在多步操作中偶发失败后继续。

### 13.3 重试时 AI 收到的信息

```
[原始请求] 用户: "切换到短信登录，输入手机号18674069215，点击发送验证码"

[已完成] 1. click e23 (短信登录)

[上次错误] [type] 未找到目标元素
[失败指令] {"action":"type","elementId":"e30","description":"手机号","text":"18674069215"}

[当前页面骨架]
{"url":"...","title":"...","elements":[...]}
```

AI 根据这些信息：
1. 知道原始意图（不重复理解）
2. 知道 click e23 已完成（不重复执行）
3. 知道 type e30 失败（调整策略）
4. 看到最新骨架（可能元素 ID 变化）
5. 生成新的指令（可能用 description 定位而非 elementId）

---

## 十四、Acceptance Criteria

- [x] 语义骨架提取（可交互元素 + 可见性 + 视口过滤 + 去重 + 200 上限）
- [x] 图标按钮识别（svg/img/i/class含icon → `(icon)`）
- [x] SkeletonManager 无缓存模式（每次重新提取，简单可靠）
- [x] iframe 骨架提取（同源 iframe + 坐标系叠加 + parent 标记）
- [x] 三重元素定位（elementId → fallbackSelector → 文本匹配）
- [x] 文本匹配两级搜索（交互元素优先 → 全元素兜底）
- [x] click 完整事件序列（mousedown → mouseup → click）
- [x] `<a>` 标签区分真实链接 vs JS 交互型链接（默认 _self 当前页面跳转）
- [x] type 兼容 React/Vue（nativeInputValueSetter）
- [x] clear 复用 executeType(el, '')
- [x] keyboard 完整事件序列 + Enter 表单提交（activeElement form → 全局搜索框）
- [x] navigate 通过 Background 代理（避免 popup 拦截）
- [x] 标签页操作 Background 代理（newTab/closeTab/switchTab 关键词/next/prev）
- [x] switchTab 站点别名映射（B站→bilibili 等 17 个站点）
- [x] video 操作（play/pause/volume/mute/unmute/seek/jump/speed）
- [x] Phase 1 二分类（聊天 or [action]）
- [x] Phase 1 流式输出时检测操作标签，清掉内容
- [x] Phase 1 历史消息清洗（stripHeavyData：去掉骨架 JSON + HTML 代码块）
- [x] Phase 2 流式单条执行（每次 1 条指令，AI 根据最新状态决定下一步）
- [x] Phase 2 三种进入模式（MODE_FIRST / MODE_STREAMING / MODE_RETRY）
- [x] `done` 标志（1=最后一步，0=还有步骤）
- [x] 指令去重（completedKeys Set + cmdKey 匹配）
- [x] 连续错误计数重试（最多 5 次，中间成功重置计数）
- [x] abort 支持（AbortController + signal 检查）
- [x] `[need_full]` 全页骨架兜底（全页面 DOM + iframe + 同格式骨架 + 无元素上限）
- [x] 流式标签检测（Phase 1 流式输出时正则检测 [action]/[command]）
- [x] 提示词集中在 prompts.ts（模板 + 占位符运行时替换）
- [x] Background CORS 代理（proxy-fetch-stream + 流转发 + 中止支持）
- [x] Background 标签页操作（newTab/closeTab/switchTab 关键词/next/prev）
- [x] usePipeline Vue 集成（流式消息生命周期 + 回调 → 消息映射 + abort 支持）
- [x] 失败提示 "未找到对应元素，请准确说出您的需求"

---

## 十五、Out of Scope

- Firefox 适配
- 移动端浏览器
- 拖拽操作
- 文件上传/下载
- 跨页面连续指令队列
- `[steps]` 步骤预告标签（已从代码中移除，仅靠 `done=1` 停止）
