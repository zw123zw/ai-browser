# 浏览器命令设计架构（已实现）

> 本文档描述已实现的浏览器命令执行体系，基于实际代码 `src/browser/`、`src/input/`、`src/composables/`、`entrypoints/background.ts` 整理。
> 最后更新：2025-06-16

## Goal

设计浏览器命令的完整执行体系：语义骨架提取、`[command]` 指令格式、三重元素定位、完整事件触发、执行结果判定、失败重试机制、`[need_html]` 局部 HTML 兜底、标签页操作。

本文档是统一输入架构的执行层实现，接收来自意图检测架构（`06-13-voice-arch-v2`）的 `[command]` 和 `[need_html]` 标签，负责在浏览器中实际执行操作。

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
| 元素定位 | 三重降级（elementId → fallbackSelector → 文本匹配） | 兼容骨架 ID 失效、CSS 选择器变化、纯文本兜底 |
| CORS 代理 | Background Service Worker | Manifest V3 限制，content script 无法直接跨域 |
| 标签页操作 | Background 代理 | chrome.tabs API 只在 background 中可用 |

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
    │  └─ 提取: href, src, type, name, placeholder, value, role, aria-label, title, data-testid
    │
    ▼
⑤ 标注父级地标 findLandmarkParent()
    │  └─ 向上遍历: nav/header/main/aside/footer 或 role=navigation/banner/main 等
    │
    ▼
⑥ 去重 + 过滤
    │  ├─ 父子同文本去重（保留子级）
    │  ├─ 同级同文本去重（同一 parent 下）
    │  ├─ 空文本过滤（保留 a/button/input/select/textarea/有 role 的元素）
    │  └─ 上限 200 个元素（MAX_SKELETON_ELEMENTS）
    │
    ▼
输出 SemanticSkeleton
```

**实际代码：**

```typescript
// src/browser/skeleton.ts

const LANDMARK_TAGS = ['nav', 'header', 'main', 'aside', 'footer']
const LANDMARK_ROLES = ['navigation', 'banner', 'main', 'complementary', 'contentinfo']
const MAX_SKELETON_ELEMENTS = 200

function isClickable(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details'].includes(tag)) return true
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
```

### 2.3 输出格式

```json
{
  "url": "https://www.example.com",
  "title": "示例网站",
  "elements": [
    {"id": "e1", "tag": "a", "text": "首页", "href": "/", "parent": "nav"},
    {"id": "e2", "tag": "input", "type": "search", "placeholder": "搜索", "parent": "header"},
    {"id": "e3", "tag": "button", "text": "登录", "role": "button"},
    {"id": "e4", "tag": "button", "text": "(icon)", "ariaLabel": "关闭", "title": "关闭弹窗"}
  ]
}
```

每个元素包含：`id`, `tag`, `text`, `href`, `src`, `type`, `name`, `placeholder`, `value`, `role`, `ariaLabel`, `title`, `parent`, `class`

### 2.4 SkeletonManager（骨架管理器）

```typescript
// src/browser/skeleton.ts
class SkeletonManager {
  getSkeleton(): SemanticSkeleton   // 每次重新提取（无缓存）
  invalidate(): void                 // 保留接口兼容，viewport 模式下无需操作
  dispose(): void                    // 保留接口兼容
  get cachedUrl(): string            // 保留接口兼容，始终返回 ""
}
```

**设计说明：** SkeletonManager 不缓存骨架，每次 `getSkeleton()` 都调用 `extractSkeleton(document)` 重新提取。这是因为 DOM 随时可能被 JavaScript 修改（SPA 路由、弹窗、懒加载），缓存会导致过期数据。简单可靠，永不过期。

### 2.5 关键词 HTML 搜索（`[need_html]` 兜底）

**文件：** `src/browser/local-html.ts`

```typescript
export function searchByKeywords(keywords: string[]): string | null
  // 1. 遍历整个页面 DOM（不限视口）
  // 2. 对每个元素检查是否可交互（复用骨架的 isClickable 逻辑）
  // 3. 可见性检查（复用 isElementVisible）
  // 4. 关键词 OR 模糊匹配（任一关键词命中即可）
  //    匹配源: textContent / aria-label / placeholder / title / value
  // 5. 匹配到的元素只保留元素本身（不带父级）
  // 6. 清洗属性，只保留: data-skeleton-id, href, src, type, name, placeholder, value, role, aria-label, title
  // 7. 移除 script/style/noscript 子元素，压缩空白
  // 8. 所有匹配片段拼接返回，未找到返回 null
  // 注意: data-skeleton-id 只在视口内骨架元素上有，视口外元素靠 text/aria-label/title 定位

function matchesKeywords(el: HTMLElement, keywords: string[]): boolean
  // 逐个关键词在 textContent/aria-label/placeholder/title/value 中模糊匹配
  // 任一关键词命中即可（OR 逻辑），非 AND
```

**与骨架提取的区别：**

| 维度 | 骨架提取 | 关键词搜索 |
|------|---------|-----------|
| 搜索范围 | 仅视口内 | 全页面 DOM |
| 匹配逻辑 | 无（提取所有可交互元素） | 关键词 OR 模糊匹配 |
| 输出格式 | 结构化 JSON（id/tag/text/...） | 清洗后的 HTML 片段 |
| 用途 | AI 根据 elementId 精确定位 | AI 根据 HTML 片段重新分析 |

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
}
```

### 3.2 Action 能力域（15 种）

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
switchTab   — 切换到指定标签页（需tabQuery关键词）
nextTab     — 切换到下一个标签页
prevTab     — 切换到上一个标签页
```

### 3.3 `[steps]` 步骤预告标签

AI 首次回复时必须先输出步骤预告，告知系统总步骤数：

```
[steps]切换登录 输入手机号 点击发送[/steps]
[command]{"action":"click","elementId":"e23","description":"短信登录","done":0}[/command]
```

- 步骤名用空格隔开
- 系统解析 `steps` 数组长度作为 `totalSteps`
- 当 `completed.length >= totalSteps` 时自动停止（双重停止条件之一）

### 3.4 `done` 标志

- `done: 0` — 中间步骤，还有后续操作
- `done: 1` — 最后一步，系统执行后立即停止（双重停止条件之一）

**双重停止条件：**
1. `totalSteps > 0 && completed.length >= totalSteps` — 步骤预告的步数已到
2. `cmd.done === 1` — AI 标记最后一步

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

**文本匹配 findByText() 策略：**

```
① 优先搜索交互元素（a/button/input/select/textarea/[role=button]/[onclick]/[tabindex]）
   匹配: textContent / aria-label / title / placeholder
    │
    ▼ 未找到
② 兜底搜索所有元素（覆盖 div/span + SVG 图标按钮）
   排除: script/style/svg
   匹配: textContent / aria-label / title / placeholder
   过滤: display:none / visibility:hidden
```

### 4.2 操作执行详情

#### click — 完整鼠标事件序列

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
      // 真实 URL → 新标签页打开（保留原 target 指定的行为）
      const target = el.target || '_blank'
      const opened = window.open(el.href, target)
      if (!opened) window.location.href = el.href
    }
  } else {
    el.dispatchEvent(new MouseEvent('click', mouseEventInit))
  }

  return { success: true, message: '点击成功' }
}
```

**设计说明：**
- 不使用 `el.click()`，而是手动 dispatch 完整的 mousedown → mouseup → click 事件序列
- `<a>` 标签区分真实链接（`window.open`）和 JS 交互型链接（`javascript:`/`#`/空 href，触发 click 事件）
- 真实链接默认 `_blank` 新标签页打开，弹窗拦截降级为 `location.href`

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
| Space/ | Space |
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
| `switchTab` (关键词) | `chrome.tabs.query({})` → title/url 匹配 → `chrome.tabs.update(target, { active: true })` |
| `switchTab` (next/prev) | `chrome.tabs.query({ currentWindow: true })` → 计算 `(activeIndex ± 1) % tabs.length` → 切换 |

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
│  /翻译 中文 → { type: 'skill', skillName, skillUserText }│
│  其余 → { type: 'ai' }                                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 意图检测（流式输出 + 标签检测）                 │
│  src/input/intent-detector.ts → detectPhase1()           │
│                                                         │
│  输入：用户文本（无骨架、无技能列表）                      │
│  消息构建：历史上下文（最近6条，去重数据）+ system prompt  │
│  Prompt：二分类                                          │
│    - 需要操作 → [action]                                  │
│    - 聊天 → 自然语言回复                                  │
│  禁止输出 [command]、[skill]                              │
│                                                         │
│  流式输出时检测操作标签：                                 │
│    正则: /\[(?:action|command|skill)|(?:action|command|  │
│          skill)\]/                                       │
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
│    1. 检查双重停止条件（steps 步数 / done=1）             │
│    2. 重新提取骨架（SkeletonManager.getSkeleton()）       │
│    3. 调用 AI 生成 1 条指令（callStreamingAI）            │
│    4. 解析标签 → 分支处理                                │
│                                                         │
│  分支处理：                                               │
│    [command] → ActionExecutor.execute() → 记录 completed  │
│      成功 → consecutiveErrors=0, 等待 500ms → 下一轮     │
│      失败 → consecutiveErrors++, 记录 lastError → 重试   │
│    [skill] → onSkillActivate() → 记录 completed          │
│    [need_html] → searchByKeywords() → consecutiveErrors++│
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
      if (/\[(?:action|command|skill)|(?:action|command|skill)\]/.test(phase1StreamedContent)) {
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
- 操作：思考中... → 正在执行操作... → 🔧 正在执行 N 条指令 → ✅/❌ 结果

### 5.3 Phase 2 流式执行循环

> 核心设计：AI 每次只生成 1 条指令，系统立即执行并反馈结果，AI 根据最新页面状态决定下一步。

**与旧版批量执行的区别：**

| 维度 | 旧版（批量） | 新版（流式单条） |
|------|------------|----------------|
| AI 输出 | 一次输出所有指令 | 每次只输出 1 条 |
| 执行方式 | 逐条执行全部指令 | 执行 1 条 → 反馈 → AI 再生成下一条 |
| 骨架新鲜度 | 执行中途骨架可能过期 | 每步都重新提取骨架 |
| 错误恢复 | 整批重做 | 只重试失败的那一步 |
| 停止判断 | 无明确停止信号 | `done=1` + `[steps]` 步数 |

**流程示例：**

```
用户: "切换到短信登录，输入手机号18674069215，点击发送验证码"

AI 首次回复:
  [steps]切换登录 输入手机号 点击发送[/steps]
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
  let totalSteps = -1          // -1 = AI 未返回 [steps]，未知总数
  let consecutiveErrors = 0
  let lastError = ''

  while (consecutiveErrors < MAX_RETRY) {
    // ★ 双重停止条件 1：[steps] 步数已到
    if (totalSteps > 0 && completed.length >= totalSteps) break

    // 每轮重新提取骨架
    const skeleton = this.skeletonManager.getSkeleton()

    // AI 生成 1 条指令
    const phase2Result = await this.callStreamingAI(text, skeleton, completed, lastError)

    // 首次解析 [steps]，记录总步骤数
    if (phase2Result.steps?.length) {
      totalSteps = phase2Result.steps.length
    }

    // 无标签 → 所有步骤完成或 AI 无输出
    if (!phase2Result.commands?.length && !phase2Result.skill && !phase2Result.needHtml) {
      break
    }

    // need_html → 搜索 HTML 片段后重试
    if (phase2Result.needHtml) {
      const htmlFragments = searchByKeywords(phase2Result.needHtml.keywords)
      lastError = `未找到 "${phase2Result.needHtml.description}" 对应元素`
      consecutiveErrors++
      continue
    }

    // skill → 执行
    if (phase2Result.skill) {
      const result = await this.options.onSkillActivate?.(name, userText)
      if (result?.success) {
        completed.push({ action: 'skill', elementId: name })
        consecutiveErrors = 0
        lastError = ''
        continue
      }
      lastError = result?.message || `技能 "${name}" 执行失败`
      consecutiveErrors++
      continue
    }

    // command → 执行单条指令
    const cmd = phase2Result.commands![0]
    callbacks.onCommandsParsed([cmd])
    const result = await this.executor.execute(cmd)
    callbacks.onCommandResult(cmd.action, result.success, result.message)

    if (result.success) {
      completed.push({ action: cmd.action, elementId: cmd.elementId, description: cmd.description })
      consecutiveErrors = 0
      lastError = ''

      if (cmd.action === 'navigate') {
        this.skeletonManager.invalidate()  // 保留接口兼容
      }

      // ★ 双重停止条件 2：AI 标记 done=1，最后一步
      if (cmd.done === 1) break

      // 等待页面更新（弹窗/新内容渲染），再进入下一轮提取骨架
      await new Promise(resolve => setTimeout(resolve, 500))
    } else {
      lastError = `[${cmd.action}] ${result.message}`
      consecutiveErrors++
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
): Promise<Phase2Result> {
  const adapter = createAdapter(model.provider || settings.provider)

  const systemPrompt = PHASE2_SYSTEM_PROMPT.replace('{skillList}', skillList)
  const userContent = buildStreamingUserMessage(text, skeleton, completed, lastError || undefined)

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
    skill: tags.skill,
    needHtml: tags.needHtml,
    steps: tags.steps,
    rawAiOutput: fullResponse,
  }
}
```

**用户消息构建 buildStreamingUserMessage()：**

```typescript
function buildStreamingUserMessage(text, skeleton, completed, lastError): string {
  const parts = []
  parts.push(`[原始请求] 用户: "${text}"`)

  if (completed.length > 0) {
    const completedList = completed.map((c, i) =>
      `${i + 1}. ${c.action}${c.elementId ? ` ${c.elementId}` : ''}${c.description ? ` (${c.description})` : ''}`
    ).join('\n')
    parts.push(`[已完成] ${completedList}`)
  }

  if (lastError) parts.push(`[上次错误] ${lastError}`)

  parts.push(`[当前页面骨架]\n${JSON.stringify(skeleton)}`)

  return parts.join('\n\n')
}
```

**消息组成：**

| 字段 | 作用 |
|------|------|
| `[原始请求]` | AI 知道用户的完整意图 |
| `[已完成]` | AI 知道哪些步骤已完成，不重复执行 |
| `[上次错误]` | AI 知道哪里失败，调整策略 |
| `[当前页面骨架]` | 页面可能已变化，AI 基于当前状态生成指令 |

### 5.5 兜底 key 匹配（保留接口）

```typescript
// src/input/pipeline.ts
function getCommandKey(cmd: Command): string {
  return `${cmd.action}:${cmd.elementId || cmd.description || cmd.url || ''}`
}
```

**说明：** 在流式单条执行模式下，`getCommandKey` 主要用于日志追踪。已完成指令存储在 `completed` 数组中，传递给 AI 的 `[已完成]` 列表让 AI 自行跳过已完成步骤。

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
| `onCommandsParsed` | 移除占位消息，添加 `🔧 **正在执行 N 条指令：**\n1. **action** — description` | system |
| `onSkillParsed` | 移除占位消息，添加 `⚡ **正在执行技能：** 名称 — 描述` | system |
| `onCommandResult` | `✅ **action** — message` 或 `❌ **action** — message` | system |
| `onAllCommandsDone` | 存为 assistant 消息 `已执行: action(desc); action(url)` | assistant |
| `onRetryMessage` | 移除占位消息，添加重试提示 | system |
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
  skill?: { name: string; userText: string }     // [skill]
  isAction: boolean                              // 是否包含 [action]
  needHtml?: NeedHtmlRequest                     // [need_html]
  steps?: string[]                               // [steps] 步骤预告
  hasAnyTag: boolean                             // 是否提取到了任何标签
  rawText: string                                // 原始文本
}

function extractTags(rawText: string): ExtractedTags
  // 正则匹配 [chat], [command](多条), [skill], [action], [need_html], [steps]
  // 支持闭合标签 [tag]...[/tag] 和非闭合 fallback [tag]{...}
  // [need_html] JSON 解析失败时有容错提取（正则提取 keywords/reason/description）

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
[skill]     → 技能触发
[need_html] → 需要 HTML 片段兜底
[steps]     → 步骤预告（步骤名用空格隔开）
```

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
你是浏览器扩展的 AI 助手，可以控制浏览器执行操作（打开网站、搜索、点击、输入等）。

判断用户输入是否需要浏览器操作：
- 需要操作页面/打开网站/搜索/执行技能 → 回复 [action]
- 其他（聊天/问答/闲聊）→ 直接用自然语言回复

示例：
- "打开B站" → [action]（需要打开网站）
- "搜索Vue教程" → [action]（需要搜索）
- "今天天气怎么样" → 直接回答（纯聊天）
- "帮我翻译这个页面" → [action]（需要操作页面）

你只能输出：自然语言回复 或 [action]
禁止输出 [command]、[skill] 或其他标签。
\`\`\``
```

### 8.3 Phase 2 提示词（操作决策 — 统一模板）

**设计原则**：一套 system prompt 模板，通过 `{coreRule}` / `{stepsInstruction}` / `{skillList}` 三个占位符运行时替换，适配三种进入模式。user message 只放数据，不含指令说明。

```typescript
export const PHASE2_SYSTEM_PROMPT = `\`\`\`
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
{coreRule}

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=最后一步 0=还有步骤
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_html] 骨架找不到目标时，关键词搜索页面HTML重新定位：
[need_html]{"keywords":["收藏","按钮"],"reason":"骨架未找到","description":"点击收藏"}[/need_html]
- keywords从用户原始语句提取

能力域：
${CAPABILITY_DOMAIN}
{stepsInstruction}

═══ 技能 ═══

[skill] 调用匹配的用户技能：
[skill]{"name":"技能名","userText":"文本"}[/skill]

可用技能：
{skillList}

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]、[skill]{...}[/skill]、[need_html]{...}[/need_html]、[steps]步骤1 步骤2[/steps]
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [steps] / [command] / [skill] / [need_html] 标签，其他内容一律禁止。
\`\`\``
```

**模板替换常量：**

```typescript
// 模式常量
export const MODE_FIRST = '每次只生成1条指令，系统执行后反馈结果再生成下一条。'
export const MODE_STREAMING = '按照以下信息和格式，生成下一条指令。'
export const MODE_RETRY = '上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。'

// 首次进入的 [steps] 步骤预告说明
export const STEPS_INSTRUCTION = `
首次回复必须先输出步骤预告，再输出第一条指令：
[steps]步骤1 步骤2 步骤3[/steps]
[command]{"action":"...","done":0}[/command]
后续回复只输出 [command]。`
```

**替换逻辑（pipeline.ts）：**

```typescript
const isFirstEntry = completed.length === 0 && !lastError
const coreRule = isFirstEntry ? MODE_FIRST : (lastError ? MODE_RETRY : MODE_STREAMING)
const stepsInstruction = isFirstEntry ? STEPS_INSTRUCTION : ''

const systemPrompt = PHASE2_SYSTEM_PROMPT
  .replace('{coreRule}', coreRule)
  .replace('{stepsInstruction}', stepsInstruction)
  .replace('{skillList}', skillList)
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
  htmlFragments?: string,          // need_html 搜索到的 HTML 片段
): string
```

**字段组装逻辑：**

| 字段 | 条件 | 格式 |
|------|------|------|
| `[原始请求]` | 始终 | `用户: "点击登录"` |
| `[已完成]` | `completed.length > 0` | `1. navigate https://...\n2. click e3 (登录)` |
| `[上次错误]` | `lastError` 有值 | `[click] 元素不可见` |
| `[失败指令]` | `lastFailedCommand` 有值 | `{"action":"click","elementId":"e5","description":"登录"}` |
| `[相关HTML片段]` | `htmlFragments` 有值 | 清洗后的 HTML 元素 |
| `[当前页面骨架]` | 始终 | `{"url":"...","elements":[...]}` |

### 8.5 发送给 AI 的完整内容（四种场景）

#### 场景 1：首次进入

`completed=[], lastError='', lastFailedCommand=null, htmlFragments=null, isFirstEntry=true`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
每次只生成1条指令，系统执行后反馈结果再生成下一条。

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=最后一步 0=还有步骤
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_html] 骨架找不到目标时，关键词搜索页面HTML重新定位：
[need_html]{"keywords":["收藏","按钮"],"reason":"骨架未找到","description":"点击收藏"}[/need_html]
- keywords从用户原始语句提取

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

首次回复必须先输出步骤预告，再输出第一条指令：
[steps]步骤1 步骤2 步骤3[/steps]
[command]{"action":"...","done":0}[/command]
后续回复只输出 [command]。

═══ 技能 ═══

[skill] 调用匹配的用户技能：
[skill]{"name":"技能名","userText":"文本"}[/skill]

可用技能：
（暂无可用技能）

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]、[skill]{...}[/skill]、[need_html]{...}[/need_html]、[steps]步骤1 步骤2[/steps]
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [steps] / [command] / [skill] / [need_html] 标签，其他内容一律禁止。

────────────────────────────────────

[原始请求] 用户: "点击登录"

[当前页面骨架]
{"url":"https://example.com","title":"登录页","elements":[
  {"id":"e1","tag":"input","type":"text","placeholder":"用户名","parent":"main"},
  {"id":"e2","tag":"input","type":"password","placeholder":"密码","parent":"main"},
  {"id":"e3","tag":"button","text":"登录","parent":"main"}
]}
```

#### 场景 2：流式执行（成功后下一步）

`completed=[{action:"navigate",url:"https://example.com"}], lastError='', lastFailedCommand=null, htmlFragments=null, isFirstEntry=false`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
按照以下信息和格式，生成下一条指令。

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=最后一步 0=还有步骤
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_html] 骨架找不到目标时，关键词搜索页面HTML重新定位：
[need_html]{"keywords":["收藏","按钮"],"reason":"骨架未找到","description":"点击收藏"}[/need_html]
- keywords从用户原始语句提取

能力域：
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
...（15个）

═══ 技能 ═══

[skill] 调用匹配的用户技能：
[skill]{"name":"技能名","userText":"文本"}[/skill]

可用技能：
（暂无可用技能）

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]、[skill]{...}[/skill]、[need_html]{...}[/need_html]、[steps]步骤1 步骤2[/steps]
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [steps] / [command] / [skill] / [need_html] 标签，其他内容一律禁止。

────────────────────────────────────

[原始请求] 用户: "点击登录"

[已完成]
1. navigate https://example.com

[当前页面骨架]
{"url":"https://example.com","title":"登录页","elements":[
  {"id":"e1","tag":"input","type":"text","placeholder":"用户名","parent":"main"},
  {"id":"e2","tag":"input","type":"password","placeholder":"密码","parent":"main"},
  {"id":"e3","tag":"button","text":"登录","parent":"main"}
]}
```

#### 场景 3：错误重试 — 指令执行失败

`completed=[{action:"navigate",...}], lastError="[click] 元素不可见", lastFailedCommand={action:"click",elementId:"e5",description:"登录"}, htmlFragments=null, isFirstEntry=false`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=最后一步 0=还有步骤
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_html] 骨架找不到目标时，关键词搜索页面HTML重新定位：
[need_html]{"keywords":["收藏","按钮"],"reason":"骨架未找到","description":"点击收藏"}[/need_html]
- keywords从用户原始语句提取

能力域：
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
...（15个）

═══ 技能 ═══

[skill] 调用匹配的用户技能：
[skill]{"name":"技能名","userText":"文本"}[/skill]

可用技能：
（暂无可用技能）

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]、[skill]{...}[/skill]、[need_html]{...}[/need_html]、[steps]步骤1 步骤2[/steps]
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [steps] / [command] / [skill] / [need_html] 标签，其他内容一律禁止。

────────────────────────────────────

[原始请求] 用户: "点击登录"

[已完成]
1. navigate https://example.com

[上次错误] [click] 元素不可见
[失败指令] {"action":"click","elementId":"e5","description":"登录"}

[当前页面骨架]
{"url":"https://example.com","title":"登录页","elements":[
  {"id":"e1","tag":"input","type":"text","placeholder":"用户名","parent":"main"},
  {"id":"e2","tag":"input","type":"password","placeholder":"密码","parent":"main"},
  {"id":"e3","tag":"button","text":"登录","parent":"main"}
]}
```

#### 场景 4：错误重试 — need_html 触发后

`completed=[{action:"navigate",...}], lastError='未找到 "收藏" 对应元素', lastFailedCommand={action:"click",elementId:null,description:"收藏"}, htmlFragments='<a ...>收藏</a>...', isFirstEntry=false`

```
你是浏览器操作助手。只输出指令标签，禁止分析/解释/说明。
上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。

═══ 指令 ═══

[command] 执行浏览器操作：
[command]{"action":"click","elementId":"e3","description":"登录","done":0}[/command]
- done: 1=最后一步 0=还有步骤
- 定位: elementId > fallbackSelector > description
- elementId来自骨架，找不到时填null用description定位

[need_html] 骨架找不到目标时，关键词搜索页面HTML重新定位：
[need_html]{"keywords":["收藏","按钮"],"reason":"骨架未找到","description":"点击收藏"}[/need_html]
- keywords从用户原始语句提取

能力域：
navigate    — 打开URL（需url）
search      — 全网搜索（需text）
click       — 点击元素（需elementId或description）
...（15个）

═══ 技能 ═══

[skill] 调用匹配的用户技能：
[skill]{"name":"技能名","userText":"文本"}[/skill]

可用技能：
（暂无可用技能）

═══ 规则 ═══

- 标签必须闭合：[command]{...}[/command]、[skill]{...}[/skill]、[need_html]{...}[/need_html]、[steps]步骤1 步骤2[/steps]
- 打开网站/搜索/滚动 → 直接[command]（不需要骨架）
- 骨架中"(icon)"元素 → 检查aria-label/title判断功能

═══ 禁止输出 ═══

❌ 禁止输出分析/解释/说明/思考过程
❌ 禁止一次输出多条[command]，每次只能1条
❌ 禁止输出自然语言（如"好的，我来帮你..."、"让我分析一下..."）
只输出 [steps] / [command] / [skill] / [need_html] 标签，其他内容一律禁止。

────────────────────────────────────

[原始请求] 用户: "收藏页面"

[已完成]
1. navigate https://example.com/article/123

[上次错误] 未找到 "收藏" 对应元素
[失败指令] {"action":"click","elementId":null,"description":"收藏"}

[相关HTML片段]
<a data-skeleton-id="e15" href="javascript:;">收藏</a>
<button data-skeleton-id="e23" role="button">收藏本片</button>

[当前页面骨架]
{"url":"https://example.com/article/123","title":"文章详情","elements":[
  {"id":"e6","tag":"a","text":"首页","href":"/","parent":"header"},
  {"id":"e10","tag":"a","text":"(icon)","href":"javascript:;","parent":"header"},
  {"id":"e57","tag":"a","text":"推荐本片","href":"javascript:;","role":"button"}
]}
```

### 8.6 字段对比总结

| 字段 | 首次进入 | 流式执行 | 错误重试 |
|------|:-------:|:-------:|:-------:|
| `{coreRule}` | 每次只生成1条指令，系统执行后反馈结果再生成下一条。 | 按照以下信息和格式，生成下一条指令。 | 上次指令执行失败。根据以下失败指令、错误信息、最新页面骨架，调整策略，重新生成一条指令。 |
| `{stepsInstruction}` | `[steps]` 步骤预告说明 | 空 | 空 |
| `{skillList}` | 技能列表 | 技能列表 | 技能列表 |
| `[原始请求]` | ✅ | ✅ | ✅ |
| `[已完成]` | ❌ | ✅ | ✅ |
| `[上次错误]` | ❌ | ❌ | ✅ |
| `[失败指令]` | ❌ | ❌ | ✅ |
| `[相关HTML片段]` | ❌ | ❌ | ✅/❌ |
| `[当前页面骨架]` | ✅ | ✅ | ✅ |

### 8.7 Phase 2 iframe 骨架提取

**新增**：骨架提取支持同源 iframe 内元素。

**提取逻辑：**
1. 主文档 `document.body.querySelectorAll('*')` 提取可交互元素
2. 遍历所有 `<iframe>`，通过 `contentDocument` 访问同源 iframe
3. iframe 内元素的 `parent` 标记为 `iframe.{id/class/name}`（如 `iframe.main`）
4. 坐标系正确处理：iframe 元素 `getBoundingClientRect()` 叠加 iframe 自身偏移
5. 跨域 iframe 通过 `try/catch` 跳过
6. 关键词搜索（`searchByKeywords`）同步支持 iframe 内搜索

**parent 标识优先级：** iframe.id > iframe.className（首个） > iframe.name > "iframe"

---

## 九、IntentDetector（意图检测器）

**文件：** `src/input/intent-detector.ts`

### 9.1 Phase 1 意图检测

```typescript
class IntentDetector {
  async detectPhase1(
    text: string,
    onChunk?: (delta: string, reasoningDelta?: string) => void,
  ): Promise<Phase1Detection>
    // 返回: { isChat: boolean, responseText?: string, rawText: string }
}
```

**消息构建逻辑：**
1. 获取历史上下文（最近 6 条消息，过滤空内容，去掉骨架/HTML 避免累积）
2. 拼接 system prompt 到用户消息前面（兼容不支持 system role 的 API）
3. 调用 adapter.chat() 流式获取回复
4. extractTags() 提取标签判断结果

**历史消息清洗 stripHeavyData()：**
- 去掉骨架 JSON（`页面骨架:` 后的所有内容）
- 去掉 need_html 的 HTML 代码块（` ```html ... ``` `）

### 9.2 Phase 2 操作决策（保留接口）

```typescript
async detectPhase2(text: string, skeleton: SemanticSkeleton): Promise<Phase2Result>
  // 返回: { commands?, skill?, needHtml?, steps?, rawAiOutput }
  // 不再内部处理 [need_html]，由 pipeline 统一重试循环管理
```

**注意：** 在流式单条执行模式下，Phase 2 实际由 `pipeline.ts` 的 `callStreamingAI()` 直接调用 adapter，不经过 `detectPhase2()`。`detectPhase2()` 保留为兼容接口。

---

## 十、关键方法签名

### InputPipeline

```typescript
// src/input/pipeline.ts
class InputPipeline {
  constructor(options: PipelineOptions)

  async process(ctx: InputContext, callbacks: PipelineCallbacks): Promise<void>
    // 主入口: 路由 → Phase 1 → Phase 2

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void>
    // 流式执行循环: 连续错误 < 5 次, 每次 1 条指令

  private async callStreamingAI(text, skeleton, completed, lastError): Promise<Phase2Result>
    // 调用 AI 生成 1 条指令（流式），只取第一条 [command]
}
```

### PipelineOptions

```typescript
interface PipelineOptions {
  getSettings: () => AppSettings
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
    // 返回: { commands?, skill?, needHtml?, steps?, rawAiOutput }
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
function extractSkeleton(doc: Document): SemanticSkeleton
class SkeletonManager {
  getSkeleton(): SemanticSkeleton   // 每次重新提取
  invalidate(): void                 // 保留接口兼容
  dispose(): void                    // 保留接口兼容
  get cachedUrl(): string            // 保留接口兼容
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

## 十一、Background Service Worker

**文件：** `entrypoints/background.ts`

### 11.1 消息类型

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `zwf-toggle` | Background → Content | 切换抽屉显示/隐藏 |
| `proxy-fetch` | Content → Background | 代理非流式 HTTP 请求（避免 CORS） |
| `proxy-fetch-stream` | Content → Background | 代理流式 HTTP 请求（SSE） |
| `stream-chunk` | Background → Content | 转发 SSE 数据块 |
| `stream-end` | Background → Content | SSE 流结束 |
| `stream-error` | Background → Content | SSE 流错误 |
| `abort-stream` | Content → Background | 中止进行中的 SSE 流 |
| `tab-action` | Content → Background | 标签页操作（newTab/closeTab/switchTab） |
| `zwf-drawer-changed` | Content → Background | 抽屉状态变化，广播到其他标签页 |
| `zwf-drawer-sync` | Background → Content | 同步其他标签页的抽屉状态 |

### 11.2 流式代理流程

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

---

## 十二、目录结构

```
src/
├── browser/
│   ├── types.ts                    # SkeletonElement, Command, ActionResult, NeedHtmlRequest
│   ├── skeleton.ts                 # extractSkeleton() + SkeletonManager（无缓存，每次重新提取）
│   ├── action-executor.ts          # ActionExecutor（15 种操作 + 三重定位 + 完整事件序列）
│   ├── local-html.ts               # searchByKeywords()（全页面 DOM 搜索 + 关键词 OR 匹配）
│   └── index.ts
├── input/
│   ├── types.ts                    # InputContext, InputResult, PipelineCallbacks
│   ├── router.ts                   # InputRouter → builtin/skill/ai 分流（/ 前缀解析）
│   ├── intent-detector.ts          # IntentDetector（Phase 1 二分类 + Phase 2 保留接口）
│   ├── pipeline.ts                 # InputPipeline（流式单条执行 + 连续错误重试 + 流式标签检测）
│   ├── tag-parser.ts               # extractTags() + isChatOnlyReply() + getChatText()
│   ├── prompts.ts                  # 所有 AI 提示词（Phase1/Phase2/Retry + 消息构建函数）
│   └── index.ts
├── composables/
│   └── usePipeline.ts              # Vue 集成（流式消息生命周期 + 回调 → 消息映射）
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
├── background.ts                   # Service Worker（CORS 代理 + 标签页操作 + 流管理）
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

## 十三、Acceptance Criteria

- [x] 语义骨架提取（可交互元素 + 可见性 + 视口过滤 + 去重 + 200 上限）
- [x] 图标按钮识别（svg/img/i/class含icon → `(icon)`）
- [x] SkeletonManager 无缓存模式（每次重新提取，简单可靠）
- [x] 三重元素定位（elementId → fallbackSelector → 文本匹配）
- [x] 文本匹配两级搜索（交互元素优先 → 全元素兜底）
- [x] click 完整事件序列（mousedown → mouseup → click）
- [x] <a> 标签区分真实链接 vs JS 交互型链接
- [x] type 兼容 React/Vue（nativeInputValueSetter）
- [x] keyboard 完整事件序列 + Enter 表单提交（activeElement form → 全局搜索框）
- [x] navigate 通过 Background 代理（避免 popup 拦截）
- [x] 标签页操作 Background 代理（newTab/closeTab/switchTab/next/prev）
- [x] Phase 1 二分类（聊天 or [action]）
- [x] Phase 1 流式输出时检测操作标签，清掉内容
- [x] Phase 1 历史消息清洗（去掉骨架 JSON + HTML 代码块）
- [x] Phase 2 流式单条执行（每次 1 条指令，AI 根据最新状态决定下一步）
- [x] `[steps]` 步骤预告标签（AI 首次回复列出所有步骤）
- [x] `done` 标志（1=最后一步，0=还有步骤）
- [x] 双重停止条件（steps 步数 + done=1）
- [x] 连续错误计数重试（最多 5 次，中间成功重置计数）
- [x] `[need_html]` 关键词搜索兜底（全页面 DOM + OR 匹配 + HTML 清洗）
- [x] `[need_html]` 容错提取（JSON 解析失败时正则提取 keywords/reason/description）
- [x] 流式标签检测（Phase 1 流式输出时正则检测 [action]/[command]/[skill]）
- [x] "然后/接着/再" 语义规则
- [x] 图标按钮识别提示词（svg/img/i/class含icon）
- [x] 提示词集中在 prompts.ts
- [x] Background CORS 代理（proxy-fetch-stream + 流转发 + 中止支持）
- [x] Background 标签页操作（newTab/closeTab/switchTab 关键词/next/prev）
- [x] usePipeline Vue 集成（流式消息生命周期 + 回调 → 消息映射）
- [x] 失败提示 "未找到对应元素，请准确说出您的需求"
- [ ] 技能系统实现（目前 onSkillActivate 返回 "暂未实现"）

---

## 十四、Out of Scope

- Firefox 适配
- 移动端浏览器
- 拖拽操作
- 文件上传/下载
- iframe / Shadow DOM（骨架不覆盖，但 need_html 回退搜索可触达）
- 跨页面连续指令队列
- 技能系统实现（scaffolded at `src/skills/workflows/`）

---

## 十五、数据流完整图

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
│  │ callStreamingAI(text, skeleton, [], "")               │  │
│  │   → AI: [steps]切换 输入 发送[/steps]                │  │
│  │       [command]{click,e23,短信登录,done:0}[/command]  │  │
│  │   → extractTags → commands=[{click,e23}], steps=3    │  │
│  │ onCommandsParsed([{click,e23}])                       │  │
│  │ executor.execute({click,e23})                         │  │
│  │   → findElement: [data-skeleton-id="e23"] ✓          │  │
│  │   → mousedown → mouseup → click ✅                   │  │
│  │ onCommandResult("click", true, "点击成功")            │  │
│  │ completed = [{action:"click",elementId:"e23"}]        │  │
│  │ wait 500ms                                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ 第 2 步 ───────────────────────────────────────────┐  │
│  │ skeleton = getSkeleton() → 页面已切换到短信登录       │  │
│  │ callStreamingAI(text, skeleton, [completed], "")      │  │
│  │   → AI: [command]{type,e30,18674069215,done:0}       │  │
│  │ onCommandsParsed([{type,e30}])                        │  │
│  │ executor.execute({type,e30})                          │  │
│  │   → findElement: [data-skeleton-id="e30"] ✓          │  │
│  │   → focus → nativeInputValueSetter → input+change ✅  │  │
│  │ onCommandResult("type", true, "输入成功")             │  │
│  │ completed = [..., {action:"type",elementId:"e30"}]    │  │
│  │ wait 500ms                                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ 第 3 步 ───────────────────────────────────────────┐  │
│  │ skeleton = getSkeleton()                              │  │
│  │ callStreamingAI(text, skeleton, [completed], "")      │  │
│  │   → AI: [command]{click,e45,获取验证码,done:1}       │  │
│  │ onCommandsParsed([{click,e45}])                       │  │
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

## 十六、错误处理与重试

### 16.1 错误类型

| 错误类型 | 触发条件 | 处理方式 |
|---------|---------|---------|
| 元素未找到 | `findElement()` 返回 null | `lastError = "[action] 未找到目标元素"` → consecutiveErrors++ → 重试 |
| 执行异常 | `execute()` 抛出异常 | `lastError = "[action] 执行异常: ..."` → consecutiveErrors++ → 重试 |
| need_html | AI 输出 `[need_html]` 标签 | `searchByKeywords()` → consecutiveErrors++ → 重试 |
| 技能失败 | `onSkillActivate()` 返回失败 | `lastError = "技能 xxx 执行失败"` → consecutiveErrors++ → 重试 |
| AI 无输出 | adapter 返回空字符串 | `break`（视为任务完成） |
| 无有效标签 | extractTags 未提取到任何标签 | `break`（视为任务完成） |
| AI 请求失败 | adapter.chat() 抛出异常 | 返回空结果 → `break` |
| AbortError | 用户中止 | 向上抛出，processInput 捕获并显示"已停止" |

### 16.2 重试策略

```
consecutiveErrors = 0
while (consecutiveErrors < 5):
  执行一步
  成功 → consecutiveErrors = 0, 继续
  失败 → consecutiveErrors++, 记录 lastError, 继续循环

if (consecutiveErrors >= 5):
  "未找到对应元素，请准确说出您的需求"
```

**关键：** 使用"连续错误"而非"总尝试次数"。中间成功会重置计数，允许在多步操作中偶发失败后继续。

### 16.3 重试时 AI 收到的信息

```
[原始请求] 用户: "切换到短信登录，输入手机号18674069215，点击发送验证码"

[已完成] 1. click e23 (短信登录)

[上次错误] [type] 未找到目标元素

[当前页面骨架]
{"url":"...","title":"...","elements":[...]}
```

AI 根据这些信息：
1. 知道原始意图（不重复理解）
2. 知道 click e23 已完成（不重复执行）
3. 知道 type e30 失败（调整策略）
4. 看到最新骨架（可能元素 ID 变化）
5. 输出 `[steps]` 剩余步骤 + 第一条指令
