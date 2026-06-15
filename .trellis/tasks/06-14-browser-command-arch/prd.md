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
const interactiveSelector = 'a, button, input, select, textarea, [onclick], [role="button"], [tabindex]'
const textSelector = 'h1, h2, h3, h4, h5, h6, p, li, td, th, label'
const landmarkSelector = 'nav, header, main, aside, footer, [role="navigation"], [role="banner"], [role="main"]'

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
    {"id": "e4", "tag": "button", "text": "(icon)", "ariaLabel": "关闭", "title": "关闭弹窗"}
  ]
}
```

每个元素包含：`id`, `tag`, `text`, `href`, `type`, `name`, `placeholder`, `value`, `role`, `aria-label`, `title`, `parent`, `class`

### 1.4 SkeletonManager（骨架缓存）

```typescript
// src/browser/skeleton.ts
class SkeletonManager {
  getSkeleton(): SemanticSkeleton   // URL 未变 → 缓存 / URL 变化 → 重新提取
  invalidate(): void                 // navigate 后标记失效
  get cachedUrl(): string
}
```

### 1.5 局部 HTML 提取（`[need_html]` 兜底）

```typescript
// src/browser/local-html.ts
export function extractLocalHtml(query: string, contextId?: string): string | null
  // 1. contextId → [data-skeleton-id] 定位
  // 2. /^e\d+$/ → 骨架 ID 匹配
  // 3. 文本内容搜索 → 模糊匹配 textContent/aria-label/placeholder/title/value
  // 向上 3 层父级 → 克隆清理 → 返回 HTML 或 null
```

---

## 二、`[command]` 指令格式

### 2.1 指令结构

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
}
```

### 2.2 Action 能力域（15 种）

```
navigate / search / click / type / clear / scroll / select / keyboard
focus / hover / wait / newTab / closeTab / switchTab / nextTab / prevTab
```

---

## 三、执行引擎（ActionExecutor）

```typescript
// src/browser/action-executor.ts
class ActionExecutor {
  async execute(cmd: Command): Promise<ActionResult>
    // { success: boolean, message: string }

  private findElement(cmd: Command): HTMLElement | null
    // 三重定位: elementId → fallbackSelector → description 文本匹配

  private async executeClick(el: HTMLElement): Promise<ActionResult>
    // mousedown → mouseup → <a>: window.open / 其他: click 事件

  private async executeType(el: HTMLElement, text: string): Promise<ActionResult>
    // focus → nativeInputValueSetter → input + change 事件

  private async executeKeyboard(key: string): Promise<ActionResult>
    // keydown → keypress → keyup → Enter: form.requestSubmit()

  private async executeNavigate(url: string): Promise<ActionResult>
    // window.open(url, '_blank')

  private async executeScroll(direction: string, amount?: number): Promise<ActionResult>
    // amount 默认 innerHeight * 0.8

  private async executeTabAction(tabAction, tabQuery?): Promise<ActionResult>
    // chrome.runtime.sendMessage → Background 代理
}
```

---

## 四、完整处理流水线

### 4.1 流程概览（实际代码）

```
用户输入 "点击登录按钮"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  InputRouter（字符串分割，零 AI）                         │
│  src/input/router.ts → route(ctx)                        │
│                                                         │
│  /翻译 中文 → { type: 'skill', skillName, skillUserText }│
│  /stop → { type: 'builtin', command, args }              │
│  其余 → { type: 'ai' }                                   │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 意图检测（流式输出 + 标签检测）                 │
│  src/input/intent-detector.ts → detectPhase1()           │
│                                                         │
│  输入：用户文本（无骨架、无技能列表）                      │
│  Prompt：二分类                                          │
│    - 需要操作 → [action]                                  │
│    - 聊天 → 自然语言回复                                  │
│  禁止输出 [command]、[skill]                              │
│                                                         │
│  流式输出时检测操作标签：                                 │
│    正则: /\[(?:action|command|skill)|(?:action|command|  │
│          skill)\]/                                       │
│    检测到 → 清掉流式内容（clearContent=true）             │
│    用户只看到"思考中..."                                  │
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
│  Phase 2: 操作决策（主力模型 + 重试循环）                 │
│  src/input/intent-detector.ts → detectPhase2()           │
│  src/input/pipeline.ts → processPhase2WithRetry()        │
│                                                         │
│  输入：                                                  │
│    - 用户描述                                            │
│    - 页面骨架（SkeletonManager 缓存）                    │
│    - 技能列表（{skillList} 占位符替换）                  │
│    - 能力域（15 种操作）                                 │
│                                                         │
│  AI 回复 → extractTags() 提取标签：                      │
│    [command] → 执行指令                                  │
│    [skill]   → 执行技能                                  │
│    [need_html] → 内部处理（提取 HTML → 第二次 AI 请求）  │
│    无标签 → 重试（最多 5 次）                            │
│                                                         │
│  重试消息展示：                                           │
│    提取失败 → "⚠️ 指令提取失败，重试 N/5..."              │
│    执行失败 → "⚠️ 指令执行失败，重试 N/5..."              │
│    need_html → "⚠️ 需要更多页面信息，重试 N/5..."         │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  聊天中展示执行结果 → 结束
```

### 4.2 Phase 1 流式标签检测（详细）

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
- 操作：思考中... → 🔧 正在执行 N 条指令 → ✅/❌ 结果

### 4.3 Phase 2 `[need_html]` 内部处理

```typescript
// src/input/intent-detector.ts → detectPhase2()

if (tags.needHtml && !tags.commands?.length && !tags.skill) {
  // 1. 提取局部 HTML
  let localHtml = extractLocalHtml(tags.needHtml.query, tags.needHtml.contextId)

  // 2. contextId 失败 → 文本搜索
  if (!localHtml && tags.needHtml.contextId) {
    localHtml = extractLocalHtml(tags.needHtml.query)
  }

  // 3. 文本搜索失败 → 简化查询
  if (!localHtml) {
    const simpleQuery = simplifyQuery(tags.needHtml.query)
    if (simpleQuery !== tags.needHtml.query) {
      localHtml = extractLocalHtml(simpleQuery)
    }
  }

  // 4. HTML 提取成功 → 第二次 AI 请求
  if (localHtml) {
    const retryOutput = await this.callAI(
      'Phase2-NeedHtml',
      systemPrompt,
      buildNeedHtmlUserMessage(text, tags.needHtml, localHtml),
    )
    // 5. 从第二次回复提取 [command]
    const retryTags = extractTags(retryOutput)
    if (retryTags.commands?.length || retryTags.skill) {
      return { commands: retryTags.commands, skill: retryTags.skill, rawAiOutput: retryOutput }
    }
  }
}
```

### 4.4 Phase 2 重试循环

```typescript
// src/input/pipeline.ts → processPhase2WithRetry()

for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
  const skeleton = this.skeletonManager.getSkeleton()

  // 首次 vs 重试
  if (attempt === 0) {
    phase2Result = await this.detector.detectPhase2(text, skeleton)
  } else {
    callbacks.onRetryMessage(...)  // 展示重试提示
    phase2Result = await this.retryPhase2(text, skeleton, lastAiOutput, lastError, errorType)
  }

  // 未提取到标签 → 重试
  if (!phase2Result.commands?.length && !phase2Result.skill && !phase2Result.needHtml) {
    lastErrorType = 'extract'
    continue
  }

  // 技能 → 执行
  if (phase2Result.skill) { ... }

  // 指令 → 执行
  if (phase2Result.commands?.length) { ... }

  // need_html → pipeline 层重试
  if (phase2Result.needHtml) {
    if (!needHtmlRetried) {
      lastErrorType = 'need_html'  // 显示"需要更多页面信息"
      continue
    }
    // 二次放弃
    callbacks.onError(...)
    return
  }
}
```

---

## 五、聊天中展示

| 场景 | 消息格式 | 消息类型 |
|------|---------|---------|
| 指令解析完成 | `🔧 **正在执行 N 条指令：**\n1. **action** — description` | system |
| 技能解析完成 | `⚡ **正在执行技能：** 名称 — 描述` | system |
| 单条指令成功 | `✅ **action** — message` | system |
| 单条指令失败 | `❌ **action** — message` | system |
| 提取失败重试 | `⚠️ 指令提取失败，重试 N/5...` | system |
| 执行失败重试 | `⚠️ 指令执行失败，重试 N/5...` | system |
| need_html 重试 | `⚠️ 需要更多页面信息，重试 N/5...` | system |
| 最终错误 | `❌ 多次尝试后仍无法完成操作（5 次），请重新描述` | system |

---

## 六、Tag 解析器

```typescript
// src/input/tag-parser.ts

interface ExtractedTags {
  chatText?: string
  commands?: Command[]
  skill?: { name: string; userText: string }
  isAction: boolean
  needHtml?: NeedHtmlRequest
  hasAnyTag: boolean
  rawText: string
}

function extractTags(rawText: string): ExtractedTags
  // 正则匹配 [chat], [command](多条), [skill], [action], [need_html]

function isChatOnlyReply(tags: ExtractedTags): boolean
  // 无操作标签 + 有文本 = true

function getChatText(tags: ExtractedTags): string
  // [chat] 标签内容 → 否则 rawText
```

---

## 七、提示词管理

**实际代码：** `src/input/prompts.ts`

### 7.1 能力域（所有 Prompt 共用）

```typescript
export const CAPABILITY_DOMAIN = `\`\`\`
navigate / search / click / type / clear / scroll / select / keyboard
focus / hover / wait / newTab / closeTab / switchTab / nextTab / prevTab
\`\`\``
```

### 7.2 Phase 1 提示词（二分类）

```typescript
export const PHASE1_SYSTEM_PROMPT = `\`\`\`
你是浏览器扩展的 AI 助手，可以控制浏览器执行操作（打开网站、搜索、点击、输入等）。

判断用户输入是否需要浏览器操作：
- 需要操作页面/打开网站/搜索/执行技能 → 回复 [action]
- 其他（聊天/问答/闲聊）→ 直接用自然语言回复

示例：
- "打开B站" → [action]
- "搜索Vue教程" → [action]
- "今天天气怎么样" → 直接回答
- "帮我翻译这个页面" → [action]

你只能输出：自然语言回复 或 [action]
禁止输出 [command]、[skill] 或其他标签。
\`\`\``
```

### 7.3 Phase 2 提示词（操作决策）

```typescript
export const PHASE2_SYSTEM_PROMPT = `\`\`\`
你是浏览器操作助手。根据用户意图生成操作指令。

指令格式：
[command]{"action":"click","elementId":"e3","description":"登录"}[/command]
[skill]{"name":"翻译","userText":"这个页面"}[/skill]
[need_html]{"query":"下载","reason":"骨架未找到","contextId":"e3"}[/need_html]

能力域：${CAPABILITY_DOMAIN}
定位优先级：elementId > fallbackSelector > description
可用技能：{skillList}

规则：
1. 只处理当前用户请求，对话历史仅用于理解指代，不要重复之前的操作
2. "然后/接着/再" 意味着对同一个元素执行不同的操作（如先点赞再收藏），不是重复上一次操作
3. 打开网站/搜索/滚动 → 直接返回[command]（不需要骨架）
4. 操作页面元素 → 用骨架elementId定位
5. 有匹配技能 → 返回[skill]
6. 找不到目标 → 返回[need_html]
7. 多步操作按顺序输出多个[command]

图标按钮识别：
- 很多按钮没有文字，只有图标（svg/img/i/class含icon），骨架中标记为"(icon)"
- 通过aria-label、title、role属性识别其功能
- 骨架中text为"(icon)"的元素，优先检查aria-label/title属性来判断功能
\`\`\``
```

### 7.4 Phase 2 重试提示词

```typescript
export const PHASE2_RETRY_SYSTEM_PROMPT = `\`\`\`
你上一次的操作失败了。根据错误信息和最新骨架重新生成指令。

指令格式：
[command]{"action":"click","elementId":"e3","description":"登录"}[/command]
[skill]{"name":"翻译","userText":"这个页面"}[/skill]
[need_html]{"query":"下载","reason":"骨架未找到","contextId":"e3"}[/need_html]
\`\`\``
```

### 7.5 消息构建函数

```typescript
function buildPhase2UserMessage(text: string, skeleton: SemanticSkeleton): string
  // → "用户: \"...\"\n\n页面骨架:\n{...}"

function buildRetryUserMessage(text, skeleton, lastAiOutput, lastError, errorType, recentMessages): string
  // errorType: 'extract' | 'exec' | 'need_html'
  // extract → "请在回复中包含有效指令标签。"
  // exec → "骨架已更新，请根据新骨架重新定位。"
  // need_html → "请改用 description 字段描述目标，禁止使用 [need_html]。"

function buildNeedHtmlUserMessage(text, needHtml, localHtml): string
  // → "用户: \"...\"\n\n未找到: ...\n\n\"...\"附近HTML:\n```html\n...\n```"
```

---

## 八、关键方法签名

### InputPipeline

```typescript
// src/input/pipeline.ts
class InputPipeline {
  constructor(options: PipelineOptions)

  async process(ctx: InputContext, callbacks: PipelineCallbacks): Promise<void>
    // 主入口: 路由 → Phase 1 → Phase 2 → 执行

  private async processPhase2WithRetry(text: string, callbacks: PipelineCallbacks): Promise<void>
    // 重试循环: 最多 5 次, 三种错误类型

  private async executeCommands(commands: Command[], callbacks: PipelineCallbacks): Promise<{ success: boolean; error: string }>
    // 串行执行, navigate 后 invalidate 骨架

  private async retryPhase2(text, skeleton, lastAiOutput, lastError, errorType): Promise<Phase2Result>
    // errorType: 'extract' | 'exec' | 'need_html'
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
    // 返回: { commands?, skill?, needHtml?, rawAiOutput }
    // 内部处理 [need_html]: extractLocalHtml → 第二次 AI 请求

  private async callAI(scene, systemPrompt, userContent, onChunk?): Promise<string>
    // scene: 'Phase1' | 'Phase2' | 'Phase2-NeedHtml'
}
```

### ActionExecutor

```typescript
// src/browser/action-executor.ts
class ActionExecutor {
  async execute(cmd: Command): Promise<ActionResult>
  private findElement(cmd: Command): HTMLElement | null  // 三重定位
}
```

### SkeletonManager

```typescript
// src/browser/skeleton.ts
function extractSkeleton(doc: Document): SemanticSkeleton
class SkeletonManager {
  getSkeleton(): SemanticSkeleton
  invalidate(): void
  get cachedUrl(): string
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

## 九、目录结构

```
src/
├── browser/
│   ├── types.ts                    # SkeletonElement, Command, ActionResult, NeedHtmlRequest
│   ├── skeleton.ts                 # extractSkeleton() + SkeletonManager
│   ├── action-executor.ts          # ActionExecutor（15 种操作 + 三重定位）
│   ├── local-html.ts               # extractLocalHtml()
│   └── index.ts
├── input/
│   ├── types.ts                    # InputContext, PipelineCallbacks, InputResult
│   ├── router.ts                   # InputRouter → builtin/skill/ai 分流
│   ├── intent-detector.ts          # IntentDetector（Phase 1 + Phase 2 + need_html）
│   ├── pipeline.ts                 # InputPipeline（完整流水线 + 重试 + 流式标签检测）
│   ├── tag-parser.ts               # extractTags() + isChatOnlyReply()
│   ├── prompts.ts                  # 所有 AI 提示词
│   └── index.ts
├── composables/
│   └── usePipeline.ts              # Vue 集成
└── ...
```

---

## 十、Acceptance Criteria

- [x] 语义骨架提取（可交互元素 + 文本内容 + 地标 + 图标）
- [x] 图标按钮识别（svg/img/i/class含icon → `(icon)`）
- [x] SkeletonManager 缓存（URL 未变复用，navigate 后失效）
- [x] 三重元素定位（elementId → fallbackSelector → 文本匹配）
- [x] click 完整事件序列（mousedown → mouseup → click）
- [x] <a> 标签 window.open + 弹窗拦截降级
- [x] type 兼容 React/Vue（nativeInputValueSetter）
- [x] keyboard 完整事件序列 + Enter 表单提交
- [x] 标签页操作 Background 代理
- [x] Phase 1 二分类（聊天 or [action]）
- [x] Phase 1 流式输出时检测操作标签，清掉内容
- [x] Phase 2 操作决策（[command]/[skill]/[need_html]）
- [x] [need_html] 内部处理（提取 HTML → 第二次 AI 请求）
- [x] [need_html] pipeline 层重试（need_html 错误类型）
- [x] 重试 5 次（提取失败 / 执行失败 / need_html 三种类型）
- [x] "然后/接着/再" 语义规则
- [x] 图标按钮识别提示词（svg/img/i/class含icon）
- [x] 提示词集中在 prompts.ts

---

## 十一、Out of Scope

- Firefox 适配
- 移动端浏览器
- 拖拽操作
- 文件上传/下载
- iframe / Shadow DOM
- 跨页面连续指令队列


Phase 2 完整流程

  入口

  Phase 1 返回 [action] 后进入 Phase 2，调用 processPhase2WithRetry(text, callbacks)

  重试循环（最多 5 次）

  for attempt = 0 to 5:
    1. 提取骨架（每次重新提取）
    2. 调用 AI 获取指令
    3. 解析结果 → 分支处理

  分支处理（按优先级）

  分支 A：标签提取失败（AI 没返回 [command]/[skill]/[need_html]）
  → lastError = "未找到有效指令标签"
  → lastErrorType = "extract"
  → continue（重试）

  分支 B：技能触发（AI 返回 [skill]）
  → 调用 onSkillActivate(name, userText)
  → 成功 → return
  → 失败 → lastError = 错误信息，lastErrorType = "exec"，continue

  分支 C：浏览器指令（AI 返回 [command]）
  → 逐条执行 executeCommands()
  → 全部成功 → return
  → 任意失败 → lastError = 错误信息，lastErrorType = "exec"，continue
  → 特殊：navigate 成功后调用 skeletonManager.invalidate() 清缓存

  分支 D：need_html（AI 返回 [need_html]）
  needHtmlRetried 计数器 +1

  第 1 次：depth=1，提取 contextId 周围 HTML → 拼接给 AI 重试
  第 2 次：depth=2，扩大范围
  第 3 次：depth=3，再扩大
  第 4 次：放弃 HTML 提取，告诉 AI "用 description 字段定位，禁止 [need_html]"
  第 5 次：放弃，报错 "未找到对应元素"

  提取失败 → 降级到 description 重试

  重试时 AI 请求的构建

  首次：detectPhase2(text, skeleton) → 完整的 Phase2 系统提示词 + 骨架 + 用户消息

  重试：retryPhase2(...) → 用 PHASE2_RETRY_SYSTEM_PROMPT（精简版）+ 骨架 + 上次 AI 回复 + 错误信息

  need_html 重试：直接用 buildNeedHtmlUserMessage() → 用户原文 + 局部 HTML + 指令