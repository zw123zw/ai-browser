# 技能工作流开发指南

## 快速开始

在 `src/skills/workflows/` 目录下创建 `.ts` 文件，如 `translate.ts`：

```typescript
import { defineSkill } from '../defineSkill'

export default defineSkill({
  name: 'translate',
  trigger: '/翻译',
  description: '翻译当前页面',

  async input(ctx) {
    const elements = ctx.getVisibleElements()
    return {
      prompt: `翻译为${ctx.userText || '中文'}：\n${elements.text}`,
      data: { elements }
    }
  },

  async output(ctx, aiResult, inputData) {
    ctx.replaceElements(inputData.data.elements, aiResult)
  }
})
```

使用：在聊天框输入 `/翻译` 或 `/翻译 英文`

---

## 执行流程

每次触发技能都走同一套流程：

```
input(ctx) → AI → output(ctx, aiResult, inputData)
```

**滚动时的流程**：
1. 技能在 input 中注册 `ctx.onScroll()`
2. 用户滚动 → 检测到新内容 → 调用 `ctx.reload()`
3. 引擎重新执行：`input → AI → output`

---

## ctx 上下文 API

### 用户输入

| API | 说明 |
|-----|------|
| `ctx.userText` | 用户描述（`/翻译 英文` → `'英文'`） |

### 页面操作

| API | 说明 |
|-----|------|
| `ctx.getVisibleElements()` | 获取可见元素 → `{ elements, text, html }` |
| `ctx.getNewVisibleElements()` | 获取新元素 → `{ elements, text, hasNew }` |
| `ctx.replaceElements(elements, html)` | 替换页面内容（自动保存原始内容） |
| `ctx.restoreOriginal()` | 恢复原始内容 |

### 事件注册

| API | 说明 |
|-----|------|
| `ctx.onScroll(handler)` | 注册滚动监听 |
| `ctx.onRefresh(interval, handler)` | 注册定时刷新 |

### 流程控制

| API | 说明 |
|-----|------|
| `ctx.reload()` | 重新执行 input → AI → output 流程 |

### 状态检查

| API | 说明 |
|-----|------|
| `ctx.isPaused()` | 是否暂停 |
| `ctx.isStopped()` | 是否停止 |
| `ctx.get(key)` / `ctx.set(key, value)` | 状态存取 |

### 日志

| API | 说明 |
|-----|------|
| `ctx.showLog(message)` | 显示日志 |

---

## 示例

### 翻译技能（带滚动监听）

```typescript
import { defineSkill } from '../defineSkill'

export default defineSkill({
  name: 'translate',
  trigger: '/翻译',
  description: '翻译当前页面',
  icon: '🌐',
  help: '/翻译 或 /翻译 英文',

  async input(ctx) {
    const elements = ctx.getVisibleElements()

    // 注册滚动监听：有新内容时重新执行流程
    let lastTime = 0
    ctx.onScroll(async () => {
      if (ctx.isPaused() || ctx.isStopped()) return
      const now = Date.now()
      if (now - lastTime < 500) return
      lastTime = now

      if (ctx.getNewVisibleElements().hasNew) {
        ctx.reload()  // 重新执行 input → AI → output
      }
    })

    return {
      prompt: `翻译为${ctx.userText || '中文'}：\n${elements.text}`,
      system: '你是专业翻译，保持原文格式，只返回翻译结果。',
      data: { elements }
    }
  },

  async output(ctx, aiResult, inputData) {
    ctx.replaceElements(inputData.data.elements, aiResult)
    ctx.showLog('翻译完成')
  }
})
```

### 总结技能（一次性）

```typescript
import { defineSkill } from '../defineSkill'

export default defineSkill({
  name: 'summarize',
  trigger: '/总结',
  description: '总结当前页面',
  icon: '📝',

  async input(ctx) {
    const elements = ctx.getVisibleElements()
    return {
      prompt: `总结以下内容${ctx.userText ? '，' + ctx.userText : ''}：\n${elements.text}`,
      system: '简洁明了地总结要点。',
      data: { elements }
    }
  },

  async output(ctx, aiResult, inputData) {
    ctx.showLog('总结结果：')
    ctx.showLog(aiResult)
  }
})
```

### 提取技能

```typescript
import { defineSkill } from '../defineSkill'

export default defineSkill({
  name: 'extract',
  trigger: '/提取',
  description: '提取页面信息',
  icon: '📋',

  async input(ctx) {
    const elements = ctx.getVisibleElements()
    return {
      prompt: `${ctx.userText || '提取关键信息'}：\n${elements.text}`,
      data: { elements }
    }
  },

  async output(ctx, aiResult, inputData) {
    ctx.showLog('提取结果：')
    ctx.showLog(aiResult)
  }
})
```

---

## 命令系统

| 命令 | 功能 |
|------|------|
| `/技能名` | 启动技能 |
| `/技能名 描述` | 启动技能 + 用户描述 |
| `/stop` | 停止当前技能 |
| `/pause` | 暂停当前技能 |
| `/resume` | 恢复当前技能 |
| `/list` | 列出所有技能 |
| `/help` | 显示帮助 |
| `/help 技能名` | 显示技能帮助 |

---

## 注意事项

1. **防抖**：滚动监听需自己处理防抖（参考翻译技能示例）
2. **状态检查**：在 onScroll 中检查 `ctx.isPaused()` 和 `ctx.isStopped()`
3. **重新触发**：滚动时用 `ctx.reload()` 触发完整流程，不要直接调用 `ctx.ai.chat()`
4. **自动清理**：通过 ctx 注册的监听器会自动清理，无需手动处理
5. **自动恢复**：引擎停用技能时会自动调用 `ctx.restoreOriginal()` 恢复原始内容
