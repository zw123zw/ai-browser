# 技能工作流引擎架构

## Goal

设计并实现一个可插拔的技能工作流引擎。用户通过 `/命令` 触发技能，引擎加载技能文件，调用 `input(ctx)` 收集页面数据并构建 prompt，发送给 AI 后将结果传给 `output(ctx, aiResult, inputData)` 执行。技能通过上下文（ctx）自行注册滚动监听、获取页面元素，引擎只负责调度。

## What I already know

- 当前代码库有两条完全独立的路径：聊天模式（无页面感知）和语音模式（有页面感知但无文本输入）
- 聊天输入 `InputBar.vue` 没有任何命令解析，所有输入都直接发给 AI
- 语音模式有完整的命令系统：`VoiceSession` → AI → `commandParser` → `automation/actions.ts`
- 页面内容获取已有 `getPageContext()` 实现（克隆 DOM、清理脚本样式）
- AI 适配器系统使用工厂模式，支持多种协议（OpenAI、Anthropic、Qwen、Wenxin）
- 代理系统通过 background script 处理 CORS
- 单会话模型，会话存储在 `chrome.storage.local`

## Requirements

### 一、核心架构

1. **技能文件格式**：TypeScript 模块，使用 `defineSkill()` 定义
2. **技能生命周期**：引擎调用 `input(ctx)` → 发送 AI → 调用 `output(ctx, aiResult, inputData)`
3. **工作流引擎**：加载技能、调用 input、发送 AI、调用 output、管理状态
4. **技能上下文**：注入给 input/output，提供 DOM 操作、事件注册、流程控制、日志等能力
5. **引擎职责最小化**：防抖、节流、事件处理等逻辑由技能自行实现，引擎只负责调度

### 二、命令系统

#### 内置命令（引擎处理）

6. `/技能名` — 启动技能，userText 为空
7. `/技能名 用户描述` — 启动技能，userText 为用户描述
8. `/stop` — 停止当前技能
9. `/pause` — 暂停当前技能（保留监听器，停止处理）
10. `/resume` — 恢复当前技能
11. `/list` — 列出所有可用技能
12. `/help` — 显示所有命令帮助
13. `/help 技能名` — 显示某个技能的详细帮助

#### 命令解析规则

14. 以 `/` 开头的输入被视为命令
15. 第一个空格前的部分为命令名，后面的部分为用户描述（userText）
16. 命令匹配优先级：内置命令 > 技能触发词
17. 不匹配任何命令或技能时，作为普通消息发送给 AI

### 三、引擎能力

18. **错误恢复**：AI 调用失败时自动重试 3 次，重试时将错误原因一起发送给 AI
19. **资源清理**：停用时自动清理所有监听器、恢复原始内容
20. **技能冲突**：同一时间只能激活一个技能，启动新技能时自动停用旧技能
21. **进度反馈**：在聊天中显示技能执行日志
22. **状态管理**：技能状态（idle/running/paused/stopped）

### 四、技能上下文 API

23. `ctx.userText` — 用户额外描述（`/技能名` 后面的文字）
24. `ctx.getVisibleElements()` — 获取页面可见元素，返回 `{ elements, text, html }`
25. `ctx.getNewVisibleElements()` — 获取新出现的元素
26. `ctx.replaceElements(elements, html)` — 替换页面内容
27. `ctx.restoreOriginal()` — 恢复原始内容
28. `ctx.onScroll(handler)` — 注册滚动监听（自动加入清理队列）
29. `ctx.onRefresh(interval, handler)` — 注册定时刷新
30. `ctx.reload()` — 重新执行 input → AI → output 流程
31. `ctx.showLog(message)` — 显示日志
32. `ctx.get(key)` / `ctx.set(key, value)` — 状态存取
33. `ctx.isPaused()` — 检查技能是否暂停
34. `ctx.isStopped()` — 检查技能是否停止

## Acceptance Criteria

- [ ] 用户输入 `/翻译` 能激活翻译技能
- [ ] 用户输入 `/翻译 中文` 能激活翻译技能，userText='中文'
- [ ] 翻译技能能获取页面可见内容并发送给 AI
- [ ] AI 返回结果后替换页面内容
- [ ] 用户滚动页面时自动翻译新内容（通过 ctx.reload() 重新执行流程）
- [ ] 用户输入 `/stop` 能停止技能并恢复原始内容
- [ ] 用户输入 `/pause` 能暂停技能
- [ ] 用户输入 `/resume` 能恢复技能
- [ ] 用户输入 `/list` 能列出所有可用技能
- [ ] 用户输入 `/help 翻译` 能显示翻译技能帮助
- [ ] AI 调用失败时自动重试 3 次，重试时包含错误原因
- [ ] 重试 3 次仍然失败，通知用户错误信息
- [ ] 停用技能时自动清理所有监听器
- [ ] 同一时间只能运行一个技能，启动新技能自动停用旧技能
- [ ] 不匹配任何命令时，作为普通消息发送给 AI

## Definition of Done

- 技能工作流引擎核心实现完成
- 内置命令全部实现
- 至少 2 个内置技能（翻译、总结）
- 技能生成说明文档（README.md）完成
- 构建通过，无类型错误

## Technical Approach

### 一、执行流程

```
用户输入: /翻译 中文
    ↓
命令解析:
  - 输入以 / 开头 → 是命令
  - 第一个空格前: '翻译' → 匹配技能
  - 空格后: '中文' → userText
    ↓
skillEngine.activate('翻译', '中文')
    ↓
┌─────────────────────────────────────────────────────┐
│  1. 检查是否有活跃技能                               │
│     → 有 → 调用旧技能 ctx.cleanup() + ctx.restoreOriginal()
│                                                      │
│  2. 加载 translate.ts                                │
│                                                      │
│  3. 创建 ctx，ctx.userText = '中文'                  │
│                                                      │
│  4. 调用 input(ctx):                                 │
│     - ctx.getVisibleElements() → 获取页面元素         │
│     - ctx.onScroll(...) → 注册滚动监听               │
│     - 返回 { prompt, system, data }                  │
│                                                      │
│  5. 调用 AI (prompt):                                │
│     - 成功 → 继续                                    │
│     - 失败 → 重试 1 (附带错误原因)                    │
│     - 失败 → 重试 2 (附带错误原因)                    │
│     - 失败 → 重试 3 (附带错误原因)                    │
│     - 仍然失败 → 通知用户，停止                       │
│                                                      │
│  6. 调用 output(ctx, aiResult, inputData):           │
│     - 成功 → 完成                                    │
│     - 失败 → 通知用户                                │
│                                                      │
│  7. 保存活跃技能引用                                 │
└─────────────────────────────────────────────────────┘
    ↓
技能运行中...
  - 用户滚动 → 检测新内容 → 调用 ctx.reload()
  - 重新执行 input → AI → output 流程
    ↓
用户输入: /stop
    ↓
skillEngine.deactivate()
    ↓
┌─────────────────────────────────────────────────────┐
│  1. ctx.cleanup() 清理所有监听器                     │
│  2. ctx.restoreOriginal() 恢复原始内容               │
│  3. 清空活跃技能引用                                 │
│  4. 显示日志 "技能已停止"                            │
└─────────────────────────────────────────────────────┘
```

### 二、错误重试流程

```
AI 调用 (第 1 次):
  prompt: "翻译为中文：\nHello World"
  → 失败: "网络超时"
    ↓
AI 调用 (第 2 次):
  prompt: "翻译为中文：\nHello World\n\n[上次调用失败，错误：网络超时，请重试]"
  → 失败: "API 返回 429 Too Many Requests"
    ↓
AI 调用 (第 3 次):
  prompt: "翻译为中文：\nHello World\n\n[上次调用失败，错误：API 返回 429 Too Many Requests，请重试]"
  → 失败: "API 返回 429 Too Many Requests"
    ↓
通知用户: "技能执行失败：AI 调用连续 3 次失败，最后错误：API 返回 429 Too Many Requests"
```

### 三、命令解析流程

```
用户输入: /翻译 中文
    ↓
匹配 /^\/(\S+)\s*(.*)/
  - match[1] = '翻译'
  - match[2] = '中文'
    ↓
检查是否是内置命令:
  - /stop → 停止技能
  - /pause → 暂停技能
  - /resume → 恢复技能
  - /list → 列出技能
  - /help → 显示帮助
    ↓
不是内置命令 → 查找技能:
  - registry.findByTrigger('翻译') → 找到 translate 技能
    ↓
激活技能:
  - skillEngine.activate('translate', '中文')
    ↓
找不到技能 → 作为普通消息发送给 AI
```

### 四、目录结构

```
src/skills/
├── types.ts              # 类型定义
├── engine.ts             # 工作流引擎
├── context.ts            # 技能上下文
├── defineSkill.ts        # 技能定义辅助函数
├── registry.ts           # 技能注册表
└── workflows/            # 技能工作流文件目录（所有技能都在此目录）
    ├── README.md         # 技能生成说明文档
    ├── translate.ts      # 翻译技能
    └── summarize.ts      # 总结技能
```

### 五、关键修改文件

| 文件 | 修改内容 |
|------|---------|
| `entrypoints/content/components/InputBar.vue` | 添加命令解析，调用 skillEngine |
| `src/skills/engine.ts` | 新建，工作流引擎核心 |
| `src/skills/context.ts` | 新建，技能上下文 |
| `src/skills/types.ts` | 新建，类型定义 |
| `src/skills/defineSkill.ts` | 新建，技能定义辅助函数 |
| `src/skills/registry.ts` | 新建，技能注册表 |
| `src/skills/workflows/README.md` | 新建，技能生成说明文档 |
| `src/skills/workflows/translate.ts` | 新建，翻译技能 |
| `src/skills/workflows/summarize.ts` | 新建，总结技能 |

## Decision (ADR-lite)

### 参数传递

**Context**: 技能参数如何传递
**Decision**: 用户描述（userText）直接传给技能，由技能自己决定怎么用，AI 来理解用户意图
**Consequences**: 灵活自然，用户可以用自然语言描述需求

### 错误重试

**Context**: AI 调用失败如何处理
**Decision**: 重试 3 次，重试时将错误原因一起发送给 AI，最终失败通知用户
**Consequences**: AI 可以根据错误原因调整策略，提高成功率

### 引擎职责

**Context**: 引擎应该处理多少逻辑
**Decision**: 引擎只负责调度（加载→input→AI→output→清理），防抖/节流/事件处理由技能自行实现
**Consequences**: 引擎简单稳定，技能灵活自由

### 流程控制

**Context**: 滚动时如何触发新内容处理
**Decision**: 技能在 onScroll 中调用 ctx.reload()，重新执行完整的 input → AI → output 流程
**Consequences**: 统一流程，引擎统一处理 AI 调用和错误重试

### 命令系统

**Context**: 如何处理用户输入
**Decision**: 以 `/` 开头的输入解析为命令，内置命令优先，然后匹配技能触发词，不匹配则作为普通消息
**Consequences**: 统一入口，用户体验一致

## Out of Scope

- MD/YAML 格式的技能定义
- 跨标签页技能同步
- 技能热重载
- 技能市场/远程加载
- 技能权限系统
- 多技能并行运行

## Technical Notes

### 关键依赖

- `src/adapters/` — AI 适配器，复用现有工厂模式
- `src/stores/settings.ts` — 获取 AI 模型配置

### 技能触发标签格式

统一输入架构中，AI 通过 `[skill]` 标签触发技能：

```
[skill]{"name":"翻译","userText":"中文"}[/skill]
```

- `name` — 技能名（匹配 registry 中的技能）
- `userText` — 用户描述（传给技能的 `ctx.userText`）

扩展后台解析到 `[skill]` 标签后，调用 `skillEngine.activate(name, userText)`。

### 技能列表注入到 Phase 2 Prompt

意图检测架构的 Phase 2 需要技能列表来决策。技能注册表提供格式化列表：

```typescript
interface SkillListItem {
  name: string           // 技能名
  trigger: string        // 触发词（如 "翻译"）
  description: string    // 描述（如 "将页面内容翻译为指定语言"）
  userTextHint: string   // userText 提示（如 "目标语言，默认中文"）
}

function formatSkillList(skills: SkillListItem[]): string {
  return skills.map(s =>
    `- ${s.trigger}: ${s.description}（参数: ${s.userTextHint}）`
  ).join('\n')
}

// 示例输出:
// - 翻译: 将页面内容翻译为指定语言（参数: 目标语言，默认中文）
// - 总结: 总结页面核心内容（参数: 无特殊参数）
```

注入位置：Phase 2 的 System Prompt 中 `{skillList}` 占位符。

### AI 决策规则

Phase 2 Prompt 中的优先级规则：
1. 有匹配技能 → 必须返回 `[skill]`，不能返回浏览器指令
2. 无匹配技能 → 返回 `[command]` 浏览器指令
3. 技能优先级 > 浏览器指令

### 实现计划

- **PR1**: 类型定义 + defineSkill + registry
- **PR2**: engine + context 核心实现
- **PR3**: InputBar 命令解析集成
- **PR4**: 技能生成说明文档（README.md）+ 翻译技能 + 总结技能
- **PR5**: 内置命令完整实现（/stop /pause /resume /list /help）
