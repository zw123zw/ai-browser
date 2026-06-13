# 技能工作流引擎架构

## Goal

设计并实现一个可插拔的技能工作流引擎，支持用户通过 `/命令` 触发技能工作流。技能工作流是一个文件，包含 `input` 和 `output` 函数，由引擎加载执行：`input` 收集页面数据并构建 AI prompt，发送给 AI 后将结果传给 `output` 执行 DOM 操作。支持滚动监听、错误重试、并发控制等机制。

## What I already know

- 当前代码库有两条完全独立的路径：聊天模式（无页面感知）和语音模式（有页面感知但无文本输入）
- 聊天输入 `InputBar.vue` 没有任何命令解析，所有输入都直接发给 AI
- 语音模式有完整的命令系统：`VoiceSession` → AI → `commandParser` → `automation/actions.ts`
- 页面内容获取已有 `getPageContext()` 实现（克隆 DOM、清理脚本样式）
- AI 适配器系统使用工厂模式，支持多种协议（OpenAI、Anthropic、Qwen、Wenxin）
- 代理系统通过 background script 处理 CORS
- 单会话模型，会话存储在 `chrome.storage.local`

## Requirements

### 核心架构

1. **技能文件格式**：TypeScript 模块，导出 `defineSkill()` 定义
2. **技能生命周期**：`input` → AI 调用 → `output`，支持钩子（onScroll、onLoad、onRefresh）
3. **工作流引擎**：加载技能文件、执行生命周期、管理状态
4. **技能上下文**：注入给每个技能，提供 DOM 操作、AI 调用、日志等能力

### 命令系统

5. `/技能名 [参数]` — 激活技能
6. `/close` 或 `/stop` — 停止当前技能
7. `/pause` — 暂停技能
8. `/resume` — 恢复技能
9. `/list` — 列出所有可用技能
10. `/help 技能名` — 显示技能帮助
11. `/status` — 显示当前技能状态

### 引擎能力

12. **并发控制**：限制同时进行的 AI 请求数（默认 3）
13. **防抖节流**：滚动事件防抖 500ms
14. **错误恢复**：自动重试 3 次，失败后通知用户
15. **资源清理**：停用时自动清理监听器、恢复原始内容
16. **技能冲突**：同一时间只能激活一个技能
17. **缓存机制**：缓存 AI 结果避免重复调用
18. **进度反馈**：在聊天中显示技能执行日志

### 技能上下文 API

19. `ctx.getVisibleElements()` — 获取页面可见元素
20. `ctx.getNewVisibleElements()` — 获取新出现的元素
21. `ctx.replaceElements(elements, html)` — 替换页面内容
22. `ctx.restoreOriginal()` — 恢复原始内容
23. `ctx.ai.chat(prompt, system?)` — 调用 AI
24. `ctx.showLog(message, level?)` — 显示日志
25. `ctx.args` — 获取技能参数
26. `ctx.get(key)` / `ctx.set(key, value)` — 状态存取

## Acceptance Criteria

- [ ] 用户输入 `/翻译中文` 能激活翻译技能
- [ ] 翻译技能能获取页面可见内容并发送给 AI
- [ ] AI 返回结果后替换页面内容
- [ ] 用户滚动页面时自动翻译新内容
- [ ] 用户输入 `/close` 能停止技能并恢复原始内容
- [ ] 用户输入 `/list` 能列出所有可用技能
- [ ] 用户输入 `/status` 能显示当前技能状态
- [ ] AI 请求有并发控制，不会同时发送过多请求
- [ ] 滚动事件有防抖，不会频繁触发
- [ ] 技能执行失败时自动重试，最终失败通知用户
- [ ] 停用技能时自动清理所有监听器
- [ ] 同一时间只能运行一个技能

## Definition of Done

- 技能工作流引擎核心实现完成
- 至少 2 个内置技能（翻译、总结）
- 命令系统完整实现
- 单元测试覆盖核心逻辑
- 构建通过，无类型错误

## Technical Approach

### 技能文件结构

```typescript
// src/skills/workflows/translate.ts
import { defineSkill } from '../defineSkill'

export default defineSkill({
  name: 'translate',
  trigger: '/翻译',
  description: '翻译当前页面',
  icon: '🌐',
  args: [
    { name: 'targetLang', default: '中文', description: '目标语言' }
  ],

  async input(ctx) {
    const elements = ctx.getVisibleElements()
    return {
      prompt: `翻译为${ctx.args.targetLang}：\n${elements.text}`,
      system: '你是专业翻译，保持原文格式。',
      hooks: {
        onScroll: async () => {
          const newElements = ctx.getNewVisibleElements()
          if (newElements.hasNew) {
            const result = await ctx.ai.chat(`翻译：\n${newElements.text}`)
            ctx.replaceElements(newElements.elements, result)
          }
        }
      }
    }
  },

  async output(ctx, aiResult) {
    ctx.replaceElements(ctx.getVisibleElements().elements, aiResult)
    ctx.showLog('翻译完成')
  }
})
```

### 引擎执行流程

```
用户输入 /翻译中文
    ↓
InputBar.send() → 匹配 /^\/(\S+)\s*(.*)/
    ↓
skillEngine.activate('翻译', ['中文'])
    ↓
1. 加载 translate.ts
2. 创建 SkillContext
3. 调用 input(ctx) → { prompt, system, hooks }
4. 并发控制检查
5. 调用 AI (prompt)
6. 调用 output(ctx, aiResult)
7. 设置 hooks.onScroll
    ↓
技能运行中...（滚动时自动翻译新内容）
    ↓
用户输入 /close
    ↓
skillEngine.deactivate()
    ↓
1. 清理滚动监听器
2. ctx.restoreOriginal()
3. 显示停用日志
```

### 目录结构

```
src/skills/
├── types.ts              # 类型定义
├── engine.ts             # 工作流引擎
├── context.ts            # 技能上下文
├── defineSkill.ts        # 技能定义辅助函数
├── registry.ts           # 技能注册表
├── cache.ts              # AI 结果缓存
└── workflows/            # 技能工作流文件
    ├── translate.ts      # 翻译技能
    └── summarize.ts      # 总结技能
```

### 关键修改文件

| 文件 | 修改内容 |
|------|---------|
| `entrypoints/content/components/InputBar.vue` | 添加命令解析，调用 skillEngine |
| `src/skills/engine.ts` | 新建，工作流引擎核心 |
| `src/skills/context.ts` | 新建，技能上下文 |
| `src/skills/types.ts` | 新建，类型定义 |
| `src/skills/defineSkill.ts` | 新建，技能定义辅助函数 |
| `src/skills/registry.ts` | 新建，技能注册表 |
| `src/skills/cache.ts` | 新建，缓存机制 |
| `src/skills/workflows/translate.ts` | 新建，翻译技能 |
| `src/skills/workflows/summarize.ts` | 新建，总结技能 |

## Decision (ADR-lite)

### 技能文件格式

**Context**: 技能定义用什么格式
**Decision**: TypeScript 模块，使用 `defineSkill()` 辅助函数
**Consequences**: 灵活强大，支持复杂逻辑，但需要编程能力

### 执行环境

**Context**: 技能在哪个环境执行
**Decision**: Content Script 中执行（需要访问页面 DOM）
**Consequences**: 直接操作 DOM，但受 Shadow DOM 隔离限制

### 命令触发方式

**Context**: 如何识别技能命令
**Decision**: 正则匹配 `/命令 参数`，匹配后调用 skillEngine
**Consequences**: 简单直接，与现有聊天输入无缝集成

### 技能状态管理

**Context**: 长时间运行的技能如何管理状态
**Decision**: 内存状态 + 可选持久化到 storage
**Consequences**: 简单高效，页面刷新后状态丢失（可接受）

## Out of Scope

- MD/YAML 格式的技能定义（未来可扩展）
- 跨标签页技能同步
- 技能热重载（开发便利性，非核心功能）
- 技能市场/远程加载
- 技能权限系统
- 多技能并行运行

## Technical Notes

### 关键依赖

- `src/adapters/` — AI 适配器，复用现有工厂模式
- `src/stores/settings.ts` — 获取 AI 模型配置
- `src/stores/conversations.ts` — 可选，在聊天中显示技能消息

### 并发控制实现

```typescript
private aiConcurrency = 0
private maxConcurrency = 3

async callAI(input: SkillInput): Promise<string> {
  while (this.aiConcurrency >= this.maxConcurrency) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  this.aiConcurrency++
  try {
    // ... 调用 AI
  } finally {
    this.aiConcurrency--
  }
}
```

### 防抖实现

```typescript
if (hooks?.onScroll) {
  let lastTime = 0
  const handler = async () => {
    const now = Date.now()
    if (now - lastTime < 500) return
    lastTime = now
    await hooks.onScroll!()
  }
  window.addEventListener('scroll', handler, { passive: true })
}
```

### 缓存实现

```typescript
class TranslationCache {
  private cache = new Map<string, string>()
  
  get(text: string, lang: string): string | null {
    return this.cache.get(`${lang}:${this.hash(text)}`)
  }
  
  set(text: string, lang: string, result: string) {
    this.cache.set(`${lang}:${this.hash(text)}`, result)
  }
}
```

### 实现计划

- **PR1**: 类型定义 + defineSkill + registry
- **PR2**: engine + context 核心实现
- **PR3**: InputBar 命令解析集成
- **PR4**: 翻译技能 + 总结技能
- **PR5**: 缓存 + 并发控制 + 错误重试
