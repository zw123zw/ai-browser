# 浏览器命令设计架构

## Goal

设计浏览器命令的完整执行体系：语义骨架提取、[command] 指令格式、三重元素定位、完整事件触发、执行结果判定、失败重试机制、[need_html] 局部 HTML 兜底、跨页面连续指令队列。

本文档是统一输入架构的执行层实现，接收来自意图检测架构（`06-13-intent-detection-arch`）的 `[command]` 和 `[need_html]` 标签，负责在浏览器中实际执行操作。

---

## 一、语义骨架提取

### 1.1 为什么不用原始 HTML

| 方式 | 大小 | Tokens 估算 |
|------|------|------------|
| 原始清洗 HTML | 15-60KB | 4000-15000 |
| 语义骨架 JSON | 2-8KB | 500-2000 |
| **节省** | **70-85%** | |

原始 HTML 90% 是布局容器（div/span），对 AI 定位元素没有帮助。

### 1.2 提取规则

**保留的元素：**

| 类型 | 提取内容 |
|------|---------|
| 可交互元素 | a / button / input / select / textarea / [onclick] / [role="button"] / [tabindex] |
| 文本内容 | h1-h6 / p / li / td / th / label / span（有直接文字的） |
| 表单元素 | input 的 type/name/placeholder/value |
| 地标元素 | nav / header / main / aside / footer / [role] |
| 媒体元素 | video / audio 的 src 和控件状态 |
| 父级上下文 | 保留 2-3 层父级，提供位置上下文 |

**丢弃的元素：**

- 纯布局 div/span（无文字、无交互、无语义 role）
- 嵌套超过 3 层的中间容器
- SVG 图标（非交互的）
- 空白节点、注释
- class/style（除非 data-testid 等定位属性）

### 1.3 输出格式

```json
{
  "url": "https://www.example.com",
  "title": "示例网站",
  "elements": [
    {"id": "e1", "tag": "a", "text": "首页", "href": "/", "parent": "nav"},
    {"id": "e2", "tag": "input", "type": "search", "placeholder": "搜索", "parent": "header"},
    {"id": "e3", "tag": "button", "text": "登录", "class": "login-btn"},
    {"id": "e4", "tag": "a", "text": "文章标题一", "href": "/post/1"},
    {"id": "e5", "tag": "a", "text": "文章标题二", "href": "/post/2"}
  ]
}
```

每个元素包含：
- `id` — 骨架中的唯一标识（用于 elementId 定位）
- `tag` — 标签名
- `text` — 可见文字（截断到 100 字符）
- `href` / `src` / `action` — 关键属性
- `type` / `name` / `placeholder` — 表单属性
- `role` / `aria-label` — 无障碍属性
- `parent` — 父级地标标签（提供位置上下文）

### 1.4 实现

```typescript
// src/browser/skeleton.ts

export interface SkeletonElement {
  id: string                // 唯一标识 e1, e2, ...
  tag: string               // 标签名
  text?: string             // 可见文字（截断 100 字符）
  href?: string             // a 标签的 href
  src?: string              // img/video/audio 的 src
  type?: string             // input 的 type
  name?: string             // input 的 name
  placeholder?: string      // input 的 placeholder
  value?: string            // input/textarea 的当前值
  role?: string             // ARIA role
  ariaLabel?: string        // aria-label
  parent?: string           // 父级地标标签（nav/header/main 等）
  class?: string            // 仅保留 data-testid 等定位属性，或关键 class
}

export interface SemanticSkeleton {
  url: string
  title: string
  elements: SkeletonElement[]
}

/**
 * 从当前页面提取语义骨架
 * 遍历 DOM，按规则提取可交互+文本元素，输出 JSON 结构
 */
export function extractSkeleton(doc: Document): SemanticSkeleton {
  const elements: SkeletonElement[] = []
  let idCounter = 0

  const interactiveSelector = 'a, button, input, select, textarea, [onclick], [role="button"], [tabindex]'
  const textSelector = 'h1, h2, h3, h4, h5, h6, p, li, td, th, label'
  const landmarkSelector = 'nav, header, main, aside, footer, [role="navigation"], [role="banner"], [role="main"]'

  const candidates = doc.querySelectorAll(`${interactiveSelector}, ${textSelector}, ${landmarkSelector}`)

  for (const el of candidates) {
    if (!isVisible(el)) continue

    const id = `e${++idCounter}`
    const element = extractElement(el as HTMLElement, id)
    if (element) {
      element.parent = findLandmarkParent(el as HTMLElement)
      elements.push(element)
    }
  }

  return {
    url: doc.location.href,
    title: doc.title,
    elements,
  }
}

function extractElement(el: HTMLElement, id: string): SkeletonElement | null {
  const tag = el.tagName.toLowerCase()
  const text = getDirectText(el).slice(0, 100)

  if (!text && !isInteractive(el) && !el.getAttribute('role')) return null

  const base: SkeletonElement = { id, tag }

  if (text) base.text = text
  if (el instanceof HTMLAnchorElement && el.href) base.href = el.href
  if (el instanceof HTMLImageElement && el.src) base.src = el.src
  if (el instanceof HTMLInputElement) {
    base.type = el.type
    if (el.name) base.name = el.name
    if (el.placeholder) base.placeholder = el.placeholder
    if (el.value) base.value = el.value
  }
  if (el.getAttribute('role')) base.role = el.getAttribute('role')!
  if (el.getAttribute('aria-label')) base.ariaLabel = el.getAttribute('aria-label')!
  if (el.dataset.testid) base.class = `[data-testid="${el.dataset.testid}"]`

  return base
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  return ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
    !!el.getAttribute('onclick') ||
    el.getAttribute('role') === 'button' ||
    !!el.getAttribute('tabindex')
}

function getDirectText(el: HTMLElement): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent?.trim() || ''
    }
  }
  if (!text) {
    text = el.getAttribute('aria-label') || el.getAttribute('title') || ''
  }
  return text.trim()
}

function findLandmarkParent(el: HTMLElement): string | undefined {
  let current = el.parentElement
  const landmarks = ['nav', 'header', 'main', 'aside', 'footer']
  while (current) {
    const tag = current.tagName.toLowerCase()
    if (landmarks.includes(tag)) return tag
    const role = current.getAttribute('role')
    if (role && ['navigation', 'banner', 'main', 'complementary', 'contentinfo'].includes(role)) return role
    current = current.parentElement
  }
  return undefined
}
```

### 1.5 局部 HTML 提取（[need_html] 兜底）

骨架无法 100% 覆盖所有元素（div 做的按钮、图标按钮无文字、动态加载等）。

当 AI 在骨架中找不到目标时，返回 `[need_html]` 请求局部 HTML：

```
[need_html]{"query":"登录按钮附近区域","reason":"骨架中未找到明确的登录入口"}[/need_html]
```

系统在 DOM 中搜索相关区域，提取该区域完整子树 HTML 发给 AI，AI 重新分析后给出精确指令。

**骨架保证效率（90% 一次命中），局部 HTML 保证准确性（10% 兜底）。**

```typescript
/**
 * 根据关键词在 DOM 中搜索相关区域，提取局部完整 HTML
 * @param query 搜索关键词（如 "登录按钮"）
 * @returns 局部 HTML 字符串，未找到返回 null
 */
export function extractLocalHtml(query: string): string | null {
  // 1. 在骨架元素中搜索包含关键词的元素
  const allElements = document.querySelectorAll('*')
  let target: HTMLElement | null = null

  for (const el of allElements) {
    const text = el.textContent?.trim() || ''
    const ariaLabel = el.getAttribute('aria-label') || ''
    const placeholder = el.getAttribute('placeholder') || ''
    const title = el.getAttribute('title') || ''

    if ([text, ariaLabel, placeholder, title].some(t => t.includes(query))) {
      target = el as HTMLElement
      break
    }
  }

  if (!target) return null

  // 2. 向上找到合适的容器（3-5 层父级）
  let container = target
  for (let i = 0; i < 3; i++) {
    if (!container.parentElement) break
    container = container.parentElement
  }

  // 3. 克隆并清理
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())

  return clone.outerHTML
}
```

---

## 二、[command] 指令格式

### 2.1 指令结构

```typescript
export interface Command {
  action: string           // 操作类型（AI 自由生成，在能力域内）
  elementId?: string       // 骨架中的元素 ID（主定位）
  fallbackSelector?: string // CSS 选择器（备选定位）
  text?: string            // type 操作的输入文字
  url?: string             // navigate 操作的目标 URL
  key?: string             // keyboard 操作的按键
  direction?: string       // scroll 操作的方向
  ms?: number              // wait 操作的等待时间
  description?: string     // 操作描述（日志用）
}
```

### 2.2 Action 能力域（开放型）

Prompt 中声明扩展支持的所有能力，AI 在范围内自由组合：

```
可执行操作：
- click: 点击元素
- type: 在输入框中输入文字
- clear: 清空输入框
- scroll: 滚动页面 (up/down/top/bottom)
- navigate: 打开新URL
- select: 选择下拉框选项
- keyboard: 模拟键盘 (Enter/Escape/Tab/ArrowUp/ArrowDown等)
- focus: 聚焦元素
- hover: 鼠标悬停
- wait: 等待指定毫秒

可组合多个操作，如: focus → type → keyboard(Enter)
```

### 2.3 [need_html] 请求格式

```typescript
export interface NeedHtmlRequest {
  query: string    // 搜索关键词（如 "登录按钮"）
  reason: string   // 为什么找不到（如 "骨架中未找到包含'下载'文字的按钮"）
}
```

---

## 三、执行引擎（ActionExecutor）

### 3.1 元素查找策略（三重定位）

```
elementId 查找
    │
    ├── 找到 → 执行
    │
    └── 未找到
         │
         ↓
    fallbackSelector 查找
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

```typescript
// src/browser/action-executor.ts

export interface ActionResult {
  success: boolean
  message: string
}

export class ActionExecutor {
  /**
   * 执行单条指令
   */
  async execute(cmd: Command): Promise<ActionResult> {
    // 1. 查找目标元素（非 navigate/wait 不需要元素）
    const needsElement = !['navigate', 'wait', 'scroll'].includes(cmd.action)
    let element: HTMLElement | null = null

    if (needsElement) {
      element = this.findElement(cmd)
      if (!element) {
        return { success: false, message: `未找到目标元素: ${cmd.description || cmd.action}` }
      }
    }

    // 2. 执行操作
    switch (cmd.action) {
      case 'click':     return this.executeClick(element!)
      case 'type':      return this.executeType(element!, cmd.text || '')
      case 'clear':     return this.executeClear(element!)
      case 'scroll':    return this.executeScroll(cmd.direction || 'down')
      case 'navigate':  return this.executeNavigate(cmd.url || '')
      case 'select':    return this.executeSelect(element!, cmd.text || '')
      case 'keyboard':  return this.executeKeyboard(cmd.key || '')
      case 'focus':     return this.executeFocus(element!)
      case 'hover':     return this.executeHover(element!)
      case 'wait':      return this.executeWait(cmd.ms || 1000)
      default:          return { success: false, message: `未知操作类型: ${cmd.action}` }
    }
  }

  /**
   * 三重定位查找元素
   */
  private findElement(cmd: Command): HTMLElement | null {
    // 第一优先：elementId（骨架中的 id，快）
    if (cmd.elementId) {
      const el = document.querySelector(`[data-skeleton-id="${cmd.elementId}"]`)
      if (el) return el as HTMLElement
    }

    // 第二优先：fallbackSelector（CSS 选择器，容错）
    if (cmd.fallbackSelector) {
      try {
        const el = document.querySelector(cmd.fallbackSelector)
        if (el) return el as HTMLElement
      } catch {}
    }

    // 第三优先：文本内容匹配（模糊搜索）
    if (cmd.description) {
      return this.findByText(cmd.description)
    }

    return null
  }

  /**
   * 文本模糊匹配查找元素
   */
  private findByText(text: string): HTMLElement | null {
    const candidates = document.querySelectorAll('a, button, input, [role="button"], [onclick]')
    for (const el of candidates) {
      const elText = el.textContent?.trim() || ''
      const ariaLabel = el.getAttribute('aria-label') || ''
      if (elText.includes(text) || ariaLabel.includes(text)) {
        return el as HTMLElement
      }
    }
    return null
  }
}
```

### 3.2 事件触发（完整序列）

不是简单调用 `.click()`，而是触发完整的浏览器事件序列：

```typescript
/**
 * 点击操作：触发完整的鼠标事件序列
 * mousedown → mouseup → click
 */
private async executeClick(el: HTMLElement): Promise<ActionResult> {
  try {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    const mouseEventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    }

    el.dispatchEvent(new MouseEvent('mousedown', mouseEventInit))
    el.dispatchEvent(new MouseEvent('mouseup', mouseEventInit))
    el.dispatchEvent(new MouseEvent('click', mouseEventInit))

    // 如果是 <a> 标签，还需要处理 navigation
    if (el instanceof HTMLAnchorElement && el.href) {
      // 浏览器会自动处理 <a> 的 click 导航
    }

    return { success: true, message: '点击成功' }
  } catch (error) {
    return { success: false, message: `点击失败: ${error}` }
  }
}

/**
 * 输入操作：focus → 设置值 → 触发 input/change 事件
 * 需要触发 input 事件让 React/Vue 等框架感知
 */
private async executeType(el: HTMLElement, text: string): Promise<ActionResult> {
  try {
    // focus
    el.focus()
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))

    // 设置值
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // 使用 nativeInputValueSetter 绕过 React/Vue 的受控组件
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
      )?.set
      if (nativeSetter) {
        nativeSetter.call(el, text)
      } else {
        el.value = text
      }
    }

    // 触发 input 事件（让框架感知）
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))

    return { success: true, message: `输入成功: ${text}` }
  } catch (error) {
    return { success: false, message: `输入失败: ${error}` }
  }
}

/**
 * 清空操作
 */
private async executeClear(el: HTMLElement): Promise<ActionResult> {
  return this.executeType(el, '')
}

/**
 * 键盘操作：keydown → keypress → keyup
 */
private async executeKeyboard(key: string): Promise<ActionResult> {
  try {
    const keyEventInit: KeyboardEventInit = {
      key,
      code: `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    }

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', keyEventInit))
    document.activeElement?.dispatchEvent(new KeyboardEvent('keypress', keyEventInit))
    document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', keyEventInit))

    return { success: true, message: `键盘操作成功: ${key}` }
  } catch (error) {
    return { success: false, message: `键盘操作失败: ${error}` }
  }
}

/**
 * 导航操作
 */
private async executeNavigate(url: string): Promise<ActionResult> {
  try {
    window.location.href = url
    return { success: true, message: `导航到: ${url}` }
  } catch (error) {
    return { success: false, message: `导航失败: ${error}` }
  }
}

/**
 * 滚动操作
 */
private async executeScroll(direction: string): Promise<ActionResult> {
  try {
    const scrollAmount = window.innerHeight * 0.8
    switch (direction) {
      case 'up':     window.scrollBy(0, -scrollAmount); break
      case 'down':   window.scrollBy(0, scrollAmount); break
      case 'top':    window.scrollTo(0, 0); break
      case 'bottom': window.scrollTo(0, document.body.scrollHeight); break
    }
    return { success: true, message: `滚动: ${direction}` }
  } catch (error) {
    return { success: false, message: `滚动失败: ${error}` }
  }
}

/**
 * 下拉框选择
 */
private async executeSelect(el: HTMLElement, value: string): Promise<ActionResult> {
  if (!(el instanceof HTMLSelectElement)) {
    return { success: false, message: '目标元素不是下拉框' }
  }
  try {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { success: true, message: `选择: ${value}` }
  } catch (error) {
    return { success: false, message: `选择失败: ${error}` }
  }
}

/**
 * 聚焦操作
 */
private async executeFocus(el: HTMLElement): Promise<ActionResult> {
  try {
    el.focus()
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    return { success: true, message: '聚焦成功' }
  } catch (error) {
    return { success: false, message: `聚焦失败: ${error}` }
  }
}

/**
 * 悬停操作
 */
private async executeHover(el: HTMLElement): Promise<ActionResult> {
  try {
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }))
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }))

    return { success: true, message: '悬停成功' }
  } catch (error) {
    return { success: false, message: `悬停失败: ${error}` }
  }
}

/**
 * 等待操作
 */
private async executeWait(ms: number): Promise<ActionResult> {
  await new Promise(resolve => setTimeout(resolve, ms))
  return { success: true, message: `等待 ${ms}ms` }
}
```

### 3.3 执行结果判定

| Action | 成功判定 |
|--------|---------|
| click | 元素存在且可点击，触发事件无异常 |
| type | 输入框值已改变 |
| navigate | 页面开始导航（监听 beforeunload） |
| scroll | 页面滚动位置改变 |
| keyboard | 事件成功派发 |
| wait | 等待时间结束 |
| focus | 元素获得焦点 |
| hover | 事件成功派发 |
| select | 下拉框值已改变 |
| clear | 输入框值已清空 |

---

## 四、错误重试机制

### 4.1 两种失败类型

| 失败类型 | 原因 | 重试方式 |
|---------|------|---------|
| **解析失败** | AI 返回格式错误，无法提取 [command] JSON | 重发骨架 + 用户指令 + 错误格式说明 |
| **执行失败** | 元素不存在 / 页面变化 / 权限不足 | 重发骨架 + 原始指令 + 失败原因 + 请求新策略 |

### 4.2 重试流程

```
骨架 + 用户指令 → AI → [command] → 执行
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                  成功        解析失败    执行失败
                    │           │           │
                  完成         AI重试      AI重试
                             (格式错误)   (附带:
                              重发骨架     1. 原始 command
                              +用户指令    2. 失败原因
                                           3. 请求新策略)
                    两种重试共用 3 次上限
```

### 4.3 解析失败重试消息格式

```
你上一次的回复:
<原始 AI 回复>

解析错误: <错误原因，如 "command JSON 格式错误，缺少 action 字段">

请根据错误信息修正指令格式，重新输出。
```

### 4.4 执行失败重试消息格式

```
上次指令: [command]{"action":"click","elementId":"e4"}[/command]
执行失败: 元素 e4 未找到（页面可能已滚动或动态加载）

当前页面骨架已更新（见下方）。
请根据新骨架重新定位目标元素，给出新的指令。

页面语义骨架:
<最新骨架 JSON>
```

关键：**每次重试都带上最新骨架**，因为页面可能已经变化（滚动、动态加载、导航）。

### 4.5 重试策略

```typescript
// src/browser/retry-handler.ts

const MAX_RETRY = 3

export class RetryHandler {
  /**
   * 带重试的指令执行
   * 解析失败和执行失败共用 3 次重试上限
   */
  async executeWithRetry(
    aiOutput: string,
    userText: string,
    callAI: (prompt: string) => Promise<string>,
    execute: (cmd: Command) => Promise<ActionResult>,
  ): Promise<'success' | 'exhausted'> {
    let lastAiOutput = aiOutput
    let lastError = ''

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      // 1. 解析 AI 输出
      const parsed = parsePhase2Tags(lastAiOutput)

      // 2. 解析失败 → 重试
      if (!parsed.commands?.length && !parsed.skill && !parsed.needHtml) {
        lastError = '未解析出有效指令或技能'
        if (attempt < MAX_RETRY) {
          lastAiOutput = await callAI(this.buildRetryPrompt(userText, lastAiOutput, lastError))
          continue
        }
        return 'exhausted'
      }

      // 3. [need_html] 兜底
      if (parsed.needHtml) {
        const localHtml = extractLocalHtml(parsed.needHtml.query)
        if (localHtml) {
          lastAiOutput = await callAI(this.buildNeedHtmlPrompt(userText, parsed.needHtml, localHtml))
          continue
        }
      }

      // 4. 执行指令
      if (parsed.commands) {
        for (const cmd of parsed.commands) {
          const result = await execute(cmd)
          if (!result.success) {
            lastError = result.message
            if (attempt < MAX_RETRY) {
              // 重新获取骨架（页面可能已变化）
              const newSkeleton = extractSkeleton(document)
              lastAiOutput = await callAI(this.buildExecFailPrompt(userText, cmd, lastError, newSkeleton))
              break  // 跳出 for 循环，进入下一次重试
            }
            return 'exhausted'
          }
        }
        // 所有指令执行成功
        return 'success'
      }
    }

    return 'exhausted'
  }

  private buildRetryPrompt(userText: string, lastOutput: string, error: string): string {
    return [
      `用户描述: "${userText}"`,
      `你上一次的回复:\n${lastOutput}`,
      `解析错误: ${error}`,
      '请根据错误信息修正指令格式，重新输出。',
      `\n当前页面骨架:\n${JSON.stringify(extractSkeleton(document), null, 2)}`,
    ].join('\n\n')
  }

  private buildExecFailPrompt(userText: string, failedCmd: Command, error: string, skeleton: SemanticSkeleton): string {
    return [
      `用户描述: "${userText}"`,
      `上次指令: [command]${JSON.stringify(failedCmd)}[/command]`,
      `执行失败: ${error}`,
      '当前页面骨架已更新（见下方）。请根据新骨架重新定位目标元素，给出新的指令。',
      `\n页面语义骨架:\n${JSON.stringify(skeleton, null, 2)}`,
    ].join('\n\n')
  }

  private buildNeedHtmlPrompt(userText: string, needHtml: NeedHtmlRequest, localHtml: string): string {
    return [
      `用户描述: "${userText}"`,
      `之前骨架中未找到目标: ${needHtml.reason}`,
      `以下是"${needHtml.query}"附近的完整HTML:\n${localHtml}`,
      '请根据这段 HTML 生成精确的操作指令。',
    ].join('\n\n')
  }
}
```

---

## 五、跨页面连续指令

### 5.1 问题

当前会话状态在 content script 中，页面导航 → content script 销毁 → 会话丢失。

### 5.2 解法：会话状态上移到 Background

```
VoicePanel / InputBar (content script)
    │ 语音识别 / 文字输入
    ↓
Background (service worker)
    │ 会话状态 + AI 调用 + 指令队列
    ↓
Content Script (每个页面)
    │ 骨架提取 + 指令执行
```

### 5.3 页面导航感知

```typescript
// Background 中监听页面加载
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return  // 只处理主框架
  if (!isSessionActive()) return

  const nextStep = getNextPendingStep()
  if (nextStep?.action === 'wait' && nextStep.condition === 'page_loaded') {
    markStepComplete(nextStep)
    await injectContentScript(details.tabId)
    const skeleton = await getSkeletonFromTab(details.tabId)
    await executeNextStep(skeleton)
  }
})
```

### 5.4 多步骤指令队列

```typescript
interface StepQueue {
  steps: Command[]          // AI 返回的完整指令序列
  currentIndex: number      // 当前执行到第几步
  status: 'pending' | 'executing' | 'waiting_page' | 'completed' | 'failed'
  retryCount: number        // 当前步骤重试次数
}
```

执行流程：
1. AI 返回 N 条指令 → 入队
2. 逐条执行，每条等完成后再执行下一条
3. 遇到 `navigate` → 标记 `waiting_page` → 等 `onCompleted` → 继续
4. 遇到 `wait` → 延时后继续
5. 执行失败 → 重试（最多 3 次）→ 超限报错

---

## 六、Tag 解析器（完整实现）

### 标签类型总览

| 标签 | 阶段 | 用途 | 示例 |
|------|------|------|------|
| `[chat]...[/chat]` | Phase 1 | 聊天回复 | `[chat]{"text":"你好！"}[/chat]` |
| `[command]...[/command]` | Phase 1/2 | 浏览器指令 | `[command]{"action":"click","elementId":"e3"}[/command]` |
| `[skill]...[/skill]` | Phase 1/2 | 技能触发 | `[skill]{"name":"翻译","userText":"中文"}[/skill]` |
| `[action]` | Phase 1 | 需要骨架 | `[action]` |
| `[need_html]...[/need_html]` | Phase 2 | 局部HTML兜底 | `[need_html]{"query":"...","reason":"..."}[/need_html]` |

### 实现

```typescript
// src/input/tag-parser.ts

export interface ParsedTags {
  chat?: string                                // [chat] 内容
  isAction?: boolean                           // [action] 标记
  skill?: { name: string; userText: string }   // [skill] JSON
  commands?: Command[]                         // [command] 列表
  needHtml?: { query: string; reason: string } // [need_html] JSON
  rawText: string
}

/** 解析 Phase 1 输出 */
export function parsePhase1Tags(rawText: string): ParsedTags {
  const result: ParsedTags = { rawText }

  if (rawText.includes('[chat]')) {
    const m = rawText.match(/\[chat\]([\s\S]*?)\[\/chat\]/)
    if (m) {
      try { result.chat = JSON.parse(m[1]).text || m[1].trim() }
      catch { result.chat = m[1].trim() }
    }
  }

  if (rawText.includes('[command]')) {
    const cmds: Command[] = []
    for (const m of rawText.matchAll(/\[command\]([\s\S]*?)\[\/command\]/g)) {
      try { cmds.push(JSON.parse(m[1])) } catch {}
    }
    if (cmds.length) result.commands = cmds
  }

  if (rawText.includes('[skill]')) {
    const m = rawText.match(/\[skill\]([\s\S]*?)\[\/skill\]/)
    if (m) {
      try {
        const d = JSON.parse(m[1])
        result.skill = { name: d.name, userText: d.userText || '' }
      } catch {}
    }
  }

  if (rawText.includes('[action]')) result.isAction = true

  return result
}

/** 解析 Phase 2 输出 */
export function parsePhase2Tags(rawText: string): ParsedTags {
  const result: ParsedTags = { rawText }

  const skillMatch = rawText.match(/\[skill\]([\s\S]*?)\[\/skill\]/)
  if (skillMatch) {
    try {
      const d = JSON.parse(skillMatch[1])
      result.skill = { name: d.name, userText: d.userText || '' }
    } catch {}
  }

  const cmds: Command[] = []
  for (const m of rawText.matchAll(/\[command\]([\s\S]*?)\[\/command\]/g)) {
    try { cmds.push(JSON.parse(m[1])) } catch {}
  }
  if (cmds.length) result.commands = cmds

  const htmlMatch = rawText.match(/\[need_html\]([\s\S]*?)\[\/need_html\]/)
  if (htmlMatch) {
    try { result.needHtml = JSON.parse(htmlMatch[1]) } catch {}
  }

  return result
}
```

---

## 七、目录结构

```
src/
├── browser/                        # 浏览器命令执行层（新增）
│   ├── skeleton.ts                 # 语义骨架提取
│   ├── action-executor.ts          # 执行引擎（三重定位 + 完整事件触发）
│   ├── retry-handler.ts            # 错误重试处理器
│   ├── local-html.ts               # 局部 HTML 提取（need_html 兜底）
│   └── types.ts                    # 类型定义（Command, ActionResult 等）
└── voice/                          # 语音相关（保留）
    ├── broadcast.ts                # TTS 播报
    ├── recognition.ts              # Web Speech API
    └── sherpa-recognition.ts       # Sherpa 本地识别
```

---

## 八、关键修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/browser/skeleton.ts` | 新建，语义骨架提取 |
| `src/browser/action-executor.ts` | 新建，执行引擎 |
| `src/browser/retry-handler.ts` | 新建，错误重试处理器 |
| `src/browser/local-html.ts` | 新建，局部 HTML 提取 |
| `src/browser/types.ts` | 新建，类型定义 |

---

## 九、Acceptance Criteria

- [ ] 语义骨架提取正确，可交互元素和文本内容不遗漏
- [ ] 骨架 token 消耗比原始 HTML 节省 70%+
- [ ] 三重元素定位策略生效（elementId → fallbackSelector → 文本匹配）
- [ ] click 操作触发完整事件序列（mousedown → mouseup → click）
- [ ] type 操作触发 input/change 事件（兼容 React/Vue 受控组件）
- [ ] keyboard 操作触发完整事件序列（keydown → keypress → keyup）
- [ ] navigate 操作正确跳转
- [ ] scroll 操作正确滚动
- [ ] 执行失败时重试最多 3 次（带最新骨架 + 失败原因）
- [ ] 解析失败时重试最多 3 次（带原始回复 + 错误原因）
- [ ] `[need_html]` 兜底机制生效（局部 HTML 提取 → 重新 AI 决策）
- [ ] 跨页面指令不丢失（navigate → 等待加载 → 继续执行）
- [ ] TypeScript 类型检查通过

---

## 十、Out of Scope

- Firefox 适配
- 移动端浏览器
- 复杂的拖拽操作
- 文件上传/下载操作
- iframe 内操作
- Shadow DOM 内元素定位

---

## 十一、Technical Notes

### 元素查找优先级

- elementId 快（直接 querySelector），但依赖骨架提取时的 DOM 状态
- fallbackSelector 容错（CSS 选择器），但可能匹配到多个元素
- 文本匹配最后兜底，但可能误匹配

### 事件触发注意事项

- 不能只调 `.click()`，需要触发完整事件序列
- React/Vue 受控组件需要通过 nativeInputValueSetter 设置值
- keyboard 操作需要正确的 key/code 值

### 跨页面指令

- Background 中的会话状态不随页面导航丢失
- `chrome.webNavigation.onCompleted` 监听页面加载完成
- 多指令串行执行使用 `for...of` + `await`，顺序重要
