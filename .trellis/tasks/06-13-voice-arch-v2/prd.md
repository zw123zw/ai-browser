# 纯语音交互架构升级 + 全局日志系统

## Goal

将当前语音交互架构从「本地正则解析 + 置信度评估 + 结果播报」升级为「AI 驱动指令解析 + 静默执行 + 常驻等待」模式。同时确保全局日志系统覆盖所有关键路径，方便排查问题。

核心变化：
1. 指令解析权从本地正则交给 AI（输出 `【code】` 标记指令）
2. 支持多条有序指令，串行执行
3. 移除置信度机制，仅区分识别成功/失败
4. 精简 TTS 播报（指令执行静默，仅系统/错误/闲聊播报）
5. 常驻等待模式（每轮结束自动回到 IDLE）
6. 全局 Logger 覆盖所有流程节点

---

## 一、项目技术栈详解

### 1.1 核心框架

| 技术 | 版本 | 作用 |
|------|------|------|
| **WXT** | ^0.19.21 | WebExtension 开发框架，类似 Vite 的浏览器扩展构建工具。提供 `defineBackground()`、`defineContentScript()`、`createShadowRootUi()` 等 API，简化 Chrome Extension MV3 开发 |
| **Vue 3** | ^3.5.13 | 前端 UI 框架，使用 Composition API (`<script setup>`) 构建组件 |
| **Pinia** | ^2.3.0 | Vue 3 状态管理库，替代 Vuex。用于管理对话、设置、语音状态等全局状态 |
| **TypeScript** | ^5.7.2 | 类型安全的 JavaScript 超集，提供编译时类型检查 |

### 1.2 UI 相关

| 技术 | 版本 | 作用 |
|------|------|------|
| **markdown-it** | ^14.1.0 | Markdown 解析器，将 AI 回复的 Markdown 文本渲染为 HTML |
| **highlight.js** | ^11.10.0 | 代码高亮库，配合 markdown-it 渲染代码块 |
| **katex** | ^0.16.11 | 数学公式渲染引擎，支持 LaTeX 语法 |
| **markdown-it-katex** | ^2.0.3 | markdown-it 插件，将 `$...$` 和 `$$...$$` 语法交给 KaTeX 渲染 |
| **uuid** | ^11.0.3 | 生成唯一 ID，用于消息、会话等实体的标识 |

### 1.3 浏览器 API（无需安装，浏览器原生）

| API | 作用 | 使用位置 |
|-----|------|---------|
| **Web Speech API (SpeechRecognition)** | 语音识别（STT），将用户语音转为文字 | `src/voice/recognition.ts` |
| **Web Speech Synthesis API** | 语音播报（TTS），将文字转为语音播放 | `src/voice/broadcast.ts` |
| **chrome.tabs** | 标签页操作（查询当前标签、发送消息） | `VoicePanel.vue`、`background.ts` |
| **chrome.scripting** | 向页面注入脚本（获取 HTML、执行自动化） | `VoicePanel.vue`、`actions.ts` |
| **chrome.storage** | 持久化存储（设置、对话历史） | `src/storage/index.ts` |
| **Shadow DOM** | 隔离 UI 样式，避免与宿主页面冲突 | `entrypoints/content/index.ts` |

### 1.4 开发工具

| 工具 | 版本 | 作用 |
|------|------|------|
| **vue-tsc** | ^2.1.10 | Vue 单文件组件的 TypeScript 类型检查工具 |
| **@wxt-dev/module-vue** | ^1.0.2 | WXT 的 Vue 模块插件，让 WXT 支持 `.vue` 文件 |

---

## 二、项目目录结构

```
src/
├── voice/                    # 语音交互核心模块
│   ├── recognition.ts        # 语音识别封装（Web Speech API）
│   ├── broadcast.ts          # 语音播报封装（SpeechSynthesis API）
│   ├── commandParser.ts      # 指令解析器（解析 AI 输出的 【code】 标记）
│   ├── session.ts            # 语音会话状态机（核心调度器）
│   └── index.ts              # 统一导出
├── adapters/                 # AI 模型适配器层
│   ├── base.ts               # 适配器基类（抽象 chat 方法 + SSE 解析）
│   ├── openai.ts             # OpenAI 兼容适配器（支持 OpenAI/Kimi/自定义）
│   ├── qwen.ts               # 通义千问适配器（阿里 DashScope API）
│   ├── wenxin.ts             # 文心一言适配器（百度 API）
│   └── index.ts              # 适配器工厂（createAdapter(provider)）
├── automation/               # 网页自动化模块
│   ├── actions.ts            # 动作执行器（打开网站/搜索/点击/翻页/视频控制）
│   ├── selectors.ts          # CSS 选择器集合（搜索框/结果/翻页按钮）
│   └── index.ts              # 统一导出
├── stores/                   # Pinia 状态管理
│   ├── conversations.ts      # 文本对话会话管理（CRUD + 流式发送）
│   ├── settings.ts           # 应用设置管理（跨标签同步）
│   └── voice.ts              # 语音状态管理（会话状态、消息历史）
├── utils/                    # 工具函数
│   ├── logger.ts             # 全局日志系统（Logger 类）
│   ├── markdown.ts           # Markdown 渲染配置
│   ├── shortcut.ts           # 快捷键匹配工具
│   ├── file.ts               # 文件转 DataURL 工具
│   └── storage-sync.ts       # 响应式存储同步工具
├── composables/              # Vue 组合式函数
│   └── useToast.ts           # Toast 通知系统
├── storage/                  # WXT 存储定义
│   └── index.ts              # 存储项定义（settings、conversations、fabPos）
├── styles/                   # 全局样式
│   └── global.css            # 所有 CSS（通过 Shadow DOM 隔离）
└── types.ts                  # 核心类型定义（Provider、ChatMessage、Conversation、AppSettings）

entrypoints/
├── background.ts             # Service Worker（工具栏点击、快捷键监听）
└── content/
    ├── index.ts              # Content Script 入口（Shadow DOM 挂载 Vue 应用）
    ├── App.vue               # 根组件（FloatingButton + ChatDrawer + SettingsModal）
    └── components/
        ├── FloatingButton.vue    # 可拖拽悬浮按钮
        ├── ChatDrawer.vue        # 主抽屉（聊天/语音模式切换）
        ├── ChatPanel.vue         # 文本聊天面板
        ├── VoicePanel.vue        # 语音助手面板（核心 UI）
        ├── MessageList.vue       # 消息列表（滚动 + 右键菜单）
        ├── MessageItem.vue       # 单条消息气泡（Markdown 渲染）
        ├── InputBar.vue          # 文本输入栏（图片粘贴、模型选择）
        ├── EmptyChat.vue         # 空状态提示
        ├── SettingsModal.vue     # 设置弹窗（AI 配置 + 通用设置）
        ├── ConfirmDialog.vue     # 确认弹窗
        ├── MessageContextMenu.vue # 右键菜单（复制/删除）
        └── ToastContainer.vue    # Toast 通知容器
```

---

## 三、当前架构 vs 新架构对比

### 3.1 核心差异

| 维度 | 当前架构 | 新架构 | 影响范围 |
|------|---------|--------|---------|
| **指令解析** | 本地正则 `commandParser.ts` 匹配 8 种固定模式 | AI 输出 `【code】` 标记指令，解析器提取 | `session.ts`, `commandParser.ts` |
| **置信度** | 3 级阈值（0.8/0.6/0）评估 | 完全移除，仅区分成功/失败 | `session.ts`, `voice.ts`, `VoicePanel.vue` |
| **TTS 播报** | 所有结果都播报 | 仅系统提示/错误/闲聊播报，指令执行静默 | `session.ts` |
| **多指令** | 单指令 | AI 输出多条有序指令，串行执行 | `commandParser.ts`, `session.ts` |
| **会话模式** | 连续模式开关（可选） | 常驻等待（永久自动循环） | `session.ts`, `voice.ts`, `VoicePanel.vue` |
| **AI 上下文** | 携带最近 6 条语音消息 | 携带最近 3 轮上下文 + 页面 URL + 清洗后 HTML | `session.ts` |
| **容错重试** | 无 | 解析失败回流 AI 重试，最多 3 次 | `session.ts` |

### 3.2 当前代码关键问题

1. **`commandParser.ts` 是纯本地正则** — 只能匹配预定义模式（"打开B站"、"搜索XXX"），无法理解自然语言变体（"帮我看看B站有啥热门"）
2. **`session.ts` 的 `sendToAI()` 携带 6 轮历史** — 改为 3 轮，精简上下文
3. **`session.ts` 的 `executeAutomation()` 播报结果** — 改为静默执行
4. **`voice.ts` 有 `confidence` 和 `continuousMode` 字段** — 移除
5. **`VoicePanel.vue` 有连续模式开关 UI** — 移除（常驻等待，无需开关）
6. **状态机有 `evaluating` 状态** — 移除（不再评估置信度）

---

## 四、新架构详细设计

### 4.1 整体架构流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         常驻式语音交互主循环                                  │
│                                                                             │
│  ┌─────────────┐                                                            │
│  │  IDLE 状态   │ ←──────────────────────────────────────────────┐          │
│  │  常驻等待    │                                                │          │
│  └──────┬──────┘                                                │          │
│         │ 用户点击麦克风                                         │          │
│         ↓                                                       │          │
│  ┌─────────────┐                                                │          │
│  │ LISTENING   │ ← VoiceRecognition (Web Speech API)            │          │
│  │ 聆听中      │   波纹动画                                     │          │
│  └──────┬──────┘                                                │          │
│         │ 识别完成                                               │          │
│         ├─── 识别失败 ──→ TTS("请再说一次") ─────────────────→  │          │
│         │                                                       │          │
│         ↓                                                       │          │
│  ┌─────────────┐                                                │          │
│  │ PROCESSING  │                                                │          │
│  │ 处理中      │                                                │          │
│  └──────┬──────┘                                                │          │
│         │                                                       │          │
│         │  ① 获取页面上下文 (URL + 清洗后 HTML)                  │          │
│         │  ② 构建 AI 请求 (3轮上下文 + 页面HTML + 用户语音)      │          │
│         │  ③ 调用 AI 模型 (adapter.chat)                        │          │
│         │  ④ 解析 AI 输出 (parseBatchCommand)                   │          │
│         │                                                       │          │
│         ├─── 纯对话 ──→ TTS(播报对话) ──────────────────────→  │          │
│         │                                                       │          │
│         ├─── 解析失败 ──→ 重试(≤3次) ──→ 超限TTS("解析失败") → │          │
│         │                                                       │          │
│         ↓                                                       │          │
│  ┌─────────────┐                                                │          │
│  │ 串行执行    │  executeCommandList                             │          │
│  │ 多条指令    │  for (cmd of commands) { await execute(cmd) }  │          │
│  │ 静默无播报  │  单条失败不中断后续                              │          │
│  └──────┬──────┘                                                │          │
│         │                                                       │          │
│         └──────────────────────────────────────────────────────→┘          │
│                         自动回到 IDLE（常驻待命）                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 指令解析层重构 — `commandParser.ts`

**核心变化**：从「本地正则匹配」改为「AI 输出 `【code】` 标记 → 解析器提取」

#### 类型定义

```typescript
const CMD_START = '【code】'
const CMD_END = '【/code】'

export type CommandType =
  | 'open_site' | 'search' | 'site_search' | 'open_item'
  | 'page_next' | 'page_prev' | 'video_play' | 'video_pause'

export interface CommandInfo {
  type: CommandType
  params: string
}

export interface SingleParseResult {
  success: boolean
  command?: CommandInfo
  error?: string
}

export interface BatchParseResult {
  total: number
  commandList: CommandInfo[]
  hasError: boolean
  errorMsg?: string
  plainText?: string
}
```

#### 批量解析器完整实现

```typescript
import { Logger } from '@/src/utils/logger'
const log = new Logger('CommandParser')

export function parseBatchCommand(rawText: string): BatchParseResult {
  log.info('开始批量解析指令', { rawText })

  const result: BatchParseResult = {
    total: 0,
    commandList: [],
    hasError: false,
  }

  // 1. 按 CMD_END 分割，提取所有指令块
  const cmdBlocks = rawText.split(CMD_END).filter(blk => blk.includes(CMD_START))

  // 无指令标记 = 纯对话文本
  if (cmdBlocks.length === 0) {
    result.plainText = rawText.trim()
    log.info('未识别指令，判定为纯对话')
    return result
  }

  // 2. 逐条解析，保留顺序
  for (const block of cmdBlocks) {
    const startIdx = block.indexOf(CMD_START)
    const cmdContent = block.slice(startIdx + CMD_START.length).trim()
    const singleRes = parseSingleCmd(cmdContent)

    if (!singleRes.success) {
      result.hasError = true
      result.errorMsg = singleRes.error
      log.error('单条指令解析失败', singleRes.error)
      continue
    }

    if (singleRes.command) {
      result.commandList.push(singleRes.command)
      result.total++
    }
  }

  log.info('批量解析完成', { total: result.total, hasError: result.hasError })
  return result
}
```

#### 单条指令解析

```typescript
const VALID_TYPES: CommandType[] = [
  'open_site', 'search', 'site_search', 'open_item',
  'page_next', 'page_prev', 'video_play', 'video_pause',
]

const NO_PARAM_CMDS: CommandType[] = ['page_next', 'page_prev', 'video_play', 'video_pause']

function parseSingleCmd(cmdContent: string): SingleParseResult {
  const content = cmdContent.trim()
  if (!content) return { success: false, error: '指令内容为空' }

  const [type, ...paramArr] = content.split(':')
  const params = paramArr.join(':').trim()

  // 验证指令类型
  if (!VALID_TYPES.includes(type as CommandType)) {
    return { success: false, error: `非法指令类型：${type}` }
  }

  // 验证参数（无参指令不需要参数）
  if (!NO_PARAM_CMDS.includes(type as CommandType) && !params) {
    return { success: false, error: `指令 ${type} 缺少必填参数` }
  }

  return { success: true, command: { type: type as CommandType, params } }
}
```

**不需要 SITE_MAP**：AI 会自动识别中文站名并输出完整 URL（如 "打开B站" → `open_site:https://www.bilibili.com`），解析器只做格式验证。

#### 解析流程图

```
AI 输出文本
    │
    ↓
按【/code】分割
    │
    ├── 无【code】标记 → 返回 plainText（纯对话）
    │
    ↓
逐条提取指令内容
    │
    ├── 指令类型合法? ──No──→ 记录错误，继续下一条
    │       │
    │      Yes
    │       │
    │       ↓
    ├── 需要参数? ──Yes──→ 参数存在? ──No──→ 记录错误
    │       │                    │
    │      No                   Yes
    │       │                    │
    │       ↓                    ↓
    └── 加入 commandList（保留顺序）
            │
            ↓
        返回 BatchParseResult
```

---

### 4.3 AI 调用层重构 — `session.ts`

#### 系统 Prompt

```
你是浏览器语音指令助手，根据用户语音、当前页面信息生成可执行指令。

严格遵守以下规则：
1. 所有可执行指令必须使用【code】和【/code】包裹，多条指令分行书写，严格按照用户语音语义顺序排列。
2. 单条指令格式：指令类型:参数；无参指令直接写指令类型。
3. 支持的指令类型：
   open_site:网址        打开指定网站（如 open_site:https://www.bilibili.com）
   search:关键词          全网搜索（如 search:手机）
   site_search:关键词     站内搜索（如 site_search:vue视频）
   open_item:序号         点击页面上第N个链接/结果（如 open_item:3，参数为数字序号）
   page_next              下一页
   page_prev              上一页
   video_play             播放视频
   video_pause            暂停视频
4. 若用户同时说出多个操作，必须逐条分行输出，不可合并、不可打乱顺序。
5. open_site 参数必须是完整 URL（https://开头），不可使用中文别名。
6. open_item 参数必须是数字序号，表示页面上第几个可点击元素。
7. 若语音属于闲聊对话，直接输出简短口语回复（100字内，无Markdown、无代码块）。
8. 仅输出指令或对话，禁止多余解释、注释。
```

#### 请求构建

```typescript
// 携带最近 3 轮上下文 + 清洗后页面 HTML
const recentContext = recentVoiceMsgs.slice(-3).map(m => {
  const label = m.role === 'user' ? '用户' : '执行结果'
  return `${label}: ${m.content}`
}).join('\n')

const llmMessages: ChatMessage[] = [
  {
    id: 'system',
    role: 'system',
    content: COMMAND_SYSTEM_PROMPT,
    timestamp: Date.now(),
  },
  {
    id: Date.now().toString(),
    role: 'user',
    content: [
      recentContext ? `历史对话:\n${recentContext}` : '',
      `当前用户语音: "${text}"`,
      `当前页面URL: ${pageUrl}`,
      `页面HTML:\n${cleanedHTML}`,
    ].filter(Boolean).join('\n\n'),
    timestamp: Date.now(),
  },
]
```

#### AI 请求数据流

```
用户语音: "搜索vue视频"
        │
        ↓
┌─────────────────────────────────────┐
│ 构建 AI 请求                         │
│                                     │
│ [system] 指令格式 Prompt             │
│ [user]   历史对话:                   │
│            用户: 打开B站             │
│            执行结果: 已打开bilibili   │
│                                     │
│          当前用户语音: "搜索vue视频"  │
│          当前页面URL: bilibili.com   │
│          页面HTML: <清洗后DOM结构>   │
└──────────────┬──────────────────────┘
               │
               ↓
        adapter.chat()
        (OpenAI/Qwen/Wenxin)
               │
               ↓
        AI 输出:
        【code】site_search:vue视频【/code】
               │
               ↓
        parseBatchCommand()
               │
               ↓
        CommandInfo { type: 'site_search', params: 'vue视频' }
```

#### 页面上下文获取（含错误处理）

```typescript
async function getPageContext(): Promise<{ url: string; html: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      log.warn('无法获取当前标签页')
      return { url: '', html: '' }
    }

    // 跳过特殊页面（chrome://、edge:// 等不允许注入脚本）
    const url = tab.url || ''
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
      log.warn('特殊页面，跳过 HTML 获取', { url })
      return { url, html: '' }
    }

    // 注入脚本：清洗 HTML（去 script/style/hidden/注释），保留完整 DOM 结构
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement
        // 删除无用标签：JS 代码、CSS 样式、noscript、样式表链接、meta 标签
        clone.querySelectorAll('script, style, noscript, link[rel="stylesheet"], meta')
          .forEach(el => el.remove())
        // 删除隐藏元素
        clone.querySelectorAll('[hidden]')
          .forEach(el => el.remove())
        // 清除内联样式（保留 class 名用于结构识别）
        clone.querySelectorAll('[style]')
          .forEach(el => el.removeAttribute('style'))
        return clone.innerHTML
      },
    })

    return { url, html: results[0]?.result || '' }
  } catch (error) {
    log.error('获取页面上下文失败', error)
    return { url: '', html: '' }
  }
}
```

#### HTML 清洗策略

```
原始 HTML (200KB-1MB)
    │
    ↓ 清洗
┌─────────────────────────────┐
│ 去除:                        │
│   <script> JS 代码           │
│   <style> CSS 样式           │
│   <noscript> 降级提示        │
│   <link rel="stylesheet">   │
│   <meta> 元信息              │
│   [hidden] 隐藏元素          │
│   [style] 内联样式属性       │
│   HTML 注释                  │
│                              │
│ 保留:                        │
│   完整 DOM 结构              │
│   链接 href                  │
│   按钮文字                   │
│   表单元素                   │
│   视频/音频标签              │
│   class 名（结构识别）       │
│   data-* 属性               │
└──────────────┬──────────────┘
               │
               ↓
清洗后 HTML (15-60KB)
比原始 HTML 小 5-10 倍，不截断全量发送
```

#### 重试机制

```typescript
const MAX_RETRY = 3

async function processWithRetry(text: string, pageUrl: string, cleanedHTML: string) {
  let lastAIOutput = ''
  let lastError = ''

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    // 构建请求消息（重试时附加错误详情）
    const userContent = buildUserContent(text, pageUrl, cleanedHTML, lastAIOutput, lastError, attempt)
    const aiOutput = await callAI(userContent)

    if (!aiOutput) {
      lastError = 'AI 未返回有效回复'
      continue
    }

    lastAIOutput = aiOutput

    // 解析指令
    const parseResult = parseBatchCommand(aiOutput)

    // 解析成功 → 返回指令列表
    if (!parseResult.hasError && parseResult.commandList.length > 0) {
      return { type: 'commands', commands: parseResult.commandList }
    }

    // 纯对话 → 返回对话文本
    if (parseResult.plainText && parseResult.commandList.length === 0) {
      return { type: 'chat', text: parseResult.plainText }
    }

    // 解析失败 → 准备重试
    lastError = parseResult.errorMsg || '未解析出有效指令'
    log.warn(`解析失败，重试 ${attempt + 1}/${MAX_RETRY}`, { lastError })
  }

  // 超过重试上限
  return { type: 'error', message: '指令解析失败，请重新下达指令' }
}

function buildUserContent(
  text: string, pageUrl: string, cleanedHTML: string,
  lastAIOutput: string, lastError: string, attempt: number
): string {
  const parts = [
    `用户语音: "${text}"`,
    `当前页面URL: ${pageUrl}`,
    `页面HTML:\n${cleanedHTML}`,
  ]

  // 重试时附加错误详情，让 AI 自我修正
  if (attempt > 0 && lastAIOutput) {
    parts.push(`你上一次的回复:\n${lastAIOutput}`)
    parts.push(`解析错误: ${lastError}`)
    parts.push('请根据错误信息修正指令格式，重新输出。')
  }

  return parts.join('\n\n')
}
```

#### 重试流程图

```
用户语音 + 页面HTML
        │
        ↓
    第 1 次 AI 请求
        │
        ↓
    parseBatchCommand()
        │
        ├── 成功 → 执行指令
        │
        └── 失败 → 记录错误
                      │
                      ↓
                第 2 次 AI 请求
                (附加: AI上次输出 + 错误原因)
                      │
                      ↓
                parseBatchCommand()
                      │
                      ├── 成功 → 执行指令
                      │
                      └── 失败 → 记录错误
                                    │
                                    ↓
                              第 3 次 AI 请求
                              (附加: AI上次输出 + 错误原因)
                                    │
                                    ↓
                              parseBatchCommand()
                                    │
                                    ├── 成功 → 执行指令
                                    │
                                    └── 失败 → TTS("指令解析失败")
```

#### 多指令串行执行

```typescript
async function executeCommandList(commands: CommandInfo[]): Promise<void> {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]
    log.info(`执行第 ${i + 1}/${commands.length} 条指令`, { type: cmd.type, params: cmd.params })

    try {
      const result = await this.options.executeAutomation(cmd.type, { [getParamKey(cmd.type)]: cmd.params })
      log.info(`第 ${i + 1} 条指令执行完成`, { success: result.success })

      // 执行失败时记录但继续执行后续指令（容错）
      if (!result.success) {
        log.warn(`第 ${i + 1} 条指令执行失败: ${result.message}`)
      }
    } catch (error) {
      log.error(`第 ${i + 1} 条指令执行异常`, error)
      // 继续执行后续指令，不中断
    }
  }
}

function getParamKey(action: CommandType): string {
  switch (action) {
    case 'open_site': return 'url'
    case 'search':
    case 'site_search': return 'keyword'
    case 'open_item': return 'index'
    default: return 'params'
  }
}
```

#### 多指令执行流程图

```
AI 输出:
【code】open_site:https://www.bilibili.com【/code】
【code】site_search:vue视频【/code】
【code】video_play【/code】
        │
        ↓
parseBatchCommand()
        │
        ↓
CommandInfo[] = [
  { type: 'open_site', params: 'https://www.bilibili.com' },
  { type: 'site_search', params: 'vue视频' },
  { type: 'video_play', params: '' }
]
        │
        ↓
串行执行 (for...of + await)
        │
        ├── 第1条: open_site → chrome.tabs.sendMessage → content script → window.open
        │         ✅ 成功，继续
        │
        ├── 第2条: site_search → chrome.tabs.sendMessage → content script → 填入搜索框+回车
        │         ✅ 成功，继续
        │
        └── 第3条: video_play → chrome.tabs.sendMessage → content script → video.play()
                  ✅ 成功，全部完成
                          │
                          ↓
                    自动回到 IDLE
```

---

### 4.4 TTS 播报精简

#### 播报规则

| 场景 | 播报内容 | 是否播报 |
|------|---------|---------|
| 初始启动 / 轮次就绪 | "请说出指令" | ✅ 播报 |
| 识别失败 / 无语音 | "没有检测到语音，请再说一次" | ✅ 播报 |
| 解析失败（重试超限） | "指令解析失败，请重新下达指令" | ✅ 播报 |
| AI 返回纯对话 | 直接播报 AI 对话内容 | ✅ 播报 |
| **合法指令执行** | — | ❌ **静默** |
| **指令执行结果** | — | ❌ **静默** |

#### VoiceBroadcast 类（不变）

```typescript
class VoiceBroadcast {
  speak(text: string): Promise<void>  // 播报文字
  cancel(): void                       // 取消当前播报
  destroy(): void                      // 销毁
  onEnd: (() => void) | null           // 播报完成回调（触发下一轮监听）
  onStart: (() => void) | null         // 播报开始回调
}
```

使用浏览器原生 **SpeechSynthesis API**，无需安装任何依赖。

---

### 4.5 状态机简化

#### 当前 5 状态 → 新 4 状态

| 状态 | 含义 | UI 表现 |
|------|------|---------|
| `IDLE` | 常驻等待指令 | 麦克风默认样式 |
| `LISTENING` | 聆听中 | 麦克风激活 + 波纹动画 |
| `PROCESSING` | AI 分析 + 解析 + 执行 | 处理中加载动画 |
| `SPEAKING` | 播报中（仅系统/错误/闲聊） | 播报状态文字 |

**移除 `EVALUATING`** — 不再评估置信度。

#### 状态流转图

```
                ┌──────────────────────────────────┐
                │                                  │
                ↓                                  │
         ┌──────────┐                              │
         │   IDLE   │                              │
         │ 常驻等待  │                              │
         └────┬─────┘                              │
              │ 用户点击麦克风                       │
              ↓                                    │
         ┌──────────┐                              │
         │LISTENING │                              │
         │ 聆听中    │                              │
         └────┬─────┘                              │
              │                                    │
          ┌───┴───┐                                │
          │       │                                │
      识别失败  识别成功                             │
          │       │                                │
          ↓       ↓                                │
    ┌─────────┐ ┌──────────┐                       │
    │SPEAKING │ │PROCESSING│                       │
    │"请再说" │ │ 处理中    │                       │
    └────┬────┘ └────┬─────┘                       │
         │           │                             │
         │     ┌─────┼─────┐                       │
         │     │     │     │                       │
         │   纯对话 解析成功 解析失败                │
         │     │     │     │                       │
         │     ↓     ↓     ↓                       │
         │  SPEAKING 执行  重试(≤3次)               │
         │  (播报)  (静默)  │                       │
         │     │     │     ├── 成功 → 执行          │
         │     │     │     └── 超限 → SPEAKING     │
         │     │     │            ("解析失败")      │
         │     │     │              │               │
         └─────┴─────┴──────────────┴───────────────┘
                    自动回到 IDLE
```

---

### 4.6 VoicePanel UI 变化

| 组件 | 变化 |
|------|------|
| 连续模式开关 | ❌ 移除（常驻等待，无需开关） |
| `evaluating` 状态点 | ❌ 移除 |
| 消息记录区 | ✅ 保留（显示识别文字 + AI 对话 + 操作记录） |
| 麦克风按钮 + 波纹 | ✅ 保留不变 |
| 清空按钮 | ✅ 保留 |

---

### 4.7 voice.ts Store 变化

```typescript
// 移除
confidence: ref(0)           // 不需要（无置信度）
continuousMode: ref(true)    // 不需要（永远常驻）
toggleContinuousMode()       // 不需要

// SessionState 简化
type SessionState = 'idle' | 'listening' | 'processing' | 'speaking'
// 移除 'evaluating'
```

---

### 4.8 全局日志系统 — `src/utils/logger.ts`

#### Logger 类（已实现）

```typescript
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

class Logger {
  constructor(module: string)
  debug(...args: unknown[]): void   // 灰色
  info(...args: unknown[]): void    // 蓝色
  warn(...args: unknown[]): void    // 黄色
  error(...args: unknown[]): void   // 红色
}

// 使用方式
const log = new Logger('Voice')
log.info('识别完成', { text, confidence })
log.error('请求失败', error)
```

#### 输出格式

```
[14:32:05] [INFO] [CommandParser] 开始批量解析指令
[14:32:06] [INFO] [CommandParser] 批量解析完成 { total: 2, hasError: false }
[14:32:07] [INFO] [Session] 执行第 1/2 条指令 { type: "open_site", params: "https://www.bilibili.com" }
[14:32:08] [INFO] [Session] 第 1 条指令执行完成 { success: true }
[14:32:09] [INFO] [Session] 执行第 2/2 条指令 { type: "site_search", params: "vue视频" }
[14:32:10] [INFO] [Session] 第 2 条指令执行完成 { success: true }
[14:32:11] [INFO] [Session] 本轮会话结束，自动回到等待指令状态
```

#### 各模块日志点

| 模块 | 关键日志点 |
|------|-----------|
| `CommandParser` | 批量解析开始、每条指令内容、解析错误、解析完成（总条数） |
| `VoiceSession` | 会话启动/停止、状态转换、AI 请求发起/响应、重试次数/超限、多指令执行顺序、每条指令开始/完成/失败、会话结束回到 IDLE |
| `VoiceRecognition` | 启动、识别结果（文本）、错误、重启、停止 |
| `VoiceBroadcast` | 开始播报、播报完成、播报取消 |
| `adapters/*` | 请求发起、URL/model、响应状态、错误详情、耗时 |
| `automation/actions` | 执行动作、参数、成功/失败、DOM 选择器命中 |
| `VoicePanel` | 初始化会话、toggle、清空对话 |

---

## 五、实施方案（分 4 步）

### Step 1: 重构 `commandParser.ts` — 批量解析器
- 移除 `parseVoiceCommand()` 的本地正则逻辑（删除 `SITE_MAP`、`CN_NUM_MAP`、所有 regex 匹配）
- 新增 `parseBatchCommand()` + `parseSingleCmd()` 完整实现
- 不需要 SITE_MAP，AI 自动输出完整 URL
- 类型定义：`CommandInfo`, `BatchParseResult`, `SingleParseResult`, `CommandType`
- Logger 埋点：解析开始、每条指令、错误、完成

### Step 2: 重构 `session.ts` — 核心流程
- 移除置信度评估逻辑（`evaluateConfidence`、`CONFIDENCE_HIGH`、`CONFIDENCE_MEDIUM`）
- 新增系统 Prompt（指令格式约束 + 参数规范）
- 改造 `sendToAI()` → `processWithRetry()`：最近 3 轮上下文 + 页面 URL + 清洗后 HTML
- 新增 `getPageContext()` 含错误处理（特殊页面、tab 获取失败）
- 新增 `buildUserContent()` 构建重试请求（重试时附加错误详情）
- 新增 `executeCommandList()` 多指令串行执行（失败不中断）
- 改造 `executeAutomation()`：静默执行，不播报
- 会话结束自动回到 IDLE
- Logger 埋点：重试次数、多指令执行顺序、每条指令结果

### Step 3: 清理 `voice.ts` + `VoicePanel.vue`
- `voice.ts`：移除 `confidence`、`continuousMode`、`evaluating` 状态
- `VoicePanel.vue`：移除连续模式开关、evaluating 状态显示

### Step 4: 补充日志埋点
- 批量解析：指令总条数、每条内容、解析错误
- 多指令执行：执行顺序、单条开始/完成/失败
- 重试流程：当前次数、超限终止
- 页面上下文获取：成功/失败/特殊页面跳过

---

## 六、Acceptance Criteria

- [ ] 移除置信度判断与相关代码（`evaluating` 状态、`confidence` 字段）
- [ ] AI 输出的 `【code】` 指令被正确解析为 `CommandInfo[]`
- [ ] 多条指令按顺序串行执行，单条失败不中断后续
- [ ] 合法指令执行全程静默，无 TTS 播报
- [ ] 识别失败、解析错误、闲聊对话正常触发 TTS
- [ ] 每次 AI 请求携带最近 3 轮上下文 + 页面 URL + 清洗后完整 HTML
- [ ] 解析失败自动重试（携带错误详情），3 次上限生效
- [ ] 特殊页面（chrome:// 等）跳过 HTML 获取，不报错
- [ ] 单轮会话结束后自动回到 IDLE 等待状态
- [ ] 移除连续模式开关 UI
- [ ] Logger 覆盖所有新流程节点
- [ ] `npm run dev` 无报错，TypeScript 类型检查通过

## 七、Definition of Done

- 所有改动文件 TypeScript 类型检查通过
- Logger 在关键路径有日志输出
- 无遗留的置信度/连续模式代码

## 八、Out of Scope

- Firefox 适配
- 移动端浏览器
- 离线语音识别
- 语音唤醒词
- 第三方模型/语音服务商适配（讯飞、Ollama）

## 九、Technical Notes

- `【code】` 标记使用全角括号，系统 Prompt 中已明确格式
- 页面 HTML 使用清洗策略（去 script/style/hidden/注释），保留完整 DOM 结构，不截断全量发送
- 清洗后 HTML 大小通常 15-60KB（比原始 HTML 小 5-10 倍）
- `chrome.scripting.executeScript` 在 VoicePanel（content script context）中可用
- 多指令串行执行使用 `for...of` + `await`，不用 `Promise.all`（顺序重要）
- 多指令执行中单条失败不中断后续指令（容错）
- `VoiceBroadcast.onEnd` 回调驱动状态回到 IDLE 的链路需要仔细测试
- `VoiceRecognition` 的 `continuous` 选项保持 `true`，确保识别器不会在每次识别结束后停止
- `open_item` 参数为数字序号（第N个），不是名称
