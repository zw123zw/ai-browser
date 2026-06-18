# 意图检测架构：语音/文字双模式统一输入路由

> 本文档描述已实现的统一输入架构，基于实际代码 `src/input/`、`src/browser/`、`src/voice/` 整理。

## Goal

将语音模式和文字模式统一为一套输入路由 + 两阶段 AI 意图检测架构，实现三路分流（聊天/技能/浏览器指令）。语音和文字只是入口不同，核心处理流水线完全共用。

---

## 一、整体架构流程图

```
用户输入（语音/文字）
    │
    │  语音：VoiceRecognition / SherpaRecognition → 文本
    │  文字：InputBar → 直接文本
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  InputRouter（字符串分割，零 AI）                         │
│  src/input/router.ts                                     │
│                                                         │
│  /翻译 中文 → 直接执行技能（零 AI）                       │
│  /stop → 停止当前操作                                    │
│  /help → 显示帮助                                        │
│  其余 → 进入 Phase 1                                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 意图检测（流式输出，打字机效果）                │
│  src/input/intent-detector.ts                            │
│                                                         │
│  输入：用户文本（无骨架、无技能列表）                      │
│  Prompt：三分类，聊天 / [action] / [command]              │
│                                                         │
│  AI 回复 "你好！" → isChat=true → 流式展示 → 结束        │
│  AI 回复 "[action]" → 进入 Phase 2                       │
│  AI 回复 "[command]{...}" → 直接执行 → 结束（快速通道）   │
│                                                         │
│  快速通道指令（不需要页面骨架）：                          │
│  navigate / scroll / newTab / closeTab /                 │
│  nextTab / prevTab / switchTab / keyboard / wait         │
│                                                         │
│  ⚠️ Phase 1 不允许输出 [skill]                            │
│     异常输出时强制进 Phase 2                               │
└─────────────────────────────────────────────────────────┘
    │
    ├── 聊天 → 流式展示（打字机效果） → 结束
    │
    ├── [command] → 直接执行（跳过 Phase 2） → 结束
    │
    └── [action] ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: 操作决策（主力模型）                            │
│  src/input/intent-detector.ts + src/input/pipeline.ts    │
│                                                         │
│  输入：                                                  │
│    - 用户描述                                            │
│    - 页面骨架（首次/URL变化时发送，否则复用缓存）         │
│    - 技能列表                                            │
│    - 能力域（15 种浏览器操作）                            │
│                                                         │
│  AI 回复示例：                                            │
│  "好的，我来帮你点击登录按钮。                             │
│   [command]{"action":"click","elementId":"e3"}[/command]"│
│                                                         │
│  解析器从自然回复中提取标签：                              │
│    [command] → 展示"正在执行xxx指令" → 执行               │
│    [skill]   → 展示"正在执行xxx技能" → 执行               │
│    [need_html] → 用 description 重试，二次放弃            │
│    提取不到 → 重试（最多 5 次）                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  执行层                                                  │
│  src/browser/action-executor.ts                          │
│                                                         │
│  15 种操作：navigate/search/click/type/clear/scroll/     │
│  select/keyboard/focus/hover/wait/newTab/closeTab/       │
│  switchTab/nextTab/prevTab                               │
│                                                         │
│  三重元素定位：elementId → fallbackSelector → 文本匹配    │
│  完整事件触发（非简单 .click()）                          │
│  标签页操作通过 Background 代理                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  聊天中展示执行结果 → 结束
```

---

## 二、语音/文字统一入口

### 2.1 架构原则

**语音和文字共享同一套处理流水线**，区别仅在输入源：

```
┌─────────────────────────────────────────────────────────┐
│                    输入源（两种模式）                      │
│                                                         │
│  文字模式：InputBar → processInput(text)                 │
│                                                         │
│  语音模式：Mic → VoiceRecognition → text                 │
│            → processInput(text)                         │
│                                                         │
│  ↓ 两条路最终汇入同一个 ↓                                │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  InputPipeline.process({ text, mode: 'text' | 'voice' })│
│                                                         │
│  mode 字段记录输入来源，处理逻辑完全相同                   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 文字模式入口

```typescript
// entrypoints/content/components/ChatPanel.vue → usePipeline()

const { processInput } = usePipeline()
await processInput(userText)  // 直接传入文本
```

### 2.3 语音模式入口

```typescript
// src/voice/session.ts → VoiceSession

// 语音识别产出文本后，调用同一个 InputPipeline
private handleResult(text: string, isFinal: boolean) {
  if (isFinal) {
    this.processCommand(text)  // → 调用 InputPipeline.process({ text, mode: 'voice' })
  }
}
```

### 2.4 语音识别层（独立于流水线）

语音识别本身是独立模块，负责将语音转为文本：

| 引擎 | 优先级 | 特点 |
|------|--------|------|
| **SherpaRecognition** | 优先 | 完全离线、WebAssembly、sherpa-onnx |
| **VoiceRecognition** | 兜底 | Web Speech API、需联网 |

```typescript
// src/voice/sherpa-recognition.ts
// 完全离线，使用 sherpa-onnx WASM + ScriptProcessorNode
// 模型：sherpa-onnx-streaming-zipformer-bilingual-zh-en（中英双语）
// 采样率：16000 Hz，单声道

// src/voice/recognition.ts
// Web Speech API 封装
// 连续模式、中间结果、自动重启
```

### 2.5 TTS 播报（语音模式特有）

```typescript
// src/voice/broadcast.ts
// Web Speech Synthesis API
// 播报完成 → onEnd → 回到 IDLE → 自动开始下一轮聆听
```

---

## 三、InputRouter — 输入路由

### 3.1 路由规则

```typescript
// src/input/router.ts

export class InputRouter {
  route(ctx: InputContext): InputResult {
    const text = ctx.text.trim()

    // / 前缀 → 确定性解析，不走 AI
    if (text.startsWith('/')) {
      const parsed = this.parseSlashCommand(text)
      if (parsed.isBuiltin) {
        return { type: 'builtin', command: parsed.command, args: parsed.args }
      }
      // 非内置 → 当作技能触发（零 AI）
      return { type: 'skill', skillName: parsed.command, skillUserText: parsed.args }
    }

    // 其余 → AI 意图检测
    return { type: 'ai' }
  }
}
```

### 3.2 三路分流

| 路由结果 | 处理方式 | 示例 |
|---------|---------|------|
| `builtin` | 直接执行内置命令 | `/stop`、`/help` |
| `skill` | 直接触发技能（零 AI） | `/翻译 中文` |
| `ai` | 进入 Phase 1 → Phase 2 | `打开B站`、`点击登录按钮` |

### 3.3 内置命令

```typescript
const BUILTIN_COMMANDS = ['stop', 'pause', 'resume', 'list', 'help']
```

---

## 四、骨架管理策略

### 4.1 核心原则

页面骨架 **不需要每次都发送**，只在以下时机重新提取：

| 时机 | 原因 | 代码位置 |
|------|------|---------|
| 首次进入 Phase 2 | 需要知道当前页面结构 | `SkeletonManager.getSkeleton()` |
| URL 发生变化 | 页面已导航/重定向，骨架失效 | `SkeletonManager.getSkeleton()` 检测 URL |
| 执行 `navigate` 后 | 跳转到新页面 | `Pipeline` 调用 `skeletonManager.invalidate()` |

### 4.2 不需要重新发送

| 场景 | 原因 |
|------|------|
| 同一页面连续对话 | 骨架未变，复用缓存 |
| Phase 2 重试 | 上次骨架仍有效（除非执行了 navigate） |
| click/type/scroll 后 | 骨架结构基本不变 |

### 4.3 实现

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

---

## 五、聊天中展示指令/技能

### 5.1 设计原则

AI 解析出指令后、执行前，在聊天中用 **system 消息** 展示：

```
🔧 正在执行 3 条指令：
1. **click** — 登录按钮
2. **type** — 搜索框 "hello"
3. **keyboard** — 按回车

✅ **click** — 点击成功
✅ **type** — 输入成功: hello
❌ **keyboard** — 未找到活动元素

⚠️ 指令执行失败，重试 1/5...

🔧 正在执行 1 条指令：
1. **keyboard** — 按回车

✅ **keyboard** — 键盘操作: Enter
```

### 5.2 消息类型

| 场景 | 消息格式 | 消息类型 |
|------|---------|---------|
| 指令解析完成 | `🔧 **正在执行 N 条指令：**\n1. **action** — description` | system |
| 技能解析完成 | `⚡ **正在执行技能：** 名称 — 描述` | system |
| 单条指令成功 | `✅ **action** — message` | system |
| 单条指令失败 | `❌ **action** — message` | system |
| 提取失败重试 | `⚠️ 指令提取失败，重试 N/5...` | system |
| 执行失败重试 | `⚠️ 指令执行失败，重试 N/5...` | system |
| 最终错误 | `❌ 多次尝试后仍无法完成操作（5 次），请重新描述` | system |

### 5.3 消息类型标识

- `role: 'assistant'` — AI 聊天回复（Phase 1 纯文本回复，流式展示）
- `role: 'system'` — 系统消息（指令展示、执行结果、重试提示、错误）

---

## 六、Phase 1 Prompt 设计

### 6.1 系统 Prompt（实际实现）

```typescript
// src/input/prompts.ts

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

### 6.2 流式输出

Phase 1 支持流式输出（打字机效果）：
- 聊天回复 → 流式展示，边生成边显示
- `[action]` → 检测到后清除流式内容，显示"正在执行操作..."
- `[command]` → 检测到后清除流式内容，直接执行

```typescript
// src/input/intent-detector.ts
async detectPhase1(text, onChunk) {
  await this.callAI('Phase1', PHASE1_SYSTEM_PROMPT, text, onChunk)
  // onChunk 回调实现流式更新
}
```

### 6.3 Phase 1 快速通道（无骨架指令直出）

**设计动机**：部分浏览器指令不需要页面骨架（如打开网站、滚动、标签页操作），如果走完整 Phase 2 流程（提取骨架 + AI 调用），耗时 3-8 秒。将这类指令提前到 Phase 1 直接输出 `[command]`，只需 1 次 AI 调用，耗时 1-3 秒。

**三分类输出**：

| Phase 1 输出 | 含义 | 后续流程 |
|-------------|------|---------|
| 自然语言 | 纯聊天 | 流式展示 → 结束 |
| `[action]` | 需要页面骨架的操作 | → Phase 2 |
| `[command]{...}` | 不需要骨架的简单操作 | → 直接执行 → 结束 |

**快速通道指令清单**（不需要页面骨架）：

| 指令 | 原因 | 参数来源 |
|------|------|---------|
| `navigate` | 打开 URL，不依赖页面元素 | AI 自身知识（网站名→URL） |
| `scroll` | 滚动页面，window.scrollBy | 方向词 → direction |
| `newTab` | 空白标签页 | 无参数 |
| `closeTab` | 关闭当前标签页 | 无参数 |
| `nextTab` | 下一个标签页 | 无参数 |
| `prevTab` | 上一个标签页 | 无参数 |
| `switchTab` | 按关键词切标签 | tabQuery |
| `keyboard` | 按键操作，作用于 activeElement | 按键名 → key |
| `wait` | 纯等待 | 毫秒数 |

**仍需 Phase 2 的指令**（需要页面骨架定位元素）：

| 指令 | 原因 |
|------|------|
| `search` | 需要知道当前页面是否有搜索框（站内搜 vs 搜索引擎） |
| `click` | 需要 elementId 定位目标元素 |
| `type` | 需要 elementId 定位输入框 |
| `clear` | 需要 elementId 定位输入框 |
| `select` | 需要 elementId 定位下拉框 |
| `focus` | 需要 elementId 定位元素 |
| `hover` | 需要 elementId 定位元素 |

**执行流程**：

```
Phase 1 AI 返回 [command]{"action":"navigate","url":"https://www.bilibili.com"}
    │
    ├── extractTags() 提取到 commands
    │
    ├── pipeline 判断 commands 非空
    │   → callbacks.onActionDetected()
    │   → callbacks.onCommandsParsed(commands)
    │   → executor.execute(cmd)
    │   → callbacks.onCommandResult()
    │   → callbacks.onAllCommandsDone()
    │
    └── 结束（跳过 Phase 2）
```

---

## 七、Phase 2 Prompt 设计

### 7.1 系统 Prompt（实际实现）

```typescript
// src/input/prompts.ts

export const PHASE2_SYSTEM_PROMPT = `\`\`\`
你是浏览器操作助手。根据用户意图生成操作指令。

指令格式（标签可出现在回复任意位置）：
[command]{"action":"click","elementId":"e3","description":"登录"}[/command]
[command]{"action":"navigate","url":"https://..."}[/command]
[skill]{"name":"翻译","userText":"这个页面"}[/skill]
[need_html]{"query":"下载","reason":"骨架未找到","contextId":"e3"}[/need_html]
contextId 是离目标最近的骨架元素ID（如按钮所在的卡片、容器），用于提取周围HTML。

能力域：
navigate / search / click / type / clear / scroll / select / keyboard / focus / hover / wait / newTab / closeTab / switchTab / nextTab / prevTab

定位优先级：elementId > fallbackSelector > description

可用技能：
{skillList}

规则：
1. 只处理当前用户请求，对话历史仅用于理解指代（如"第一个"指什么），不要重复执行之前的操作
2. 打开网站/搜索/滚动 → 直接返回[command]（不需要骨架）
3. 操作页面元素 → 用骨架elementId定位
4. 有匹配技能 → 返回[skill]
5. 找不到目标 → 返回[need_html]
6. 多步操作按顺序输出多个[command]

图标按钮识别：
- 很多按钮没有文字，只有SVG图标
- 通过aria-label、title、role属性识别其功能
- 骨架中没有文字的button，检查其aria-label/title属性
\`\`\``
```

### 7.2 能力域（15 种操作）

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

### 7.3 定位策略

```
elementId（骨架中的 id，快，直接 querySelector）
    │
    ├── 找到 → 执行
    │
    └── 未找到 → fallbackSelector（CSS 选择器，容错）
         │
         ├── 找到 → 执行
         │
         └── 未找到 → description 文本匹配（两级：先交互元素，再所有元素）
              │
              ├── 找到 → 执行
              │
              └── 未找到 → 失败
```

---

## 八、错误重试（5 次）

### 8.1 重试流程

```
Phase 2 首次请求
    │
    ├── 提取到标签 → 执行
    │   ├── 成功 → 结束
    │   └── 失败 → 重试（带最新骨架 + 失败原因）
    │
    ├── [need_html] → 首次用 description 重试 → 二次放弃
    │
    └── 未提取到标签 → 重试（带上次回复 + 错误原因）
        │
        ├── 第 1 次重试 → 展示 "⚠️ 重试 1/5"
        ├── 第 2 次重试 → 展示 "⚠️ 重试 2/5"
        ├── ...
        └── 第 5 次重试 → 展示 "❌ 超过重试上限"
```

### 8.2 重试时发送给 AI 的内容

**提取失败：**
```
用户: "点击登录按钮"
页面骨架: { url, title, elements: [...] }
你上次的回复: <原始 AI 回复>
错误: 未找到有效指令标签 [command]、[skill] 或 [need_html]
请在回复中包含有效指令标签。
```

**执行失败：**
```
用户: "点击登录按钮"
页面骨架: { url, title, elements: [...] }  ← 最新骨架
你上次的回复: [command]{"action":"click","elementId":"e99"}[/command]
错误: 未找到目标元素: e99
骨架已更新，请根据新骨架重新定位。
```

### 8.3 `[need_html]` 处理

```
AI 返回 [need_html]
    │
    ├── 首次 → 用 description 重试（要求 AI 用文本描述定位，禁止再用 need_html）
    │
    └── 二次 → 放弃，提示用户 "请尝试更具体的描述"
```

### 8.4 关键实现细节

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

## 九、Prompt 文件管理

所有 AI 提示词集中在 `src/input/prompts.ts` 文件管理：

```typescript
// src/input/prompts.ts

/** 能力域（所有 Prompt 共用） */
export const CAPABILITY_DOMAIN = `...`

/** Phase 1 系统 Prompt（二分类：聊天 or [action]） */
export const PHASE1_SYSTEM_PROMPT = `...`

/** Phase 2 系统 Prompt（操作决策，含 {skillList} 占位符） */
export const PHASE2_SYSTEM_PROMPT = `...`

/** Phase 2 错误重试 Prompt */
export const PHASE2_RETRY_SYSTEM_PROMPT = `...`

/** 构建 Phase 2 用户消息（用户描述 + 骨架 JSON） */
export function buildPhase2UserMessage(text, skeleton): string { ... }

/** 构建重试用户消息（骨架 + 上次回复 + 错误原因） */
export function buildRetryUserMessage(text, skeleton, lastAiOutput, lastError, errorType, recentMessages): string { ... }

/** 构建 need_html 兜底消息（用户描述 + 局部 HTML） */
export function buildNeedHtmlUserMessage(text, needHtml, localHtml): string { ... }
```

---

## 十、完整文件清单

```
src/
├── input/                          # 统一输入处理层（语音/文字共用）
│   ├── types.ts                    # 类型定义（InputContext, PipelineCallbacks, InputResult）
│   ├── router.ts                   # 输入路由器（/命令解析 → builtin/skill/ai 分流）
│   ├── intent-detector.ts          # Phase 1 + Phase 2 AI 调用 + need_html 兜底
│   ├── pipeline.ts                 # 统一处理流水线（路由 → Phase1 → Phase2 → 重试 → 执行）
│   ├── tag-parser.ts               # 标签提取器（从自然回复中提取 [command]/[skill]/[need_html]）
│   ├── prompts.ts                  # 所有 AI 提示词（集中管理）
│   └── index.ts                    # 统一导出
├── browser/                        # 浏览器命令执行层
│   ├── types.ts                    # 类型定义（SkeletonElement, Command, ActionResult, NeedHtmlRequest）
│   ├── skeleton.ts                 # 语义骨架提取 + SkeletonManager（URL 缓存）
│   ├── action-executor.ts          # 执行引擎（15 种操作 + 三重定位 + 标签页代理）
│   ├── local-html.ts               # 局部 HTML 提取（contextId + 文本搜索 + 简化查询）
│   └── index.ts                    # 统一导出
├── voice/                          # 语音识别层（独立于流水线）
│   ├── recognition.ts              # Web Speech API 语音识别封装
│   ├── sherpa-recognition.ts       # Sherpa-onnx 本地离线语音识别
│   ├── session.ts                  # VoiceSession 状态机（语音 → 文本 → InputPipeline）
│   ├── commandParser.ts            # 【code】指令解析器（旧版语音专用）
│   ├── broadcast.ts                # TTS 语音播报封装
│   └── index.ts                    # 统一导出
├── composables/
│   └── usePipeline.ts              # Vue composable（集成流水线到 UI，管理消息展示）
├── stores/
│   ├── settings.ts                 # 设置 store
│   ├── conversations.ts            # 对话 store
│   └── voice.ts                    # 语音状态 store（4 状态状态机）
└── ...
```

---

## 十一、核心处理流程（完整时序）

### 11.1 文字模式完整流程

```
1. 用户在 InputBar 输入 "点击登录按钮"
   │
2. ChatPanel.vue → usePipeline().processInput("点击登录按钮")
   │
3. InputPipeline.process({ text: "点击登录按钮", mode: "text" })
   │
4. InputRouter.route()
   │  非 / 前缀 → { type: 'ai' }
   │
5. Phase 1: IntentDetector.detectPhase1()
   │  调用 AI，流式输出
   │  AI 回复 "[action]"
   │  → isChat = false → 清除流式消息，显示"正在执行操作..."
   │
6. Phase 2: InputPipeline.processPhase2WithRetry()
   │
   │  6.1 SkeletonManager.getSkeleton()
   │      URL 未变 → 返回缓存 / URL 变化 → 重新提取
   │
   │  6.2 IntentDetector.detectPhase2(text, skeleton)
   │      调用 AI，传入用户描述 + 骨架 JSON + 技能列表
   │      AI 回复: "好的，我来帮你点击登录按钮。
   │               [command]{"action":"click","elementId":"e3"}[/command]"
   │
   │  6.3 extractTags() 提取标签
   │      → commands: [{ action: "click", elementId: "e3" }]
   │
   │  6.4 callbacks.onCommandsParsed(commands)
   │      → 展示 "🔧 正在执行 1 条指令：1. **click** — 登录按钮"
   │
7. InputPipeline.executeCommands()
   │
   │  ActionExecutor.execute({ action: "click", elementId: "e3" })
   │    → findElement(): [data-skeleton-id="e3"] → 找到元素
   │    → executeClick(): mousedown → mouseup → click
   │    → { success: true, message: "点击成功" }
   │
   │  callbacks.onCommandResult("click", true, "点击成功")
   │    → 展示 "✅ **click** — 点击成功"
   │
8. 流程结束
```

### 11.2 语音模式完整流程

```
1. 用户说出 "打开B站"
   │
2. VoiceSession → SherpaRecognition 识别 → 文本 "打开B站"
   │
3. VoiceSession.processCommand("打开B站")
   │  → 调用 InputPipeline.process({ text: "打开B站", mode: "voice" })
   │
4. InputRouter.route()
   │  非 / 前缀 → { type: 'ai' }
   │
5. Phase 1: IntentDetector.detectPhase1()
   │  AI 回复 "[action]" → 进入 Phase 2
   │
6. Phase 2: IntentDetector.detectPhase2("打开B站", skeleton)
   │  AI 回复: [command]{"action":"navigate","url":"https://www.bilibili.com"}[/command]
   │
7. ActionExecutor.executeNavigate("https://www.bilibili.com")
   │  → window.open("https://www.bilibili.com", "_blank")
   │
8. VoiceBroadcast.speak("已打开B站")
   │  → 播报完成 → onEnd → 回到 IDLE → 自动开始下一轮聆听
```

### 11.3 重试流程

```
Phase 2 首次请求
    │
    ├── AI 回复无有效标签
    │   → 展示 "⚠️ 指令提取失败，重试 1/5..."
    │   → 重发骨架 + 上次回复 + 错误原因
    │
    ├── AI 返回 [command] 但执行失败
    │   → 展示 "⚠️ 指令执行失败，重试 1/5..."
    │   → SkeletonManager.invalidate()（navigate 后）
    │   → 重发最新骨架 + 失败指令 + 错误原因
    │
    ├── AI 返回 [need_html]
    │   → 首次：要求 AI 用 description 重试
    │   → 二次：放弃，展示错误
    │
    └── 5 次重试后仍失败
        → 展示 "❌ 多次尝试后仍无法完成操作（5 次），请重新描述"
```

---

## 十二、Acceptance Criteria

### 路由层
- [x] `/翻译 中文` 直接执行技能（零 AI）
- [x] `/stop` 停止当前操作
- [x] `/help` 显示帮助
- [x] 其余输入进入 Phase 1

### Phase 1
- [x] 聊天 → 流式展示纯文本回复（打字机效果）
- [x] 操作 → [action]，进入 Phase 2
- [x] 无骨架指令 → [command]{...}，直接执行（快速通道）
- [x] 异常输出 [skill] 时强制进 Phase 2

### Phase 1 快速通道
- [ ] navigate/scroll/newTab/closeTab/nextTab/prevTab/switchTab/keyboard/wait → Phase 1 直出 [command]
- [ ] Phase 1 返回 [command] 时跳过 Phase 2，直接执行
- [ ] 执行结果正常展示（onCommandsParsed → onCommandResult → onAllCommandsDone）
- [ ] search/click/type 等需要骨架的指令仍走 Phase 2

### Phase 2
- [x] "打开B站" → [command]{"action":"navigate","url":"..."}
- [x] "点击登录" → 用骨架 elementId 定位
- [x] 骨架只在首次/URL变化时发送（SkeletonManager 缓存）
- [x] navigate 执行后标记骨架失效

### 指令执行
- [x] 15 种操作全部支持
- [x] 三重元素定位（elementId → fallbackSelector → 文本匹配）
- [x] click 触发完整事件序列（mousedown → mouseup → click）
- [x] <a> 标签用 window.open 触发导航
- [x] type 兼容 React/Vue 受控组件（nativeInputValueSetter）
- [x] keyboard 触发完整事件序列 + Enter 键表单提交
- [x] 标签页操作通过 Background 代理

### 消息展示
- [x] 解析到指令后聊天中展示"🔧 正在执行 N 条指令"
- [x] 解析到技能后聊天中展示"⚡ 正在执行技能：xxx"
- [x] 每条指令执行结果单独展示（✅/❌）

### 重试
- [x] 重试 5 次，重试过程在聊天中展示
- [x] 重试时发送错误信息 + 最新骨架给 AI
- [x] [need_html] 首次用 description 重试，二次放弃

### Prompt 管理
- [x] 所有 prompt 集中在 prompts.ts 管理
- [x] Phase 2 Prompt 含 {skillList} 占位符，运行时替换

### 语音/文字统一
- [x] 语音和文字输入走同一个 InputPipeline
- [x] InputContext.mode 记录输入来源（'text' | 'voice'）
- [x] 处理逻辑完全相同，仅入口不同

### 构建
- [x] TypeScript 类型检查通过
- [x] 构建通过
