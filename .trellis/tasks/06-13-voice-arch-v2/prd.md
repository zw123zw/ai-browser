# 意图检测架构：语音/文字双模式统一输入路由

## Goal

将语音模式和文字模式统一为一套输入路由 + 两阶段 AI 意图检测架构，实现三路分流（聊天/技能/浏览器指令）。

---

## 一、整体架构流程图

```
用户输入 "点击登录按钮"
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  InputRouter（字符串分割，零 AI）                         │
│                                                         │
│  /翻译 中文 → 直接执行技能                               │
│  /stop → 停止当前技能                                    │
│  其余 → 进入 Phase 1                                     │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 1: 意图检测（轻量模型，~100 token）                │
│                                                         │
│  输入：用户文本（无骨架、无技能列表）                      │
│  Prompt：只做二分类，聊天 or [action]                     │
│                                                         │
│  AI 回复 "你好！" → isChat=true → 直接展示               │
│  AI 回复 "[action]" → 进入 Phase 2                       │
│                                                         │
│  ⚠️ Phase 1 不允许输出 [command]/[skill]                  │
│     异常输出时强制进 Phase 2                               │
└─────────────────────────────────────────────────────────┘
    │
    ├── 聊天 → 直接展示 → 结束
    │
    └── [action] ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: 操作决策（主力模型，~2000 token）               │
│                                                         │
│  输入：                                                  │
│    - 用户描述                                            │
│    - 会话历史（最近 6 条，过滤 system 消息）              │
│    - 页面骨架（首次/URL变化时发送，否则复用缓存）         │
│    - 技能列表                                            │
│    - 能力域                                              │
│                                                         │
│  AI 回复示例：                                            │
│  "好的，我来帮你点击登录按钮。                             │
│   [command]{"action":"click","elementId":"e3"}[/command]"│
│                                                         │
│  解析器从自然回复中提取标签：                              │
│    [command] → 展示"正在执行xxx指令" → 执行               │
│    [skill]   → 展示"正在执行xxx技能" → 执行               │
│    [need_html] → 局部 HTML 兜底                          │
│    提取不到 → 重试（最多 5 次）                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
  聊天中展示执行结果 → 结束
```

---

## 二、骨架管理策略

### 核心原则

页面骨架 **不需要每次都发送**，只在以下时机重新提取：

| 时机 | 原因 | 代码位置 |
|------|------|---------|
| 首次进入 Phase 2 | 需要知道当前页面结构 | `SkeletonManager.getSkeleton()` |
| URL 发生变化 | 页面已导航/重定向，骨架失效 | `SkeletonManager.getSkeleton()` 检测 URL |
| 执行 `navigate` 后 | 跳转到新页面 | `Pipeline` 调用 `skeletonManager.invalidate()` |

### 不需要重新发送

| 场景 | 原因 |
|------|------|
| 同一页面连续对话 | 骨架未变，复用缓存 |
| Phase 2 重试 | 上次骨架仍有效（除非执行了 navigate） |
| click/type/scroll 后 | 骨架结构基本不变 |

### 实现

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

## 三、聊天中展示指令/技能

### 设计原则

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

### 消息类型

| 场景 | 消息格式 |
|------|---------|
| 指令解析完成 | `🔧 **正在执行 N 条指令：**\n1. **action** — description` |
| 技能解析完成 | `⚡ **正在执行技能：** 名称 — 描述` |
| 单条指令成功 | `✅ **action** — message` |
| 单条指令失败 | `❌ **action** — message` |
| 重试中 | `⚠️ 指令提取失败，重试 N/5...` |
| 最终错误 | `❌ 多次尝试后仍无法完成操作` |

### 消息类型标识

- `role: 'assistant'` — AI 聊天回复（Phase 1 纯文本回复）
- `role: 'system'` — 系统消息（指令展示、执行结果、重试提示、错误）

---

## 四、Phase 1 Prompt 设计

```
你是一个智能助手。根据用户输入，判断意图并回复。

【规则】
1. 如果是聊天/闲聊/提问/打招呼，直接用自然语言回复（简洁，100字内）
2. 如果用户的请求需要执行任何操作，只回复 [action]

【需要操作的情况（回复 [action]）】
- 需要操作当前页面（点击按钮、填写表单、滚动、选择菜单等）
- 需要打开某个网站（如"打开B站"）
- 需要搜索某些内容（如"搜索Vue教程"）
- 需要执行技能工作流（如"翻译这个页面"）
- 需要控制媒体（播放、暂停等）

【不需要操作的情况（直接回复）】
- 普通聊天、打招呼（如"你好"）
- 知识问答（如"什么是量子计算"）
- 闲聊（如"今天心情不错"）

【重要】
- 你只能输出自然语言回复 或 [action]
- 不要输出 [command]、[skill] 或其他标签
```

---

## 五、Phase 2 Prompt 设计

```
你是浏览器操作助手。根据用户意图和页面信息，生成操作指令。

【指令格式】
在回复中用以下标签包裹指令：

```[command]{"action":"navigate","url":"https://..."}[/command]
[command]{"action":"click","elementId":"e3","description":"登录按钮"}[/command]
[skill]{"name":"翻译","userText":"这个页面"}[/skill]
[need_html]{"query":"下载按钮","reason":"骨架中未找到"}[/need_html]```

【能力域】
navigate / search / click / type / clear / scroll / select / keyboard / focus / hover / wait

【定位策略】
优先级：elementId > fallbackSelector > description

【可用技能】
{skillList}

【规则】
1. 打开已知网站 → 直接 [command]{"action":"navigate","url":"..."}（不需要骨架）
2. 全网搜索 → 直接 [command]{"action":"search","text":"..."}（不需要骨架）
3. 滚动页面 → 直接 [command]{"action":"scroll","direction":"..."}（不需要骨架）
4. 操作页面元素 → 必须用骨架 elementId
5. 有匹配技能 → [skill]
6. 骨架找不到 → [need_html]
7. 多步操作按顺序输出多个 [command]
```

---

## 六、错误重试（5 次）

### 重试流程

```
Phase 2 首次请求
    │
    ├── 提取到标签 → 执行
    │   ├── 成功 → 结束
    │   └── 失败 → 重试（带最新骨架 + 失败原因）
    │
    └── 未提取到标签 → 重试（带上次回复 + 错误原因）
        │
        ├── 第 1 次重试 → 展示 "⚠️ 重试 1/5"
        ├── 第 2 次重试 → 展示 "⚠️ 重试 2/5"
        ├── ...
        └── 第 5 次重试 → 展示 "❌ 超过重试上限"
```

### 重试时发送给 AI 的内容

```
最近对话:
用户: 打开B站
助手: [command]{"action":"navigate","url":"https://bilibili.com"}[/command]

用户描述: "点击登录按钮"
页面语义骨架: { url, title, elements: [...] }
你上一次的回复: [command]{"action":"click","elementId":"e99"}[/command]
执行错误: 元素 e99 未找到
页面骨架已更新（见上方）。请根据新骨架重新定位目标元素。
```

---

## 七、Prompt 文件管理

所有 AI 提示词集中在 `src/input/prompts.ts` 文件管理：

```typescript
// src/input/prompts.ts

/** Phase 1 系统 Prompt */
export const PHASE1_SYSTEM_PROMPT = `...`

/** Phase 2 系统 Prompt（含 {skillList} 占位符） */
export const PHASE2_SYSTEM_PROMPT = `...`

/** Phase 2 重试系统 Prompt */
export const PHASE2_RETRY_SYSTEM_PROMPT = `...`

/** 构建 Phase 2 用户消息 */
export function buildPhase2UserMessage(...): string { ... }

/** 构建重试用户消息 */
export function buildRetryUserMessage(...): string { ... }

/** 构建 need_html 兜底消息 */
export function buildNeedHtmlUserMessage(...): string { ... }
```

---

## 八、完整文件清单

```
src/
├── input/
│   ├── types.ts              # 类型定义（PipelineCallbacks 等）
│   ├── router.ts             # 输入路由器（/命令解析）
│   ├── intent-detector.ts    # Phase 1 + Phase 2 AI 调用
│   ├── pipeline.ts           # 统一处理流水线（重试逻辑）
│   ├── tag-parser.ts         # 标签提取器（从自然回复中提取）
│   ├── prompts.ts            # 所有 AI 提示词（集中管理）
│   └── index.ts              # 统一导出
├── browser/
│   ├── types.ts              # 浏览器层类型定义
│   ├── skeleton.ts           # 骨架提取 + SkeletonManager
│   ├── action-executor.ts    # 指令执行引擎（三重定位 + 事件触发）
│   ├── local-html.ts         # 局部 HTML 提取（need_html 兜底）
│   └── index.ts              # 统一导出
├── composables/
│   └── usePipeline.ts        # Vue composable（集成流水线到 UI）
└── ...
```

---

## 九、Acceptance Criteria

- [ ] `/翻译 中文` 直接执行技能（零 AI）
- [ ] Phase 1 聊天 → 纯文本回复，和普通 LLM 一样
- [ ] Phase 1 操作 → [action]，不允许输出 [command]/[skill]
- [ ] Phase 2 "打开B站" → [command]{"action":"navigate","url":"..."}
- [ ] Phase 2 "点击登录" → 用骨架 elementId 定位
- [ ] 骨架只在首次/URL变化时发送
- [ ] 解析到指令后聊天中展示"🔧 正在执行 N 条指令"
- [ ] 解析到技能后聊天中展示"⚡ 正在执行技能：xxx"
- [ ] 每条指令执行结果单独展示（✅/❌）
- [ ] 重试 5 次，重试过程在聊天中展示
- [ ] 重试时发送错误信息 + 最新骨架给 AI
- [ ] 所有 prompt 集中在 prompts.ts 管理
- [ ] 会话历史完整保留（过滤 system 消息）
- [ ] TypeScript 类型检查通过
- [ ] 构建通过
