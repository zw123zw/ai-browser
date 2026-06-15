# 浏览器命令设计架构（已实现）

> 本文档描述已实现的浏览器命令执行体系，基于实际代码 `src/browser/` 和 `src/input/` 整理。

## Goal

设计浏览器命令的完整执行体系：语义骨架提取、`[command]` 指令格式、三重元素定位、完整事件触发、执行结果判定、失败重试机制、`[need_html]` 局部 HTML 兜底、标签页操作。

本文档是统一输入架构的执行层实现，接收来自意图检测架构（`06-13-voice-arch-v2`）的 `[command]` 和 `[need_html]` 标签，负责在浏览器中实际执行操作。

---

## 一、语义骨架提取

### 1.1 为什么不用原始 HTML

| 方式 | 大小 | Tokens 估算 |
|------|------|------------|
| 原始清洗 HTML | 15-60KB | 4000-15000 |
| 语义骨架 JSON | 2-8KB | 500-2000 |
| **节省** | **70-85%** | |

原始 HTML 90% 是布局容器（div/span），对 AI 定位元素没有帮助。

### 1.2 提取规则（实际实现）

**保留的元素：**

| 类型 | 选择器 | 提取内容 |
|------|--------|---------|
| 可交互元素 | `a, button, input, select, textarea, [onclick], [role="button"], [tabindex]` | tag, text, href, type, name, placeholder, value, role, aria-label, title |
| 文本内容 | `h1-h6, p, li, td, th, label` | 直接文字（截断 100 字符） |
| 地标元素 | `nav, header, main, aside, footer, [role="navigation"], [role="banner"], [role="main"]` | 位置上下文 |
| 图标元素 | 包含 `svg, img, i, [class*="icon"]` 子元素的交互元素 | 标记为 `(icon)` |

**丢弃的元素：**

- 纯布局 div/span（无文字、无交互、无语义 role、无图标子元素）
- 不可见元素（`display:none`、`visibility:hidden`、`opacity:0`、宽高为 0 且无子元素）
- script/style/noscript

**实际代码：** `src/browser/skeleton.ts`

```typescript
// 关键实现细节
const interactiveSelector = 'a, button, input, select, textarea, [onclick], [role="button"], [tabindex]'
const textSelector = 'h1, h2, h3, h4, h5, h6, p, li, td, th, label'
const landmarkSelector = 'nav, header, main, aside, footer, [role="navigation"], [role="banner"], [role="main"]'

// 可见性检测（比 PRD 多了宽高检查）
function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0 && el.children.length === 0) return false
  return true
}
```

### 1.3 输出格式

```json
{
  "url": "https://www.example.com",
  "title": "示例网站",
  "elements": [
    {"id": "e1", "tag": "a", "text": "首页", "href": "/", "parent": "nav"},
    {"id": "e2", "tag": "input", "type": "search", "placeholder": "搜索", "parent": "header"},
    {"id": "e3", "tag": "button", "text": "登录", "role": "button"},
    {"id": "e4", "tag": "button", "text": "(icon)", "ariaLabel": "关闭", "title": "关闭弹窗"},
    {"id": "e5", "tag": "a", "text": "文章标题一", "href": "/post/1"}
  ]
}
```

每个元素包含：
- `id` — 骨架中的唯一标识（`e1`, `e2`, ...），同时写入 DOM 的 `data-skeleton-id` 属性
- `tag` — 标签名
- `text` — 可见文字（截断到 100 字符），图标元素标记为 `(icon)`
- `href` / `src` — 链接/媒体地址
- `type` / `name` / `placeholder` / `value` — 表单属性（input 和 textarea 都提取）
- `role` / `aria-label` / `title` — 无障碍属性
- `parent` — 父级地标标签（nav/header/main 等）
- `class` — 仅保留 `data-testid` 等定位属性

**额外属性（实际代码比 PRD 多）：**
- `title` — title 属性（按钮/链接的提示文字），用于图标按钮识别
- button 的 `type` 属性
- 带 `onclick`/`tabindex` 的元素自动补充 `role: "button"`

### 1.4 SkeletonManager（骨架缓存）

```typescript
// src/browser/skeleton.ts

export class SkeletonManager {
  private lastUrl: string = ''
  private lastSkeleton: SemanticSkeleton | null = null

  getSkeleton(): SemanticSkeleton {
    const currentUrl = window.location.href
    if (currentUrl !== this.lastUrl || !this.lastSkeleton) {
      this.lastSkeleton = extractSkeleton(document)
      this.lastUrl = currentUrl
    }
    return this.lastSkeleton
  }

  invalidate(): void {
    this.lastUrl = ''
    this.lastSkeleton = null
  }
}
```

**缓存策略：**
- URL 未变 → 返回缓存
- URL 变化 → 重新提取
- 执行 `navigate` 后 → 调用 `invalidate()` 标记失效

### 1.5 局部 HTML 提取（`[need_html]` 兜底）

当骨架无法定位目标时，根据关键词在 DOM 中搜索相关区域，提取完整子树 HTML。

**实际代码：** `src/browser/local-html.ts`

**查找策略（三级）：**
1. `contextId` 定位 — AI 指定的上下文骨架元素 ID（如 `e114`）
2. 骨架 ID 匹配 — query 如 `e77` 格式
3. 文本内容搜索 — 模糊匹配 textContent/aria-label/placeholder/title/value

**提取逻辑：**
- 向上找 3 层父级容器（提供上下文）
- 克隆并清理（移除 script/style/noscript）

```typescript
export function extractLocalHtml(query: string, contextId?: string): string | null {
  // 0. 优先用 contextId 定位
  if (contextId) {
    target = document.querySelector(`[data-skeleton-id="${contextId}"]`)
  }
  // 1. 按骨架 ID 查找
  if (!target && /^e\d+$/.test(query)) {
    target = document.querySelector(`[data-skeleton-id="${query}"]`)
  }
  // 2. 按文本内容搜索（模糊匹配）
  // ... 长标题用前 30 字符匹配
  // 3. 向上 3 层父级 → 克隆清理
}
```

---

## 二、`[command]` 指令格式

### 2.1 指令结构（实际类型）

```typescript
// src/browser/types.ts

export interface Command {
  action: string           // 操作类型（AI 自由生成，在能力域内）
  elementId?: string       // 骨架中的元素 ID（主定位）
  fallbackSelector?: string // CSS 选择器（备选定位）
  text?: string            // type 操作的输入文字
  url?: string             // navigate 操作的目标 URL
  key?: string             // keyboard 操作的按键
  direction?: string       // scroll 操作的方向
  amount?: number          // scroll 操作的滚动像素
  ms?: number              // wait 操作的等待时间
  description?: string     // 操作描述（日志用 / 文本匹配兜底）
  tabAction?: 'newTab' | 'closeTab' | 'switchTab' | 'nextTab' | 'prevTab'
  tabQuery?: string        // switchTab 的目标标签关键词
}
```

### 2.2 Action 能力域（15 种操作）

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
```

### 2.3 `[need_html]` 请求格式

```typescript
export interface NeedHtmlRequest {
  query: string      // 搜索关键词
  reason: string     // 为什么需要 HTML
  contextId?: string // 离目标最近的骨架元素 ID，用于提取周围 HTML
}
```

---

## 三、执行引擎（ActionExecutor）

### 3.1 元素查找策略（三重定位）

```
elementId 查找（data-skeleton-id 属性）
    │
    ├── 找到 → 执行
    │
    └── 未找到
         │
         ↓
    fallbackSelector 查找（CSS 选择器）
         │
         ├── 找到 → 执行
         │
         └── 未找到
              │
              ↓
         文本内容匹配（模糊搜索）
              │
              ├── 找到 → 执行
              │
              └── 未找到 → 返回失败原因
```

**文本匹配策略（两级）：**
1. 优先搜索交互元素（a, button, input, select, [role="button"], [onclick], [tabindex]）
2. 兜底搜索所有元素（覆盖 div/span + SVG 图标按钮），过滤不可见元素

匹配方式：`textContent`、`aria-label`、`title` 属性的 `includes()` 匹配。

### 3.2 不需要元素的操作

```typescript
const needsElement = !['navigate', 'wait', 'scroll', 'keyboard', 'press', 'newTab', 'closeTab', 'switchTab', 'nextTab', 'prevTab'].includes(cmd.action)
```

### 3.3 事件触发（完整序列）

**click 操作：**
```typescript
private async executeClick(el: HTMLElement): Promise<ActionResult> {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))

  // <a> 标签用 window.open 触发导航（合成事件不触发浏览器默认行为）
  if (el instanceof HTMLAnchorElement && el.href) {
    const opened = window.open(el.href, el.target || '_self')
    // 弹窗被拦截 → 降级为当前页跳转
    if (!opened) window.location.href = el.href
  } else {
    el.dispatchEvent(new MouseEvent('click', { ... }))
  }
}
```

**type 操作（兼容 React/Vue）：**
```typescript
private async executeType(el: HTMLElement, text: string): Promise<ActionResult> {
  el.focus()
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

  // 使用 nativeInputValueSetter 绕过 React/Vue 受控组件
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (nativeSetter) nativeSetter.call(el, text)
  else el.value = text

  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
```

**keyboard 操作（含 Enter 表单提交）：**
```typescript
private async executeKeyboard(key: string): Promise<ActionResult> {
  const target = document.activeElement || document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code: this.getKeyCode(key), bubbles: true, cancelable: true }))
  target.dispatchEvent(new KeyboardEvent('keypress', { ... }))
  target.dispatchEvent(new KeyboardEvent('keyup', { ... }))

  // Enter 键：尝试提交表单（合成事件不触发浏览器默认行为）
  if (key === 'Enter') {
    const form = (target as HTMLElement).closest('form')
    if (form) { form.requestSubmit(); return }
    // 兜底：全局找搜索输入框并提交
    const searchInput = document.querySelector('input[type="search"], input[name="q"], ...')
    searchInput?.closest('form')?.requestSubmit()
  }
}
```

**getKeyCode 映射：**
- 特殊键：Enter→Enter, Escape→Escape, Tab→Tab, Backspace→Backspace, ArrowUp→ArrowUp, Space→Space 等
- 单字母：`a` → `KeyA`
- 数字：`1` → `Digit1`

**navigate 操作（新标签页打开）：**
```typescript
private async executeNavigate(url: string): Promise<ActionResult> {
  window.open(url, '_blank')
  return { success: true, message: `新标签页打开: ${url}` }
}
```

**scroll 操作（支持自定义像素）：**
```typescript
private async executeScroll(direction: string, amount?: number): Promise<ActionResult> {
  const scrollAmount = amount || window.innerHeight * 0.8
  switch (direction) {
    case 'up':     window.scrollBy(0, -scrollAmount); break
    case 'down':   window.scrollBy(0, scrollAmount); break
    case 'top':    window.scrollTo(0, 0); break
    case 'bottom': window.scrollTo(0, document.body.scrollHeight); break
  }
}
```

### 3.4 标签页操作（通过 Background 代理）

标签页操作通过 `chrome.runtime.sendMessage` 委托给 Background Service Worker 执行：

```typescript
private async executeTabAction(tabAction: 'newTab' | 'closeTab' | 'switchTab', tabQuery?: string): Promise<ActionResult> {
  const response = await chrome.runtime.sendMessage({
    type: 'tab-action',
    action: tabAction,
    query: tabQuery,
  })
  return response?.success
    ? { success: true, message: response.message }
    : { success: false, message: response?.error || `${tabAction} 失败` }
}
```

### 3.5 执行结果判定

| Action | 成功判定 |
|--------|---------|
| click | 元素存在且可点击，<a> 标签成功调用 window.open |
| type | 输入框 focus 成功 + nativeInputValueSetter 设置值 |
| navigate | window.open 成功 |
| scroll | window.scrollBy/scrollTo 执行无异常 |
| keyboard | 事件成功派发，Enter 键尝试提交表单 |
| wait | 等待时间结束 |
| focus | 元素获得焦点 |
| hover | mouseenter/mouseover 事件成功派发 |
| select | 下拉框值已改变 |
| clear | 调用 type(el, '') |
| newTab/closeTab/switchTab | Background 返回 success: true |

---

## 四、错误重试机制

### 4.1 两种失败类型

| 失败类型 | 原因 | 重试方式 |
|---------|------|---------|
| **提取失败** | AI 返回中无有效 `[command]`/`[skill]`/`[need_html]` 标签 | 重发骨架 + 用户指令 + 错误格式说明 |
| **执行失败** | 元素不存在 / 页面变化 / 操作异常 | 重发骨架 + 原始指令 + 失败原因 + 请求新策略 |

### 4.2 重试流程（最大 5 次）

```
骨架 + 用户指令 → AI → 标签提取 → 执行
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                  成功        提取失败    执行失败
                    │           │           │
                  完成         AI重试      AI重试
                             (格式错误)   (附带:
                              重发骨架     1. 原始 command
                              +用户指令    2. 失败原因
                                           3. 请求新策略)
                    两种重试共用 5 次上限
```

### 4.3 `[need_html]` 处理流程

```
AI 返回 [need_html]
    │
    ├── 首次 → 用 description 重试一次（要求 AI 用文本描述定位，禁止再用 need_html）
    │
    └── 二次 → 放弃，提示用户 "请尝试更具体的描述"
```

**关键：** `[need_html]` 不再走完整的局部 HTML 提取流程，而是要求 AI 改用 `description` 字段通过文本匹配定位。

### 4.4 重试消息格式

**提取失败重试：**
```
用户: "点击登录按钮"
页面骨架: { url, title, elements: [...] }
你上次的回复: <原始 AI 回复>
错误: 未找到有效指令标签 [command]、[skill] 或 [need_html]
请在回复中包含有效指令标签。
```

**执行失败重试：**
```
用户: "点击登录按钮"
页面骨架: { url, title, elements: [...] }  ← 最新骨架
你上次的回复: [command]{"action":"click","elementId":"e99"}[/command]
错误: 未找到目标元素: e99
骨架已更新，请根据新骨架重新定位。
```

### 4.5 重试策略（实际实现）

```typescript
// src/input/pipeline.ts

const MAX_RETRY = 5

// 重试不带会话历史，避免之前失败任务的消息污染当前重试上下文
const userContent = buildRetryUserMessage(text, skeleton, lastAiOutput, lastError, errorType, [])

// navigate 执行成功后标记骨架失效
if (cmd.action === 'navigate') {
  this.skeletonManager.invalidate()
}
```

---

## 五、完整处理流水线

### 5.1 流程概览

```
用户输入 "点击登录按钮"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  InputRouter（字符串分割，零 AI）                         │
│                                                         │
│  /翻译 中文 → 直接执行技能                               │
│  /stop → 停止当前操作                                    │
│  其余 → 进入 Phase 1                                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 意图检测（流式输出，打字机效果）                │
│                                                         │
│  输入：用户文本（无骨架、无技能列表）                      │
│  Prompt：二分类，聊天 or [action]                         │
│                                                         │
│  AI 回复 "你好！" → isChat=true → 直接展示               │
│  AI 回复 "[action]" → 进入 Phase 2                       │
│                                                         │
│  ⚠️ Phase 1 不允许输出 [command]/[skill]                  │
│     异常输出时强制进 Phase 2                               │
└─────────────────────────────────────────────────────────┘
    │
    ├── 聊天 → 流式展示 → 结束
    │
    └── [action] ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: 操作决策（主力模型）                            │
│                                                         │
│  输入：                                                  │
│    - 用户描述                                            │
│    - 页面骨架（首次/URL变化时发送，否则复用缓存）         │
│    - 技能列表                                            │
│    - 能力域（15 种操作）                                  │
│                                                         │
│  AI 回复示例：                                            │
│  "好的，我来帮你点击登录按钮。                             │
│   [command]{"action":"click","elementId":"e3"}[/command]"│
│                                                         │
│  解析器从自然回复中提取标签：                              │
│    [command] → 展示"正在执行xxx指令" → 执行               │
│    [skill]   → 展示"正在执行xxx技能" → 执行               │
│    [need_html] → 首次用 description 重试，二次放弃        │
│    提取不到 → 重试（最多 5 次）                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  聊天中展示执行结果 → 结束
```

### 5.2 聊天中展示指令/技能

| 场景 | 消息格式 | 消息类型 |
|------|---------|---------|
| 指令解析完成 | `🔧 **正在执行 N 条指令：**\n1. **action** — description` | system |
| 技能解析完成 | `⚡ **正在执行技能：** 名称 — 描述` | system |
| 单条指令成功 | `✅ **action** — message` | system |
| 单条指令失败 | `❌ **action** — message` | system |
| 重试中 | `⚠️ 指令提取失败，重试 N/5...` 或 `⚠️ 指令执行失败，重试 N/5...` | system |
| 最终错误 | `❌ 多次尝试后仍无法完成操作（5 次），请重新描述` | system |

---

## 六、Tag 解析器

### 标签类型总览

| 标签 | 用途 | 示例 |
|------|------|------|
| `[chat]...[/chat]` | 聊天回复 | `[chat]{"text":"你好！"}[/chat]` |
| `[command]...[/command]` | 浏览器指令 | `[command]{"action":"click","elementId":"e3"}[/command]` |
| `[skill]...[/skill]` | 技能触发 | `[skill]{"name":"翻译","userText":"中文"}[/skill]` |
| `[action]` | 需要操作标记（无内容） | `[action]` |
| `[need_html]...[/need_html]` | 局部HTML兜底 | `[need_html]{"query":"...","reason":"...","contextId":"e3"}[/need_html]` |

### 实现特点

- 从任意 AI 文本中提取标签（标签可嵌入自然语言）
- 支持多条 `[command]` 提取
- `[chat]` 内容支持 JSON 格式或纯文本
- `isChatOnlyReply()` 判断：无任何操作标签 + 有文本内容 = 纯聊天

**实际代码：** `src/input/tag-parser.ts`

---

## 七、目录结构

```
src/
├── browser/                        # 浏览器命令执行层
│   ├── types.ts                    # 类型定义（SkeletonElement, Command, ActionResult, NeedHtmlRequest）
│   ├── skeleton.ts                 # 语义骨架提取 + SkeletonManager 缓存
│   ├── action-executor.ts          # 执行引擎（15 种操作 + 三重定位 + 完整事件触发）
│   ├── local-html.ts               # 局部 HTML 提取（contextId + 文本搜索 + 简化查询）
│   └── index.ts                    # 统一导出
├── input/                          # 统一输入处理层
│   ├── types.ts                    # 类型定义（InputContext, PipelineCallbacks）
│   ├── router.ts                   # 输入路由器（/命令解析）
│   ├── intent-detector.ts          # Phase 1 + Phase 2 AI 调用 + need_html 兜底
│   ├── pipeline.ts                 # 统一处理流水线（路由 → Phase1 → Phase2 → 重试）
│   ├── tag-parser.ts               # 标签提取器（从自然回复中提取）
│   ├── prompts.ts                  # 所有 AI 提示词（集中管理）
│   └── index.ts                    # 统一导出
├── composables/
│   └── usePipeline.ts              # Vue composable（集成流水线到 UI，管理消息展示）
└── ...
```

---

## 八、关键文件清单

| 文件 | 职责 |
|------|------|
| `src/browser/types.ts` | SkeletonElement, SemanticSkeleton, Command, ActionResult, NeedHtmlRequest 类型 |
| `src/browser/skeleton.ts` | extractSkeleton() + SkeletonManager（URL 缓存） |
| `src/browser/action-executor.ts` | ActionExecutor（15 种操作 + 三重定位 + 标签页代理） |
| `src/browser/local-html.ts` | extractLocalHtml()（contextId + 骨架ID + 文本搜索） |
| `src/input/types.ts` | InputContext, InputResult, PipelineCallbacks 类型 |
| `src/input/router.ts` | InputRouter（/ 命令 → builtin/skill/ai 分流） |
| `src/input/intent-detector.ts` | IntentDetector（Phase 1 二分类 + Phase 2 操作决策 + need_html 处理） |
| `src/input/pipeline.ts` | InputPipeline（完整流水线 + 5 次重试 + 指令串行执行） |
| `src/input/tag-parser.ts` | extractTags() + isChatOnlyReply() + getChatText() |
| `src/input/prompts.ts` | PHASE1_SYSTEM_PROMPT, PHASE2_SYSTEM_PROMPT, PHASE2_RETRY_SYSTEM_PROMPT + 消息构建函数 |
| `src/composables/usePipeline.ts` | usePipeline()（Vue 集成 + 消息展示 + AbortController） |

---

## 九、Acceptance Criteria

- [x] 语义骨架提取正确，可交互元素和文本内容不遗漏
- [x] 图标按钮识别（svg/img/i 子元素 → 标记为 `(icon)`）
- [x] 骨架 token 消耗比原始 HTML 节省 70%+
- [x] SkeletonManager 缓存（URL 未变复用，navigate 后失效）
- [x] 三重元素定位策略生效（elementId → fallbackSelector → 文本匹配）
- [x] click 操作触发完整事件序列（mousedown → mouseup → click）
- [x] <a> 标签点击用 window.open 触发导航，弹窗被拦截时降级为当前页跳转
- [x] type 操作触发 input/change 事件（兼容 React/Vue 受控组件）
- [x] keyboard 操作触发完整事件序列（keydown → keypress → keyup）
- [x] Enter 键尝试提交表单（优先 activeElement.form，兜底全局搜索框）
- [x] navigate 操作在新标签页打开
- [x] scroll 操作支持自定义滚动像素
- [x] 标签页操作通过 Background 代理（newTab/closeTab/switchTab/nextTab/prevTab）
- [x] 执行失败时重试最多 5 次（带最新骨架 + 失败原因）
- [x] 提取失败时重试最多 5 次（带原始回复 + 错误原因）
- [x] `[need_html]` 首次用 description 重试，二次放弃
- [x] 所有 prompt 集中在 prompts.ts 管理
- [x] 指令/技能解析后在聊天中用 system 消息展示
- [x] 单条指令执行结果单独展示（✅/❌）
- [x] TypeScript 类型检查通过

---

## 十、Out of Scope

- Firefox 适配
- 移动端浏览器
- 复杂的拖拽操作
- 文件上传/下载操作
- iframe 内操作
- Shadow DOM 内元素定位
- 跨页面连续指令队列（当前 navigate 后不自动继续执行后续指令）

---

## 十一、Technical Notes

### 元素查找优先级

- elementId 快（直接 `[data-skeleton-id]` 属性查询），依赖骨架提取时的 DOM 状态
- fallbackSelector 容错（CSS 选择器），但可能匹配到多个元素
- 文本匹配最后兜底，两级搜索（先交互元素，再所有元素），可能误匹配

### 事件触发注意事项

- 不能只调 `.click()`，需要触发完整事件序列
- <a> 标签的 click 合成事件不触发浏览器默认导航，需用 `window.open()`
- React/Vue 受控组件需要通过 `nativeInputValueSetter` 设置值
- keyboard 操作需要正确的 key/code 值
- Enter 键需要手动查找 form 并调用 `requestSubmit()`

### 标签页操作

- Content Script 无法直接调用 `chrome.tabs` API
- 通过 `chrome.runtime.sendMessage` 委托 Background 执行
- Background 处理 `tab-action` 消息，调用 `chrome.tabs.create/remove/update/query`

### Pipeline 集成

- `usePipeline()` Vue composable 管理完整生命周期
- AbortController 支持中止正在进行的 AI 请求
- 流式消息（打字机效果）通过 `onChatDelta` 回调实现
- 指令执行结果通过 `onCommandResult` 回调展示
- 会话历史取最近 6 条（排除当前轮次），过滤 system 消息
