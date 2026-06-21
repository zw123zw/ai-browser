# brainstorm: 批量指令 + 数据提取

## Goal

在现有 AI 浏览器助手基础上，扩展两大核心能力：
1. **批量指令** — AI 一次返回多条命令，pipeline 依次执行（批量点赞、批量填表、批量评论等）
2. **数据提取** — 新增 `download` action，提取页面数据并导出结构化文件

## What I already know

### 现有架构
- **单命令模式**：Phase 2 每次 AI 只返回 1 条 `[command]`，`tags.commands?.slice(0, 1)` 硬编码只取第一条
- **17 种 action**：navigate, scroll, click, type, clear, select, focus, hover, keyboard, wait, search, newTab, closeTab, switchTab, nextTab, prevTab, video
- **3 层元素定位**：elementId → fallbackSelector → description 文本匹配
- **骨架系统**：SemanticSkeleton 提取页面元素（tag, text, href, inputType, value, disabled 等）
- **跨页面续接**：QueuedTask 机制，navigate/click 触发页面跳转后新标签页自动恢复
- **[need_input]**：暂停等待用户输入（凭据、验证码）
- **[need_full]**：请求全页骨架
- **[FILE]**：AI 生成文件格式，已有渲染逻辑

### 关键文件
| 文件 | 职责 |
|------|------|
| `src/input/prompts.ts` | AI 提示词、能力域定义（CAPABILITY_DOMAIN_LIST） |
| `src/input/pipeline.ts` | 主流程编排（Phase 1/2 循环） |
| `src/input/tag-parser.ts` | AI 输出标签提取（[command]/[action]/[need_full]/[need_input]/[FILE]） |
| `src/input/types.ts` | PipelineCallbacks 类型定义 |
| `src/browser/action-executor.ts` | 命令执行引擎（switch dispatch） |
| `src/browser/skeleton.ts` | 骨架提取（viewport/full 两种模式） |
| `src/browser/local-html.ts` | 全页骨架提取（extractFullPageSkeleton） |
| `src/browser/types.ts` | Command, ActionResult, SemanticSkeleton, SkeletonElement 类型 |
| `src/composables/usePipeline.ts` | Vue composable，pipeline 集成到 UI |

## 需求 1：批量指令

### 问题

当前 `tag-parser.ts` 中 `tags.commands?.slice(0, 1)` 硬编码只取第一条命令。`pipeline.ts` 中 `const cmd = phase2Result.commands[0]` 只执行第一条。

### 方案：AI 返回命令数组

AI 在一次响应中返回多条命令，pipeline 依次执行。失败跳过继续，最后返回汇总报告。

**AI 返回格式**：
```
[command][
  {"action":"click","elementId":"e10","description":"点赞第1条","done":0},
  {"action":"click","elementId":"e15","description":"点赞第2条","done":0},
  {"action":"click","elementId":"e20","description":"点赞第3条","done":1}
][/command]
```

**混合操作示例**（批量填表）：
```
[command][
  {"action":"type","elementId":"e5","text":"张三","description":"姓名","done":0},
  {"action":"type","elementId":"e8","text":"13800138000","description":"手机号","done":0},
  {"action":"click","elementId":"e10","description":"展开下拉框","done":0},
  {"action":"click","elementId":"e11","description":"选择选项A","done":0},
  {"action":"click","elementId":"e12","description":"提交","done":1}
][/command]
```

### 实现步骤

#### Step 1: tag-parser.ts — 解析命令数组

当前逻辑：从 `[command]...[/command]` 中提取 JSON，解析为单个 Command。

改为：
```
提取 [command]...[/command] 内容
↓
内容以 "[" 开头？
  ├── 是 → JSON.parse → 得到 Command[] 数组
  └── 否 → JSON.parse → 得到单个 Command → 包装为 [Command]
↓
tags.commands = Command[]
```

#### Step 2: pipeline.ts — 循环执行命令数组

当前 `processPhase2WithRetry` 中只取第一条命令执行。

改为循环执行所有命令：
```ts
const cmds = phase2Result.commands
const errors: Array<{action: string, error: string}> = []

for (const cmd of cmds) {
  // 1. 去重检查
  const cmdKey = `${cmd.action}:${cmd.url || cmd.elementId || cmd.description || ''}:${cmd.text || ''}`
  if (completedKeys.has(cmdKey)) continue

  // 2. 保存 queued task（click + done:0 时）
  // ... 现有逻辑

  // 3. 执行命令
  const result = await this.executor.execute(cmd)
  totalExecutions++

  // 4. 成功 → 记录
  if (result.success) {
    completed.push(cmd)
    completedKeys.add(cmdKey)
    callbacks.onCommandResult(cmd.action, true, result.message)
  } else {
    // 5. 失败 → 记录错误，跳过继续
    errors.push({ action: cmd.action, error: result.message })
    callbacks.onCommandResult(cmd.action, false, result.message)
  }

  // 6. done:1 → 最后一条，break
  if (cmd.done === 1) break

  // 7. 等待页面更新
  await sleep(500, signal)
}

// 8. 日志记录汇总
if (errors.length > 0) {
  log.warn(`批量执行完成：${completed.length}/${cmds.length} 成功，${errors.length} 失败`)
}
```

#### Step 3: prompts.ts — 更新提示词

Phase 2 prompt 新增批量格式说明（已改）：
```
═══ [command] 批量格式 ═══

用户请求涉及多个相同操作时（批量点赞、批量填表等），返回命令数组：
[command][
  {"action":"click","elementId":"e10","description":"点赞第1条","done":0},
  {"action":"click","elementId":"e15","description":"点赞第2条","done":0},
  {"action":"click","elementId":"e20","description":"点赞第3条","done":1}
][/command]

规则：
- 数组中最后一条的 done 设为 1，其余为 0
- 某条失败不影响后续执行
- 单次建议不超过 20 条
- 批量操作返回命令数组，每条命令独立执行，最后一条 done:1
```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `src/input/tag-parser.ts` | 解析 `[command][array][/command]` 格式 |
| `src/input/pipeline.ts` | 循环执行命令数组，失败跳过继续 |
| `src/input/prompts.ts` | 新增批量格式说明 ✅ 已改 |

---

## 需求 2：数据提取（download）

### 问题

没有从页面提取结构化数据的能力。用户需要"提取页面商品数据"、"导出订单列表"等功能。

### 方案：新增 `download` action

download 在 pipeline 内部特殊处理：提取骨架 → 清洗 → 调 AI 生成结构化文件 → 返回 [FILE]。

**不新增标签**，复用现有 `[command]` + `[FILE]` 格式。

### 完整数据流

```
用户: "提取页面所有商品的名称和价格"

Phase 1: AI 返回 [action]
Phase 2: AI 返回 [command]{"action":"download","description":"提取商品名称和价格"}[/command]

Pipeline 执行 download：
  1. extractFullPageSkeleton() → 获取完整骨架 JSON（200+ 元素）
  2. cleanSkeletonForExtraction() → 清洗骨架（保留数据字段，去掉交互字段）
  3. buildExtractPrompt() → 构造提取 prompt（用户请求 + 清洗后骨架）
  4. callAIForExtraction() → AI 分析骨架，输出 [FILE:商品数据.json][...][/FILE]
  5. callbacks.onFileOutput() → 渲染文件卡片给用户

用户看到：
  ✅ download — 数据提取完成
  📄 商品数据.json — [可下载]
```

### 实现步骤

#### Step 1: prompts.ts — 能力域加 download（已改）

```ts
{ id: 'download', desc: '提取页面数据并导出文件', needSkeleton: true }
```

Phase 2 prompt 新增 download 格式说明（已改）：
```
═══ [command] download 格式 ═══

用户请求提取页面数据时（商品列表、订单、表格、榜单等），输出：
[command]{"action":"download","description":"提取商品名称和价格"}[/command]

规则：
- description 中写明用户要提取的字段
- 系统自动提取页面数据并生成结构化文件
- 不需要指定文件名，系统自动命名
```

#### Step 2: pipeline.ts — download 执行逻辑

在 `processPhase2WithRetry` 的命令执行循环中，download 走特殊路径：

```ts
if (cmd.action === 'download') {
  // 1. 提取全页骨架
  const fullSkeleton = extractFullPageSkeleton()
  if (!fullSkeleton) {
    callbacks.onCommandResult('download', false, '页面无可提取数据')
    continue
  }

  // 2. 清洗骨架
  const cleaned = cleanSkeletonForExtraction(fullSkeleton)

  // 3. 构造提取 prompt
  const extractPrompt = buildExtractPrompt(text, cleaned)

  // 4. 调用 AI 做数据提取
  const aiResult = await this.callAIForExtraction(extractPrompt)

  // 5. 解析 AI 返回的 [FILE] 标签
  // 6. 通过回调返回给用户
  callbacks.onFileOutput(aiResult)

  // 7. 记录完成
  completed.push(cmd)
  completedKeys.add(cmdKey)
  callbacks.onCommandResult('download', true, '数据提取完成')
  if (cmd.done === 1) break
  continue
}
```

#### Step 3: 骨架清洗函数 cleanSkeletonForExtraction

保留数据字段，去掉交互字段和空值字段：

```ts
function cleanSkeletonForExtraction(skeletonJson: string): string {
  const skeleton = JSON.parse(skeletonJson)

  const cleaned = skeleton.elements
    // 第 1 层：过滤无数据元素
    .filter(el => {
      const text = (el.text || '').replace(/[\s\n]/g, '')
      if (text.length <= 1 && !el.value && !el.href && !el.label && !el.ariaLabel) return false
      if (el.text === '(icon)') return false
      if (el.href === '#' || el.href?.startsWith('javascript:')) return false
      return true
    })
    // 第 2 层：精简字段，只保留数据字段
    .map(el => {
      const r: Record<string, any> = {}
      // 内容：优先级 text > ariaLabel > label
      const content = el.text || el.ariaLabel || el.label
      if (content) r.text = content
      if (el.value) r.value = el.value
      if (el.href && el.href !== '#' && !el.href.startsWith('javascript:')) r.href = el.href
      if (el.tag) r.tag = el.tag
      if (el.parent) r.parent = el.parent
      return r
    })
    // 第 3 层：去重（同 parent + 同 text）
    .filter((el, i, arr) => {
      const key = `${el.parent}:${el.text || el.value || el.href}`
      return arr.findIndex(e => `${e.parent}:${e.text || e.value || e.href}` === key) === i
    })

  return JSON.stringify({
    url: skeleton.url,
    title: skeleton.title,
    count: cleaned.length,
    data: cleaned
  })
}
```

**保留的字段**：text, value, href, tag, parent
**去掉的字段**：id, role, label, ariaLabel, placeholder, inputType, checked, required, disabled, expanded, selected

**过滤规则**：
- 空文本 + 空值 + 空链接 + 空 label → 去掉
- text 为 "(icon)" → 去掉
- href 为 "#" 或 "javascript:" → 去掉
- 同 parent + 同 text 去重

**压缩效果**：200+ 元素 → ~25-40 元素，JSON 从 ~50KB → ~4KB

#### Step 4: 提取 prompt 函数 buildExtractPrompt

```ts
function buildExtractPrompt(userRequest: string, cleanedSkeleton: string): string {
  return `\`\`\`
你是数据提取助手。根据用户请求和页面骨架数据，提取用户需要的信息。

═══ 输出格式 ═══

输出 [FILE:文件名.json]...[/FILE] 格式的 JSON 数据。
JSON 必须是数组格式，每个元素是一个数据对象。

═══ 示例 ═══

用户请求："提取商品名称和价格"
骨架数据：[包含商品列表的元素]
输出：
[FILE:商品数据.json][
  {"name":"商品A","price":"99元"},
  {"name":"商品B","price":"199元"}
][/FILE]

═══ 规则 ═══

- 只提取用户请求的字段
- 数据来自骨架中的 text/value/href 等字段
- 过滤掉导航、按钮、页脚等非数据元素
- JSON 格式必须可直接解析
- 文件名根据用户请求自动生成

\`\`\`

[用户请求] ${userRequest}

[页面骨架数据]
${cleanedSkeleton}
`
}
```

#### Step 5: callAIForExtraction 方法

在 pipeline.ts 中新增私有方法，调用 AI 做数据提取：

```ts
private async callAIForExtraction(prompt: string): Promise<string> {
  const settings = this.options.getSettings()
  const modelId = this.options.getModelId?.() || settings.defaultModelId
  const model = settings.models.find(m => m.id === modelId) || settings.models[0]
  const adapter = createAdapter(model.provider || settings.provider)

  const messages = [{ role: 'user' as const, content: prompt }]
  let fullResponse = ''

  await adapter.chat(
    {
      baseUrl: model.baseUrl || settings.baseUrl,
      apiKey: model.apiKey || settings.apiKey,
      modelName: model.modelName || settings.defaultModelId,
      messages,
      signal: this.options.getSignal?.(),
    },
    (chunk) => { if (chunk.delta) fullResponse += chunk.delta }
  )

  return fullResponse
}
```

#### Step 6: callbacks 加 onFileOutput

`src/input/types.ts` — PipelineCallbacks 新增：
```ts
onFileOutput: (content: string) => void
```

`src/composables/usePipeline.ts` — 处理回调：
```ts
onFileOutput: (content) => {
  // 从 AI 输出中提取 [FILE:xxx]...[/FILE] 标签
  // 复用现有的 tag-parser 提取逻辑
  // 渲染为文件卡片（现有的文件渲染组件）
}
```

### 涉及文件

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/input/prompts.ts` | 能力域加 download + download 格式说明 | ✅ 已改 |
| `src/input/pipeline.ts` | download 执行逻辑 + cleanSkeletonForExtraction + buildExtractPrompt + callAIForExtraction | ❌ 未改 |
| `src/input/types.ts` | PipelineCallbacks 加 onFileOutput | ❌ 未改 |
| `src/composables/usePipeline.ts` | onFileOutput 回调处理 | ❌ 未改 |

---

## 不做的功能

| 功能 | 原因 |
|------|------|
| 页面校验（Assert） | 不需要。AI 返回 done:1 时已判断页面状态。用户想验证直接问"登录成功了吗？"即可 |
| 录屏/HTML 报告 | 范围外，需要额外的录制和报告生成系统 |
| Bridge 桥接模式 | 范围外，需要 WebSocket/本地服务通信 |
| 视觉识别（截图） | 当前基于骨架文本，不依赖截图 |
| 拖拽操作 | 需要新增 drag action |
| iframe 深度支持 | 当前只支持一层 iframe |
| 条件分支 | if/else 逻辑在命令序列中 |

## Acceptance Criteria

### 批量指令
- [ ] tag-parser 支持解析 `[command][array][/command]` 格式
- [ ] pipeline 循环执行命令数组中的每条命令
- [ ] 单条命令失败不影响后续命令执行（跳过继续）
- [ ] 执行完成后返回汇总日志（成功/失败数）
- [ ] 兼容现有单条命令格式
- [ ] 支持批量 click（点赞、互动）
- [ ] 支持批量 type（填表）
- [ ] 支持混合操作（type + click + select + scroll）

### 数据提取
- [ ] 能力域新增 download（needSkeleton: true）
- [ ] download 执行时提取全页骨架
- [ ] 骨架清洗：保留 text/value/href/tag/parent，去掉其他字段和空值
- [ ] 清洗后骨架压缩到原始大小的 ~10%
- [ ] AI 分析清洗后的骨架，输出 [FILE:xxx.json] 格式
- [ ] 结果通过 onFileOutput 回调返回给用户
- [ ] 复用现有的 [FILE] 渲染逻辑

## Definition of Done

- prompts.ts 能力域加 download ✅
- prompts.ts 批量格式说明 ✅
- prompts.ts download 格式说明 ✅
- tag-parser.ts 支持命令数组解析
- pipeline.ts 支持批量执行（循环 + 失败跳过）
- pipeline.ts download 执行逻辑（提取 + 清洗 + 调 AI）
- pipeline.ts cleanSkeletonForExtraction 函数
- pipeline.ts buildExtractPrompt 函数
- pipeline.ts callAIForExtraction 方法
- types.ts PipelineCallbacks 加 onFileOutput
- usePipeline.ts onFileOutput 回调处理
- 类型定义完整
- 测试通过

## Out of Scope

- 页面校验（Assert）— 不需要
- 录屏/HTML 报告
- Bridge 桥接模式
- 视觉识别（截图）
- 拖拽操作
- iframe 深度支持
- 条件分支

## Technical Notes

### 批量执行的关键逻辑

1. tag-parser 解析时，先检查 `[command]` 内容是否以 `[` 开头，是则 JSON.parse 为数组
2. pipeline 循环执行时，每条命令独立执行，失败记录错误但不中断
3. navigate 在批量数组中需要特殊处理（跨页面），建议 AI 不要在数组中放 navigate
4. done:1 只在最后一条命令上设置

### 骨架清洗的关键逻辑

1. 过滤：去掉空文本、纯图标、空链接
2. 精简：只保留 text/value/href/tag/parent 五个字段
3. 去重：同 parent + 同 text 的元素只保留一个
4. 压缩效果：200+ 元素 → ~25-40 元素，~50KB → ~4KB

### download 与现有流程的关系

- download 不经过 ActionExecutor，直接在 pipeline 中处理
- download 调用 AI 时使用独立的 prompt（buildExtractPrompt），不走 Phase 2 prompt
- download 的 AI 输出走 [FILE] 格式，复用现有的文件渲染逻辑
- download 完成后记录到 completed 数组，与其他 action 一致
