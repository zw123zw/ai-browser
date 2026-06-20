# 输入处理流水线架构

## 目标

统一处理用户输入（文字/语音），路由到聊天回复或浏览器操作。用户输入经过确定性路由、两阶段 AI 意图检测、流式指令执行、自动重试，最终完成浏览器操作或返回聊天回复。

## 架构总览

```
用户输入
   │
   ▼
┌─────────────┐
│ InputRouter  │  / 前缀 → 确定性路由
└──────┬──────┘
       │
       ├─ builtin → 内置命令（stop/pause/resume/list/help）
       └─ ai      ──┐
                     ▼
          ┌──────────────────┐
          │  IntentDetector   │
          │  Phase 1 (轻量)   │  三分类：[command] / [action] / 聊天
          └────────┬─────────┘
                   │
       ┌───────────┼───────────┐
       │           │           │
    聊天回复   [command]    [action]
       │       快速通道       │
       ▼           │           ▼
    结束           ▼    ┌──────────────────┐
               直接执行  │  InputPipeline    │
               (无需骨架) │  Phase 2 (主力)   │  流式单指令执行 + 重试循环
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  ActionExecutor   │  执行浏览器操作
                         └──────────────────┘
```

### Mermaid 流程图

```mermaid
flowchart TD
    A[用户输入] --> B[InputRouter.route]
    B -->|/ 前缀| C{命令类型}
    B -->|普通文本| D[IntentDetector.detectPhase1]

    C -->|builtin| E[内置命令处理]

    D -->|isChat=true| G[返回聊天回复]
    D -->|Phase1 直出 [command]| FP[快速通道: executePhase1Commands]
    D -->|isChat=false / [action]| H[IntentDetector.detectPhase2]

    FP --> K2[ActionExecutor.execute]

    H --> I[InputPipeline.processPhase2WithRetry]
    I --> J{标签提取}
    J -->|[command]| K[ActionExecutor.execute]
    J -->|[need_full]| L[提取全页骨架]
    J -->|[need_input]| M[暂停等待用户输入]
    J -->|无标签| N[任务完成]

    K -->|成功| O{end / done?}
    K -->|失败| P{执行次数 < 20?}
    K2 -->|成功| N
    K2 -->|失败| N
    O -->|end 或无更多| N
    O -->|继续| I
    P -->|是| I
    P -->|否| Q[报错: 超过执行上限]

    L --> I
    M -->|用户输入| I
```

## 核心设计决策

### 1. 两阶段处理 (Two-Phase Processing)

处理流程分为两个阶段，各司其职：

| 阶段 | 模型 | 职责 | 输出 |
|------|------|------|------|
| Phase 1 | 轻量模型 | 聊天 vs 操作 二分类 + 简单指令直出 | `[action]` / `[command]` / 自然语言回复 / `[FILE:xxx]` |
| Phase 2 | 主力模型 | 从 AI 自然回复中提取结构化指令 | `[command]` / `[need_full]` / `[need_input]` / `end` |

**Phase 1 设计考量：**
- 使用轻量模型做意图分类，降低延迟和成本
- 系统提示词 (`PHASE1_SYSTEM_PROMPT`) 要求严格四选一输出：`[command]` / `[action]` / `[FILE:xxx]` / 自然语言
- **快速通道（Fast Path）：** Phase 1 直出 `[command]` 时跳过 Phase 2，直接执行。适用于不需要页面骨架的简单操作（navigate/scroll/keyboard 等）
- 流式输出期间实时检测 `[action]` 标签，一旦检测到立即清除流式内容，用户只看到"思考中"

**Phase 2 设计考量：**
- 使用主力模型生成操作指令
- AI 以自然语言回复，代码通过正则从回复中提取结构化标签
- 不要求 AI 只输出标签，允许 AI 在标签前后输出自然语言

### 2. 流式单指令执行 (Streaming Single-Command Execution)

Phase 2 采用流式执行模式，每次迭代只执行一条指令：

1. AI 生成回复（可能包含多条标签）
2. 代码提取标签，只取第一条 `[command]`
3. 执行该指令
4. 刷新页面骨架 (SemanticSkeleton)
5. 携带执行结果请求下一条指令

**设计优势：**
- 每步都能看到最新页面状态，指令准确性高
- 执行失败时可立即调整策略
- 用户能实时看到执行进度

### 3. end 指令验证机制

AI 可以输出 `action: "end"` 表示用户目标已达成。Pipeline 对 end 有严格校验：

- **未执行过任何指令时拒绝 end**：防止 AI 未操作就声称完成
- **end 后不再继续**：直接退出循环，调用 `onAllCommandsDone`
- **done:1 不等于 end**：`done:1` 表示"这是计划中的最后一步"，执行后仍会刷新骨架让 AI 确认；只有 AI 看到新骨架后主动输出 `end` 才真正结束

### 4. 重试机制 (Retry Mechanism)

所有错误类型统一处理：

- **最大执行次数：** 20 次 (`MAX_TOTAL_STEPS`)，包含成功、失败、重试、need_full
- **连续错误追踪：** `consecutiveErrors` 计数，指令成功后重置为 0
- **重试时携带的信息：**
  - 最新页面骨架（每轮重新提取）
  - 上次失败的错误信息
  - 上次失败的指令详情
  - 已完成指令列表
  - `need_full` 触发时的全页骨架（如有）

### 5. 指令去重 (Command Deduplication)

通过 `completedKeys` Set 防止重复执行：

```typescript
// key 格式: "action:url/elementId/description:text"
const cmdKey = `${cmd.action}:${cmd.url || cmd.elementId || cmd.description || ''}:${cmd.text || ''}`
if (completedKeys.has(cmdKey)) {
  // 跳过执行
}
```

**适用场景：** AI 在重试时可能生成与已完成指令相同的操作，去重机制避免重复点击等副作用。`text` 字段参与 key 计算，防止同元素不同值被误判为同一指令。

### 6. need_input 用户交互

AI 可以输出 `[need_input]{"message":"...","type":"credentials"}` 请求用户输入信息（凭据、验证码等）。Pipeline 暂停执行，通过 `callbacks.onNeedInput()` 回调等待用户输入，收到后将用户输入作为上下文传入下一轮 AI 调用。

### 7. 跨标签页任务续接

`navigate` 或 `_blank` 点击导致页面跳转时，当前 JS 上下文可能被销毁。Pipeline 通过 `queuedTaskStorage` 将未完成任务保存到 Chrome Storage：

```mermaid
sequenceDiagram
    participant P as Pipeline (原标签页)
    participant S as Chrome Storage
    participant N as Pipeline (新标签页)

    P->>S: queuedTaskStorage.setValue({originalRequest, completedSteps, timestamp})
    Note over P: navigate 成功 → 原标签页停止
    Note over N: 新标签页加载完成
    N->>S: queuedTaskStorage.getValue()
    S-->>N: QueuedTask
    N->>N: 过期检查（30秒）
    N->>N: resumeQueuedTask() → 跳过 Phase 1，直接 Phase 2
```

**click + done:0 的特殊处理：**
- 执行 click 前先保存 queued task
- 如果 click 导致页面跳转（JS 上下文销毁），queued task 保留给新标签页
- 如果 click 未跳转（500ms 后清除 queued task）
- 如果 click 新开标签页（`openedNewTab`），原标签页立即停止，由新标签页续接

### 8. Abort 支持

整个流水线支持用户中途取消：

- `sleep()` 函数使用 `AbortSignal` 监听，等待期间可被中断
- 每轮循环开始时检查 `signal.aborted`
- AI 请求传递 `signal`，网络层可中止
- 指令执行后立即检查 abort（不等 sleep）
- Abort 时抛出 `DOMException`，调用方统一处理

## 组件详细设计

### InputRouter

**文件：** `src/input/router.ts`

**职责：** 唯一预处理层，解析 `/` 前缀命令，其余交给 AI。

**路由逻辑：**

```
输入文本
  │
  ├─ 以 / 开头 ──→ 正则匹配 /^\/(\S+)\s*(.*)/
  │     │
  │     ├─ 命令名在 BUILTIN_COMMANDS 中 → { type: 'builtin' }
  │     └─ 否则 → { type: 'builtin', command: 'unknown' }
  │
  └─ 其余 → { type: 'ai' }
```

**内置命令列表：** `stop`, `pause`, `resume`, `list`, `help`

**核心方法：**

```typescript
class InputRouter {
  route(ctx: InputContext): InputResult
}
```

- `InputContext`: `{ text: string; mode: 'text' | 'voice' }`
- `InputResult`: `{ type: 'builtin' }` | `{ type: 'ai' }`

### IntentDetector

**文件：** `src/input/intent-detector.ts`

**职责：** 两阶段 AI 意图检测。

**Phase 1 — `detectPhase1()`**

```typescript
interface Phase1Detection {
  isChat: boolean
  responseText?: string
  rawText: string
  /** Phase 1 直接生成的指令（快速通道，跳过 Phase 2） */
  commands?: Command[]
}

async detectPhase1(
  text: string,
  onChunk?: (delta: string, reasoningDelta?: string) => void,
): Promise<Phase1Detection>
```

- 使用 `PHASE1_SYSTEM_PROMPT` 系统提示词
- 流式输出，`onChunk` 回调支持实时展示
- 判断逻辑：
  1. 提取标签 → 有 `[command]` 且无 `[action]` → **快速通道**：`{ isChat: false, commands: [...] }`
  2. 有 `[action]` → `isChat: false`，进入 Phase 2
  3. 有 `[FILE:xxx]` 文件标签 → `isChat: true`，返回原始文本（前端渲染为文件卡片）
  4. 有 `[chat]` 标签或纯文本 → `isChat: true`

**Phase 2 — `detectPhase2()`**

```typescript
async detectPhase2(text: string, skeleton: SemanticSkeleton): Promise<Phase2Result>
```

- 使用 `PHASE2_SYSTEM_PROMPT` 系统提示词，运行时替换 `{coreRule}` 占位符
- 用户消息通过 `buildPhase2UserMessage()` 构建，包含当前请求和页面骨架
- 返回 `{ commands?: Command[]; needFull?: boolean; rawAiOutput: string }`

**AI 调用细节：**
- 消息构建：最近 N 条历史消息（过滤重数据）+ 系统提示词拼接到用户消息前（兼容不支持 system role 的 API）
- `stripHeavyData()` 清理历史消息中的骨架 JSON 和全页骨架 JSON，减少 token 消耗
- AbortError 向上抛出，由调用方处理

### InputPipeline

**文件：** `src/input/pipeline.ts`

**职责：** 编排完整处理流程，包含 Phase 2 流式执行和重试循环。

**核心方法：**

```typescript
class InputPipeline {
  async process(ctx: InputContext, callbacks: PipelineCallbacks): Promise<void>
  async resumeQueuedTask(task: QueuedTask, callbacks: PipelineCallbacks): Promise<void>
}
```

**`process()` 流程：**

1. `router.route(ctx)` 路由
   - `builtin` → `onBuiltinCommand()` 回调
   - `ai` → 继续
2. Phase 1 流式检测
   - `onChatStart()` 创建占位消息
   - 流式回调 `onChatDelta()`，实时检测 `[action]` 标签
   - 检测到操作标签 → `onChatDelta('', undefined, true)` 清除内容
   - 聊天回复 → 替换流式内容为最终文本 → `onChatEnd()`
   - **快速通道：** `p1.commands?.length` → `executePhase1Commands()` 直接执行，跳过 Phase 2
3. Phase 2 流式执行
   - `onActionDetected()` 移除"思考中"消息
   - `processPhase2WithRetry()` 执行

**`executePhase1Commands()` 方法（快速通道）：**

```typescript
private async executePhase1Commands(
  commands: Command[],
  userText: string,
  callbacks: PipelineCallbacks,
): Promise<void>
```

- 逐条执行 Phase 1 直出的指令（不需要页面骨架）
- 共用 Phase 2 的执行逻辑和 UI 回调（`onCommandsParsed` / `onCommandResult` / `onAllCommandsDone`）
- `navigate` 操作后自动失效骨架缓存（`skeletonManager.invalidate()`）

**`processPhase2WithRetry()` 流程：**

```
while (totalExecutions < MAX_TOTAL_STEPS):
  1. 检查 abort signal
  2. 提取最新骨架
  3. 选择模式: MODE_FIRST / MODE_STREAMING / MODE_RETRY
  4. callStreamingAI() — 每次只取第一条指令
  5. 无标签 → 任务完成，break
  6. [need_input]:
     - callbacks.onNeedInput(message) → 暂停等待用户输入
     - 收到后继续循环（携带 userInputContext）
  7. [command]:
     - end 指令 → 检查已执行步骤数 → break
     - 去重检查 (completedKeys，含 text 字段)
     - click + done:0 → 保存 queued task → 执行
     - 执行指令
     - 成功 → 记录、重置错误、检查 openedNewTab、sleep 500ms、continue
     - 失败 → 记录错误、consecutiveErrors++、continue
  8. [need_full]:
     - extractFullPageSkeleton() 提取全页骨架
     - 记录错误和全页骨架、consecutiveErrors++、continue
```

**`callStreamingAI()` 方法：**

```typescript
private async callStreamingAI(
  text: string,
  skeleton: SemanticSkeleton,
  completed: Array<{...}>,
  lastError: string,
  lastFailedCommand?: {...} | null,
  lastFullSkeleton?: string | null,
  coreRule?: string,
  userInputContext?: string,
): Promise<Phase2Result & { needInput?: { message: string } }>
```

- 构建系统提示词：`PHASE2_SYSTEM_PROMPT` 替换 `{coreRule}`
- 构建用户消息：`buildStreamingUserMessage()` 包含原始请求、已完成列表、错误信息、全页骨架、当前骨架、页面提示、用户补充信息
- 只取 `tags.commands` 的第一条：`tags.commands?.slice(0, 1)`

### TagParser

**文件：** `src/input/tag-parser.ts`

**职责：** 从 AI 自然语言回复中提取结构化标签。

**核心方法：**

```typescript
function extractTags(rawText: string): ExtractedTags
```

**支持的标签：**

| 标签 | 格式 | 用途 |
|------|------|------|
| `[action]` | `[action]`（无内容） | Phase 1 操作意图标记 |
| `[chat]` | `[chat]{"text":"..."}[/chat]` 或 `[chat]文本[/chat]` | Phase 1 聊天回复 |
| `[command]` | `[command]{"action":"click","elementId":"e3"}[/command]` | 浏览器操作指令 |
| `[need_full]` | `[need_full]`（无内容） | 请求全页骨架 |
| `[need_input]` | `[need_input]{"message":"...","type":"credentials"}[/need_input]` | 请求用户输入 |
| `[FILE:xxx]` | `[FILE:name.ext]内容[/FILE]` | 文件/图表输出 |

**提取策略：**
- 优先匹配闭合标签 `[tag]...[/tag]`
- 回退匹配：`[tag]` 后的整个 JSON 对象
- `[need_full]` 无需 JSON 解析，检测到标签即触发
- `[FILE:xxx]` 兼容大小写、可选空格、无闭合标签

**辅助函数：**

```typescript
function isChatOnlyReply(tags: ExtractedTags): boolean
// 无操作标签 + 无文件标签 + 有文本内容 → 纯聊天

function getChatText(tags: ExtractedTags): string
// 优先取 [chat] 标签内容，回退取原始文本
```

### Prompts

**文件：** `src/input/prompts.ts`

**职责：** 集中管理所有 AI 提示词。

**系统提示词：**

- `PHASE1_SYSTEM_PROMPT`: Phase 1 意图分类，要求严格四选一输出：`[command]` / `[action]` / `[FILE:xxx]` / 自然语言
- `PHASE2_SYSTEM_PROMPT`: Phase 2 操作决策模板，运行时替换 `{coreRule}`（模式说明）
- `CAPABILITY_DOMAIN_LIST`: 所有能力域定义（navigate/search/click/type/scroll/keyboard 等），含 `needSkeleton` 标记

**模式说明（注入 `{coreRule}` 占位符）：**

- `MODE_FIRST`: 首次进入，"首次执行。根据用户请求和页面骨架，生成第1条指令"
- `MODE_STREAMING`: 流式执行，"继续执行。根据已完成步骤和当前骨架，生成下一条指令"
- `MODE_RETRY`: 错误重试，"上次指令执行失败。根据错误类型调整策略"

**消息构建函数：**

```typescript
buildPhase2UserMessage(text, skeleton)
// Phase 2 标准消息：当前请求 + 页面骨架

buildStreamingUserMessage(text, skeleton, completed, lastError?, lastFailedCommand?, fullSkeleton?, userInputContext?)
// 流式执行消息：原始请求 + 已完成列表 + 错误信息 + 当前页面 URL/标题 + 页面提示 + 全页骨架/当前骨架 + 用户补充信息
```

**`buildStreamingUserMessage` 消息结构：**

```
[原始请求] 用户: "..."
[已完成] 1. click e3 (登录)  2. type e5 (输入文字)
[上次错误] [click] 未找到目标元素
[失败指令] {"action":"click","elementId":"e7"}
[当前页面] https://example.com | 页面标题
[页面提示] 登录失败：密码错误 | 请重新输入
[当前页面骨架]
[{"id":"e1","tag":"input",...},...]
[用户补充信息] 用户提供的额外信息
```

## 数据流时序图

```mermaid
sequenceDiagram
    participant U as 用户
    participant P as InputPipeline
    participant R as InputRouter
    participant D as IntentDetector
    participant E as ActionExecutor
    participant S as SkeletonManager
    participant ST as queuedTaskStorage

    U->>P: process(ctx, callbacks)
    P->>R: route(ctx)

    alt / 前缀命令
        R-->>P: { type: 'builtin' }
        P-->>U: 执行内置命令
    else 普通文本
        R-->>P: { type: 'ai' }

        Note over P: Phase 1 开始
        P->>P: callbacks.onChatStart()
        P->>D: detectPhase1(text, onChunk)
        D-->>P: { isChat, responseText, rawText, commands? }

        alt 聊天回复
            P->>P: callbacks.onChatDelta(responseText)
            P->>P: callbacks.onChatEnd()
        else Phase 1 快速通道 (commands)
            P->>P: callbacks.onActionDetected()
            P->>E: executePhase1Commands(commands)
            E-->>P: 逐条执行结果
            P->>P: callbacks.onAllCommandsDone(...)
        else [action] → Phase 2
            P->>P: callbacks.onActionDetected()

            Note over P: Phase 2 重试循环
            loop totalExecutions < 20
                P->>S: getSkeleton()
                S-->>P: SemanticSkeleton
                P->>D: callStreamingAI(text, skeleton, completed, error, ...)
                D-->>P: Phase2Result

                alt [command]
                    P->>P: callbacks.onCommandsParsed([cmd])
                    alt click + done:0
                        P->>ST: 保存 queued task
                    end
                    P->>E: execute(cmd)
                    E-->>P: { success, message, openedNewTab }
                    P->>P: callbacks.onCommandResult(...)
                    alt 成功 + openedNewTab
                        P->>P: 原标签页停止，等待新页续接
                        Note over P: break
                    else 成功
                        P->>P: 记录完成，重置错误
                        P->>P: sleep(500ms)
                    else 失败
                        P->>P: consecutiveErrors++
                    end
                else [need_input]
                    P->>U: callbacks.onNeedInput(message)
                    U-->>P: 用户输入
                    Note over P: 携带 userInputContext 继续
                else [need_full]
                    P->>P: extractFullPageSkeleton()
                    P->>P: consecutiveErrors++
                else end
                    Note over P: 任务完成，退出循环
                else 无标签
                    Note over P: 任务完成，退出循环
                end
            end

            alt totalExecutions >= 20
                P->>U: callbacks.onError(...)
            else 完成
                P->>U: callbacks.onAllCommandsDone(...)
            end
        end
    end
```

## 类型定义

### InputContext

```typescript
interface InputContext {
  text: string           // 用户输入文本
  mode: 'text' | 'voice' // 输入模式
}
```

### InputResult

```typescript
type InputResult =
  | { type: 'builtin'; command: string; args: string }
  | { type: 'ai' }
```

### PipelineCallbacks

```typescript
interface PipelineCallbacks {
  onChatStart: () => void
  onChatDelta: (delta: string, reasoningDelta?: string, clearContent?: boolean) => void
  onChatEnd: () => void
  onActionDetected: () => void
  onChatMessage: (text: string) => void
  onCommandsParsed: (commands: Command[], currentStep?: number) => void
  onCommandResult: (action: string, success: boolean, message: string) => void
  onAllCommandsDone?: (userText: string, commands: Command[]) => void
  onRetryMessage: (message: string, currentStep?: number, failedCommand?: {...} | null) => void
  onError: (message: string) => void
  /** AI 请求用户输入（返回用户输入的文本，pipeline 暂停等待） */
  onNeedInput: (prompt: string) => Promise<string>
}
```

### ExtractedTags

```typescript
interface ExtractedTags {
  chatText?: string
  commands?: Command[]
  isAction: boolean
  needFull?: boolean
  needInput?: { message: string; type?: string }
  hasFileTags: boolean
  fileTagDetails?: { filename: string; hasClosingTag: boolean; contentLength: number }
  hasAnyTag: boolean
  rawText: string
}
```

## 错误处理

### Abort-Aware Sleep

```typescript
function sleep(ms: number, signal?: AbortSignal): Promise<void>
```

等待期间通过 `AbortSignal` 监听中止事件，清除定时器并抛出 `DOMException`。

### 执行次数限制

- `totalExecutions`: 总执行次数计数器（含成功、失败、重试、need_full、去重跳过）
- 达到 `MAX_TOTAL_STEPS` (20) 时终止循环，调用 `onError` 回调
- 防止 AI 生成无限步骤序列

### 重试信息传递

每轮重试携带完整上下文：

| 信息 | 用途 |
|------|------|
| 最新骨架 | AI 了解当前页面状态 |
| `lastError` | 上次失败的错误描述 |
| `lastFailedCommand` | 上次失败的指令详情 |
| `lastFullSkeleton` | `need_full` 触发时的全页骨架 |
| `completed` 已完成列表 | 避免重复操作 |
| `userInputContext` | need_input 时用户提供的补充信息 |

### AI 调用容错

- `IntentDetector.callAI()` 中 AI 请求失败返回空字符串，不中断流程
- AbortError 检测：捕获后向上抛出，由调用方处理
- `callStreamingAI()` 请求失败后检查 abort 状态，避免继续循环浪费请求

## 目录结构

```
src/input/
├── index.ts              # 统一导出
├── types.ts              # 类型定义 (InputContext, InputResult, PipelineCallbacks)
├── router.ts             # InputRouter — / 前缀路由
├── intent-detector.ts    # IntentDetector — Phase 1 & Phase 2 AI 调用
├── pipeline.ts           # InputPipeline — 流程编排 + 流式执行 + 重试 + 跨标签页续接
├── tag-parser.ts         # extractTags() — 标签提取（含 need_input、FILE）
└── prompts.ts            # 提示词常量 + 消息构建函数 + 能力域定义
```

### 依赖关系

```
pipeline.ts
  ├── router.ts           (InputRouter)
  ├── intent-detector.ts  (IntentDetector)
  ├── tag-parser.ts       (extractTags)
  ├── prompts.ts          (PHASE2_SYSTEM_PROMPT, buildStreamingUserMessage, MODE_*)
  ├── storage/            (queuedTaskStorage)
  └── browser/
      ├── action-executor.ts  (ActionExecutor)
      ├── skeleton.ts         (SkeletonManager)
      └── local-html.ts       (extractFullPageSkeleton)

intent-detector.ts
  ├── tag-parser.ts       (extractTags, isChatOnlyReply, getChatText)
  ├── prompts.ts          (PHASE1_SYSTEM_PROMPT, PHASE2_SYSTEM_PROMPT, buildPhase2UserMessage)
  └── adapters/           (createAdapter)
```
