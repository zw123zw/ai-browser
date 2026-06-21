---
name: test-suite
description: "扫描项目代码库，按模块生成独立测试文件，覆盖全部 30+ 模块的核心功能。支持全量测试和指定模块测试。"
---

# Test Suite — 全模块功能测试生成与执行

自动扫描项目代码、分析功能模块、按模块生成独立测试文件、执行测试并输出功能测试报告。

## 触发

- `/test-suite` — 完整流程（分析全部模块 → 生成测试 → 执行 → 报告）
- `/test-suite <模块名>` — 只测试指定模块（如 `/test-suite adapters`）
- `/test-suite --skip-generate` — 跳过生成，直接执行现有测试

---

## 执行流程

### Step 1: 检测运行模式

检查 `vitest.config.ts` 是否存在：

- **不存在** → 首次模式（Step 2 + Step 3 + Step 4 + Step 5）
- **存在** → 增量模式（Step 3 + Step 4 + Step 5，跳过 Step 2）

检查用户是否指定了模块名：
- **指定了** → 只处理该模块
- **未指定** → 处理全部模块

---

### Step 2: 基础设施搭建（仅首次）

#### 2.1 安装依赖

```bash
npm install -D vitest @vitest/coverage-v8 happy-dom
```

#### 2.2 创建 vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/types.ts',
        'src/themes.ts',
      ],
    },
  },
})
```

#### 2.3 创建 test/setup.ts

全局 chrome.* API mock，包含：
- `chrome.runtime`（sendMessage、onMessage、connect、id、getURL）
- `chrome.storage.local`（get、set、remove、clear）
- `chrome.storage.sync`（get、set、remove）
- `chrome.storage.onChanged`
- `chrome.tabs`（query、sendMessage、create、update、remove）
- `chrome.scripting`（executeScript）
- `chrome.action`（setBadgeText、setBadgeBackgroundColor、setIcon）
- `chrome.permissions`（request、contains）
- `SpeechRecognition` / `webkitSpeechRecognition`
- `speechSynthesis`
- `URL.createObjectURL` / `URL.revokeObjectURL`
- `matchMedia`

#### 2.4 确认 package.json 包含 test 脚本

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

---

### Step 3: 功能分析与测试生成

#### 3.1 确定目标模块

**首次模式**：扫描 `src/` 下所有目录，识别功能模块

**增量模式**：优先获取变更文件所属模块
```bash
git diff HEAD~1 --name-only -- "src/**/*.ts" 2>/dev/null | grep -v "\.test\.ts$" | grep -v "types\.ts"
```
如果 git diff 无结果（未 commit），退化为全量模式。

**用户指定了模块**：只处理该模块。

#### 3.2 读取源文件并分析

对每个目标模块，读取其所有 `.ts` 源文件（排除 `.test.ts`），分析：
- 导出的类、函数、常量
- 每个导出项的参数、返回值、副作用
- 依赖的其他模块（用于设计 mock）
- 可测试的业务场景

#### 3.3 按模块生成独立测试文件

**测试文件位置**：每个模块的测试放在 `src/<模块>/__tests__/` 目录下

```
src/
├── adapters/
│   └── __tests__/
│       ├── openai.test.ts
│       ├── gemini.test.ts
│       ├── qwen.test.ts
│       ├── wenxin.test.ts
│       ├── doubao.test.ts
│       ├── proxy.test.ts
│       └── factory.test.ts
├── automation/
│   └── __tests__/
│       ├── actions.test.ts
│       └── selectors.test.ts
├── browser/
│   ├── __tests__/
│   │   ├── action-executor.test.ts
│   │   ├── skeleton.test.ts          （已有，保留）
│   │   ├── skeleton-id.test.ts
│   │   ├── code-filter.test.ts
│   │   ├── translate-service.test.ts
│   │   ├── translate-popup.test.ts
│   │   ├── translate-click.test.ts
│   │   ├── translate-parser.test.ts
│   │   └── local-html.test.ts
│   └── skeleton.test.ts              （已有的独立文件，保留）
├── composables/
│   └── __tests__/
│       ├── usePipeline.test.ts
│       └── useToast.test.ts
├── input/
│   └── __tests__/
│       ├── router.test.ts
│       ├── tag-parser.test.ts
│       ├── intent-detector.test.ts
│       ├── pipeline.test.ts
│       └── prompts.test.ts
├── storage/
│   └── __tests__/
│       ├── storage-items.test.ts
│       └── input-history.test.ts
├── stores/
│   └── __tests__/
│       ├── settings.test.ts
│       ├── conversations.test.ts
│       └── voice.test.ts
├── utils/
│   └── __tests__/
│       ├── file-type.test.ts
│       ├── file-parsers.test.ts
│       ├── file-generators.test.ts
│       ├── file-tag-parser.test.ts
│       ├── echart-renderer.test.ts
│       ├── ocr.test.ts
│       ├── logger.test.ts
│       ├── log-storage.test.ts
│       ├── storage-sync.test.ts
│       ├── markdown.test.ts
│       ├── shortcut.test.ts
│       └── cache.test.ts
├── voice/
│   └── __tests__/
│       ├── commandParser.test.ts
│       ├── recognition.test.ts
│       ├── sherpa-recognition.test.ts
│       ├── broadcast.test.ts
│       └── session.test.ts
└── __tests__/
    └── functional-test.test.ts       （旧文件，保留兼容但不再更新）
```

#### 3.4 测试用例编写规范

**测试结构**：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 依赖（放在文件顶部）
vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('模块名', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('功能: XXX', () => {
    describe('正常场景', () => {
      it('应正确处理 XXX', () => {
        // Arrange - 准备
        // Act - 执行
        // Assert - 验证
      })
    })

    describe('异常场景', () => {
      it('应处理 XXX 错误', () => {
        // 验证错误处理
      })
    })

    describe('边界条件', () => {
      it('应处理空输入', () => {
        // 验证边界
      })
    })
  })
})
```

**Mock 策略**：

| 依赖类型 | Mock 方式 |
|---------|----------|
| chrome.* API | 全局 mock（test/setup.ts 已提供） |
| wxt/storage | `vi.mock('wxt/storage')` |
| 同项目模块 | `vi.mock('@/src/path/to/module')` |
| DOM 操作 | happy-dom 自动提供 |
| 网络请求 | `vi.fn()` mock fetch |
| AI 适配器 | mock `chat()` 返回预设流式数据 |
| Web Speech API | test/setup.ts 已提供基础 mock |
| AudioContext | `vi.fn()` mock |
| IntersectionObserver | `vi.fn()` mock |
| MutationObserver | `vi.fn()` mock |

**通用 Mock 工具函数**（放在 `test/helpers.ts` 中复用）：

```typescript
// test/helpers.ts
import { vi } from 'vitest'

/** 创建 mock StreamChunk 流 */
export function mockStreamChunks(chunks: any[]) {
  return vi.fn().mockImplementation(async (opts, onChunk) => {
    for (const chunk of chunks) {
      onChunk(chunk)
    }
  })
}

/** 创建 mock chrome.tabs.query 返回值 */
export function mockTabsQuery(tabs: any[]) {
  ;(chrome.tabs.query as any).mockResolvedValue(tabs)
}

/** 创建可见的 DOM 元素 */
export function createVisibleElement(tag: string, attrs: Record<string, string> = {}) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true })
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 10, left: 10, bottom: 30, right: 50,
    width: 40, height: 20, x: 10, y: 10,
    toJSON: () => {},
  })
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    display: 'block', visibility: 'visible', cursor: 'auto',
  } as CSSStyleDeclaration)
  return el
}
```

---

### Step 4: 执行测试

#### 4.1 全部测试

```bash
npx vitest run --reporter=json 2>/dev/null
```

#### 4.2 指定模块测试

```bash
# 只测 adapters 模块
npx vitest run src/adapters/ --reporter=json 2>/dev/null

# 只测 browser 模块
npx vitest run src/browser/ --reporter=json 2>/dev/null
```

捕获 JSON 输出，解析测试结果。

如果测试执行失败（编译错误等），分析错误原因并修复测试代码后重试。最多重试 2 次。

---

### Step 5: 生成功能测试报告

将报告写入 `docs/functional-test-report.md`，格式如下：

```markdown
# 功能测试报告

> 生成时间：YYYY-MM-DD HH:mm:ss
> 运行模式：首次 / 增量
> 变更模块：（增量模式下列出）

## 📊 测试摘要

| 指标 | 值 |
|------|-----|
| 总模块数 | N |
| 总用例数 | N |
| 通过 | N ✅ |
| 失败 | N ❌ |
| 通过率 | XX% |
| 执行耗时 | Xs |

---

## 📁 模块测试详情

### ✅ src/adapters/ — AI 适配器

| 测试文件 | 用例数 | 通过 | 失败 |
|---------|--------|------|------|
| factory.test.ts | 8 | 8 | 0 |
| openai.test.ts | 12 | 12 | 0 |
| gemini.test.ts | 10 | 10 | 0 |

### ✅ src/browser/ — 浏览器命令引擎

| 测试文件 | 用例数 | 通过 | 失败 |
|---------|--------|------|------|
| action-executor.test.ts | 20 | 20 | 0 |
| skeleton.test.ts | 25 | 25 | 0 |
| code-filter.test.ts | 8 | 8 | 0 |

...

---

## 📋 测试覆盖矩阵

| 模块 | 测试文件数 | 用例数 | 覆盖功能 |
|------|-----------|--------|---------|
| adapters | 5 | 45 | 工厂创建、5 个适配器 chat()、SSE 解析、代理 |
| automation | 2 | 15 | 8 种操作、选择器适配 |
| browser | 8 | 80 | 16 种 action、骨架提取、代码过滤、翻译 |
| composables | 2 | 12 | 管线集成、Toast 通知 |
| input | 5 | 40 | 路由、标签解析、意图检测、管线、提示词 |
| storage | 2 | 10 | 存储项定义、输入历史 |
| stores | 3 | 20 | 设置、会话、语音状态 |
| utils | 10 | 50 | 文件解析/生成/OCR、日志、缓存 |
| voice | 5 | 25 | 命令解析、识别、合成、会话 |
| **总计** | **42** | **297** | |

---

## ✅ 测试结论

（总结测试结果，列出已验证的功能点和发现的问题）
```

---

## 各模块测试内容清单

以下是每个模块需要测试的功能点。生成测试时必须覆盖以下所有条目。

### adapters/ — AI 适配器

#### factory.test.ts — 工厂模式
- 创建全部 11 种 Provider 的适配器
- 未知 Provider 降级到 OpenAI 兼容

#### openai.test.ts — OpenAI 适配器
- 构造函数：设置 name、baseUrl
- chat()：发送请求、解析 SSE 流式响应
- chat()：处理 reasoning/thinking delta（Anthropic 协议）
- chat()：处理 content delta（OpenAI 协议）
- chat()：AbortSignal 中止
- chat()：API 错误处理（401、429、500）
- chat()：空响应处理
- parseSSE()：正常 SSE 行解析
- parseSSE()：多行 data 合并
- parseSSE()：[DONE] 结束标记
- parseSSE()：格式错误容错

#### gemini.test.ts — Gemini 适配器
- chat()：systemInstruction 格式
- chat()：candidates[0].content.parts 响应解析
- chat()：thinking model（part.thought）处理
- chat()：x-goog-api-key 认证头

#### qwen.test.ts — 通义千问适配器
- chat()：DashScope API 路径
- chat()：input.system 独立字段
- chat()：响应格式解析

#### wenxin.test.ts — 文心一言适配器
- chat()：/chat/completions 端点
- chat()：result 字段解析
- chat()：is_end 完成检测

#### doubao.test.ts — 豆包适配器
- chat()：OpenAI 兼容格式
- chat()：/chat/completions 端点

#### proxy.test.ts — 代理请求
- proxyFetch()：非流式请求通过 background 中转
- proxyFetchStream()：流式请求、requestId chunk 转发
- proxyFetchStream()：AbortSignal 取消
- proxyFetchStream()：错误处理

---

### automation/ — 语音自动化

#### actions.test.ts — 自动化操作
- executeAutomationAction('open_site')：打开 URL
- executeAutomationAction('search')：百度搜索
- executeAutomationAction('site_search')：站内搜索
- executeAutomationAction('open_item')：点击第 N 个结果
- executeAutomationAction('page_next')：翻下一页
- executeAutomationAction('page_prev')：翻上一页
- executeAutomationAction('video_play')：播放视频
- executeAutomationAction('video_pause')：暂停视频
- 未知 action 处理

#### selectors.test.ts — 选择器适配
- findElement()：在百度页面找到搜索框
- findElement()：在 Google 页面找到搜索框
- findElement()：在通用页面找到搜索框
- findElements()：找到多个搜索结果
- 选择器降级：主选择器失败时尝试备选

---

### browser/ — 浏览器命令引擎

#### action-executor.test.ts — 命令执行
- click：通过 elementId 定位
- click：通过 fallbackSelector（CSS 选择器）定位
- click：通过 text 文本匹配定位
- click：元素未找到 → 返回失败
- click：label 点击转发到关联表单元素
- click：完整鼠标事件序列（mousedown → focus → mouseup → click）
- type：输入文本到 input
- type：使用 native value setter（绕过 React/Vue）
- type：自动聚焦目标元素
- clear：清空 input 值
- scroll：向上/下/左/右滚动
- scroll：指定滚动距离
- navigate：通过 background tab-action 打开
- select：选中下拉选项
- keyboard：映射 key 名到 KeyboardEvent.code
- keyboard：Enter 键触发表单提交
- focus：聚焦元素
- hover：悬停事件序列
- wait：延迟指定毫秒
- newTab：创建新标签页（有/无 URL）
- closeTab：关闭当前标签页
- switchTab：按关键词匹配标签页
- switchTab：站点别名（bilibili → bilibili.com）
- nextTab / prevTab：相对切换
- video play/pause：播放/暂停
- video volume：设置音量 0-1
- video mute/unmute：静音切换
- video seek：跳转到指定时间
- video jump：相对跳转（正/负）
- video speed：设置播放速率
- video fullscreen：切换全屏
- 未知 action：返回失败

#### skeleton.test.ts — 骨架提取（已有，补充）
- 提取 button/a/input/select/textarea 元素
- 提取 cursor:pointer 元素
- 提取 role=button 元素
- 提取 contenteditable 元素
- 过滤不可见元素（display:none、visibility:hidden）
- 过滤视口外元素（viewport 模式）
- 包含视口外元素（full 模式）
- viewport 模式限制 200 元素
- 提取 role=alert 的页面提示
- 提取 aria-live 区域
- 检测 dialog[open] 弹窗
- 检测 ARIA modal 弹窗
- 检测框架弹窗（Bootstrap/Element UI/Ant Design）
- 同源 iframe 支持
- 父子去重
- 返回 URL/title/viewport/scroll/focusedElement/loading

#### skeleton-id.test.ts — 骨架 ID 管理
- ensureSkeletonId()：为新元素分配 data-skeleton-id
- ensureSkeletonId()：已有的不重复分配
- ensureAllSkeletonIds()：批量分配
- initAllSkeletonIds()：页面初始化

#### code-filter.test.ts — 代码过滤
- Layer 1：过滤 pre/code/samp 标签
- Layer 2：过滤 hljs/language-*/code-block 等类名
- Layer 3：过滤行内代码（反引号、URL、JSON、函数调用等）
- filterCodeText()：替换代码为 {{code_N}} 占位符
- restorePlaceholders()：恢复占位符为原始代码
- 无代码文本：不修改

#### translate-service.test.ts — 翻译服务
- translateSelection()：单文本翻译
- translateVisible()：批量可见区域翻译
- 文本去重：相同文本不重复翻译
- 200ms 防抖队列
- restoreAll()：恢复所有翻译
- abort()：取消进行中的翻译
- reset()：重置状态

#### translate-popup.test.ts — 翻译弹窗
- showTranslateLoading()：显示加载状态
- updateTranslateResult()：显示翻译结果
- updateTranslateError()：显示错误
- hideTranslatePopup()：隐藏弹窗
- 定位：跟随选中区域

#### translate-click.test.ts — 点击翻译
- initClickTranslate()：初始化
- 点击文本块 → 找到语义父元素（p/h1-h6/li/td）
- 显示翻译结果在段落下方
- 再次点击 → 切换显示/隐藏
- WeakMap 缓存

#### translate-parser.test.ts — 翻译响应解析
- parseTranslateResponse()：直接 JSON 解析
- parseTranslateResponse()：正则提取 JSON（降级 1）
- parseTranslateResponse()：逐行解析（降级 2）
- parseSingleTranslation()：单条翻译解析

#### local-html.test.ts — 全页骨架
- extractFullPageSkeleton()：返回 JSON 字符串
- 包含所有可交互元素

---

### composables/ — Vue 组合式函数

#### usePipeline.test.ts — 管线集成
- processInput()：正常处理流程
- processInput()：流式消息回调
- processInput()：命令执行回调
- processInput()：错误处理回调
- processInput()：need_input 暂停等待
- resumeQueuedTask()：跨标签页任务恢复
- executeCommand()：单命令执行
- abort()：取消当前管线
- provideInput()：提供用户输入
- isProcessing 状态切换
- waitingInputPrompt 状态切换

#### useToast.test.ts — Toast 通知
- info()：显示 info 通知
- success()：显示成功通知
- warning()：显示警告通知
- error()：显示错误通知
- 自动消失（默认 3000ms）
- dismiss()：手动关闭

---

### input/ — 输入系统

#### router.test.ts — 输入路由
- /stop → builtin stop
- /pause → builtin pause
- /resume → builtin resume
- /list → builtin list
- /help → builtin help
- /unknown → builtin unknown
- 普通文本 → ai
- 带空格文本 → ai（trim 处理）
- 空字符串 → ai

#### tag-parser.test.ts — 标签解析
- 提取单条 [command] 标签
- 提取多条 [command] 标签
- 从自然语言中提取 [command]
- 检测 [action] 标签
- 检测 [need_full] 标签
- 提取 [need_input] 标签（含 message/type）
- 提取 [FILE:xxx] 标签
- 提取 [chat] 标签
- isChatOnlyReply()：纯聊天判断
- getChatText()：获取聊天文本
- 无效 JSON 容错

#### intent-detector.test.ts — 意图检测
- detectPhase1()：返回 chat 回复
- detectPhase1()：返回 [command] 快速通道
- detectPhase1()：返回 [action] 进入 Phase 2
- detectPhase1()：返回 [FILE] 文件生成
- detectPhase1()：历史上下文包含（最近 6 条）
- detectPhase2()：返回 [command] 执行命令
- detectPhase2()：返回 [need_full] 请求全页骨架
- detectPhase2()：返回 [need_input] 请求用户输入
- 流式 onChunk 回调

#### pipeline.test.ts — 管线执行
- process()：路由 → Phase 1 → 聊天回复
- process()：路由 → Phase 1 → [command] 快速执行
- process()：路由 → Phase 1 → [action] → Phase 2 → 执行
- processPhase2WithRetry()：流式循环执行
- processPhase2WithRetry()：[need_full] 全页骨架请求
- processPhase2WithRetry()：[need_input] 暂停等待
- processPhase2WithRetry()：最大 20 步限制
- processPhase2WithRetry()：命令去重
- processPhase2WithRetry()：错误重试（最多 3 次）
- resumeQueuedTask()：跨标签页任务恢复
- 历史上下文传递

#### prompts.test.ts — 提示词
- CAPABILITY_DOMAIN_LIST：完整性（16 项）
- CAPABILITY_DOMAIN_LIST：needSkeleton 标记正确
- PHASE1_SYSTEM_PROMPT：包含四种输出格式
- PHASE1_SYSTEM_PROMPT：包含网站映射规则
- PHASE2_SYSTEM_PROMPT：包含三种输出格式
- PHASE2_SYSTEM_PROMPT：包含 done 字段说明
- MODE_FIRST/MODE_STREAMING/MODE_RETRY：内容正确
- buildPhase2UserMessage()：包含骨架和请求
- buildStreamingUserMessage()：包含已完成步骤
- buildStreamingUserMessage()：包含错误信息
- buildSelectionTranslateMessage()：翻译消息格式
- buildAutoTranslateMessage()：自动翻译消息格式

---

### storage/ — 存储

#### storage-items.test.ts — 存储项定义
- settingsStorage：默认值正确
- conversationStorage：默认值 null
- fabPosStorage：默认值
- drawerOpenStorage：默认值
- inputHistoryStorage：默认值
- queuedTaskStorage：默认值

#### input-history.test.ts — 输入历史
- pushInputHistory()：追加记录
- pushInputHistory()：连续去重（相同文本不重复）
- pushInputHistory()：最大 100 条限制

---

### stores/ — Pinia 状态管理

#### settings.test.ts — 设置 Store
- init()：从 chrome.storage 加载
- init()：加载失败时使用默认值
- update()：合并并持久化
- mergeSettings()：确保 models 数组有效
- mergeSettings()：确保 defaultModelId 存在
- 跨标签页同步（defineStorageSync）

#### conversations.test.ts — 会话 Store
- init()：从 storage 加载
- init()：清理过期的 streaming 消息
- send()：流式 AI 对话
- send()：附件传递
- send()：reasoningEnabled 传递
- clearCurrent()：清空消息和上下文
- resetConversation()：完全重置
- deleteMessage()：删除单条消息
- abort()：取消当前流

#### voice.test.ts — 语音 Store
- setStatus()：设置语音状态
- setSessionState()：设置会话状态
- updateText()：更新 interim/final 文本
- addUserMessage()：添加用户消息
- addAssistantMessage()：添加助手消息
- addSystemMessage()：添加系统消息
- clearMessages()：清空消息
- setProcessing()：设置处理状态
- setSpeaking()：设置播报状态

---

### utils/ — 工具函数

#### file-type.test.ts — 文件类型检测（已有，补充）
- detectFileType()：全部 AttachmentType 覆盖
- getExtension()：各种扩展名
- getCodeLang()：60+ 语言映射
- getFileTypeIcon()：全部类型图标
- formatFileSize()：B/KB/MB/GB

#### file-parsers.test.ts — 文件解析
- parseFile()：图片文件 → dataURL
- parseFile()：文本文件 → 直接读取
- parseFile()：代码文件 → 语法语言检测
- parseFile()：PDF 文件 → pdfjs-dist 提取
- parseFile()：Word 文件 → mammoth 转 HTML
- parseFile()：Excel 文件 → xlsx 解析
- parseFile()：二进制文件 → 文本降级
- parseFile()：超大文件拒绝（image 20MB、binary 10MB、text 2MB）
- ocrAttachment()：异步 OCR

#### file-generators.test.ts — 文件生成
- generateXlsx()：数据 → Excel
- generateXlsxFromCsv()：CSV → Excel
- generateDocx()：生成 Word
- generatePdf()：html2canvas + jsPDF
- generatePdfFromMarkdown()：Markdown → PDF
- triggerDownload()：触发下载
- formatBytes()：格式化字节
- formatJson()：格式化 JSON

#### file-tag-parser.test.ts — 文件标签解析
- parseFileTags()：解析 [FILE:type:name] 标签
- hasFileTags()：检测文件标签
- generateFileCardHtml()：生成文件卡片 HTML
- downloadParsedFile()：text/data/excel/json/pdf/chart 下载
- downloadChartAsPng()：图表转 PNG

#### echart-renderer.test.ts — ECharts 渲染
- loadECharts()：动态加载
- renderChartToCanvas()：渲染到 Canvas
- renderChartToBlob()：渲染到 Blob
- parseChartConfig()：配置解析
- createBarChartConfig()：柱状图模板
- createLineChartConfig()：折线图模板
- createPieChartConfig()：饼图模板
- createRadarChartConfig()：雷达图模板

#### ocr.test.ts — OCR 识别
- recognizeImage()：正常识别
- recognizeImage()：超时处理（30 秒）
- 语言包加载（chi_sim + eng）

#### logger.test.ts — 日志
- Logger 构造：模块名设置
- debug/info/warn/error：各级别日志
- Error 对象自动提取 message + stack
- 对象参数自动 JSON.stringify

#### log-storage.test.ts — 日志存储
- saveFrontendLog()：保存前端日志
- saveApiLog()：保存 API 日志
- getFrontendLogs()：获取前端日志
- getApiLogs()：获取 API 日志
- clearAllLogs()：清空日志
- downloadLogs()：下载日志
- 4MB 存储限制

#### storage-sync.test.ts — 存储同步
- defineStorageSync()：创建响应式存储
- 写入防抖（200ms）
- 回声窗口防循环（500ms）
- plain()：剥离 Vue 代理

#### markdown.test.ts — Markdown 渲染
- renderMarkdown()：基本渲染
- renderMarkdown()：代码高亮
- renderMarkdown()：KaTeX 数学公式
- renderMarkdown()：代码块复制按钮
- renderMarkdown()：表格下载按钮
- renderMarkdownPlain()：纯文本渲染

#### shortcut.test.ts — 快捷键
- matchShortcut()：匹配组合键
- eventToShortcut()：事件转快捷键字符串

#### cache.test.ts — 缓存管理
- clearCache()：清除对话、日志、输入历史
- checkAndAutoClear()：超过 30MB 自动清除

---

### voice/ — 语音功能

#### commandParser.test.ts — 命令解析（已有，补充）
- 解析全部 8 种指令类型
- 批量解析多条指令
- 纯对话文本
- 非法指令类型
- 缺少必填参数
- 混合指令和对话

#### recognition.test.ts — Web Speech API 识别
- start()：开始识别
- stop()：停止识别
- 连续模式：自动重启
- interim 结果回调
- 错误处理和恢复

#### sherpa-recognition.test.ts — Sherpa 本地识别
- 初始化：AudioContext 创建
- 16kHz 采样率设置
- WebAssembly 模型加载
- 中英双语识别
- 降级到 Web Speech API

#### broadcast.test.ts — 语音合成（TTS）
- speak()：正常播报
- speak()：返回 Promise
- cancel()：取消播报
- onStart/onEnd 回调

#### session.test.ts — 语音会话
- 状态机：IDLE → LISTENING → PROCESSING → SPEAKING → IDLE
- 识别文本发送给 AI
- AI 回复解析命令
- 串行执行自动化操作
- TTS 播报结果
- 解析失败重试（最多 3 次）
- 优先 Sherpa，降级 Web Speech API

---

## 注意事项

1. **每个模块独立测试文件**：不堆在一个大文件里，便于维护和增量更新
2. **功能测试 + 单元测试结合**：核心模块（pipeline、action-executor、adapters）深度测试，工具模块（file-type、cache）浅层测试
3. **Mock 策略匹配模块特性**：适配器 mock 流式数据、voice mock 语音 API、storage mock chrome API
4. **测试文件不覆盖源码文件**：测试放在 `__tests__/` 目录，源码不受影响
5. **增量模式只更新变更模块**：未变化模块的测试文件保持原样
6. **首次运行耗时较长**：需要分析整个项目并生成测试，预计 10-15 分钟
7. **测试文件会被覆盖**：每次运行会重新生成测试文件，手动修改会丢失
8. **报告每次覆盖**：docs/functional-test-report.md 每次运行都会被最新报告覆盖
9. **已有测试保留**：`src/browser/skeleton.test.ts` 和 `src/__tests__/functional-test.test.ts` 保留，新测试放在 `__tests__/` 目录下
10. **vitest.config.ts 的 include 已配置 `src/**/*.test.ts`**：新测试文件自动纳入

---

## 快捷操作

- `/test-suite` — 完整流程（分析全部模块 → 生成测试 → 执行 → 报告）
- `/test-suite adapters` — 只测试 AI 适配器模块
- `/test-suite browser` — 只测试浏览器命令引擎
- `/test-suite voice` — 只测试语音功能
- `/test-suite --skip-generate` — 跳过生成，直接执行现有测试
- `/test-suite --report-only` — 只生成报告（基于最近一次测试结果）
