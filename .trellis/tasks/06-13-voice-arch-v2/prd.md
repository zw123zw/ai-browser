# 意图检测架构：语音/文字双模式统一输入路由

## Goal

将语音模式和文字模式统一为一套输入路由 + 两阶段 AI 意图检测架构，实现三路分流（聊天/技能/浏览器指令）。

**本文档只覆盖：输入路由和意图检测的架构流程。**
- 浏览器命令执行（骨架提取、执行引擎、重试、跨页面）→ `06-14-browser-command-arch/prd.md`
- 技能工作流引擎（defineSkill、context、engine、registry）→ `06-14-skill-workflow-arch/prd.md`

---

## 一、整体架构

```
用户输入（语音 / 文字）
    │
    ▼
┌─────────────────────────────────────────────┐
│  InputRouter（输入路由器）                    │
│                                             │
│  /翻译 中文 → 直接执行技能（零 AI）          │
│  /stop → 停止当前技能                        │
│  非 / 开头 → 进入 Phase 1                    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│  Phase 1: 意图检测 + 直接决策（轻量模型）      │
│                                             │
│  输入：仅用户文本（无骨架、无技能列表）        │
│                                             │
│  输出：                                      │
│    [chat]{"text":"..."}[/chat]  → 直接回复   │
│    [command]{"action":"..."}    → 直接执行    │
│    [skill]{"name":"..."}        → 直接执行    │
│    [action]                     → 进 Phase 2 │
└─────────────────────────────────────────────┘
    │
    ├── [chat]    → 显示/播报 → 结束
    ├── [command] → 执行浏览器指令 → 结束
    ├── [skill]   → 执行技能工作流 → 结束
    │
    └── [action] ↓
┌─────────────────────────────────────────────┐
│  Phase 2: 操作决策（主力模型）                │
│                                             │
│  输入：用户描述 + 页面骨架 + 技能列表         │
│                                             │
│  输出：                                      │
│    [skill]{"name":"..."}       → 执行技能    │
│    [command]{"action":"..."}   → 执行指令    │
│    [need_html]{"query":"..."}  → 局部HTML兜底│
└─────────────────────────────────────────────┘
    │
    ▼
  分流执行（详见各专项文档）
```

### Token 消耗对比

| 场景 | AI 调用 | Token | 说明 |
|------|---------|-------|------|
| `/翻译 中文` | 0 次 | 0 | 字符串分割 |
| 纯聊天 "你好" | 1 次 | ~300 | Phase 1 直接回复 |
| 明确指令 "打开B站" | 1 次 | ~300 | Phase 1 直接返回 [command] |
| 明确技能 "翻译" | 1 次 | ~300 | Phase 1 直接返回 [skill] |
| 需页面上下文 "点击登录" | 2 次 | ~2000 | Phase 1 [action] → Phase 2 |

### 模型选择策略

| 阶段 | 选择 | 原因 |
|------|------|------|
| Phase 1 | 用户配置的轻量模型 | 分类 + 简单指令，不需强推理 |
| Phase 2 | 用户配置的主力模型 | 理解骨架 + 匹配技能 + 生成指令 |
| `/技能` 命令 | 无 AI | 字符串分割 |

> 模型由用户在扩展设置中配置，不写死。

---

## 二、InputRouter（输入路由器）

### 职责

接收语音/文字输入，唯一预处理是 `/` 命令解析（字符串 split），其余全部交给 AI。

### 实现

```typescript
// src/input/router.ts

export class InputRouter {
  private intentDetector: IntentDetector
  private skillRegistry: SkillRegistry

  async route(ctx: InputContext): Promise<InputResult> {
    // / 前缀 → 确定性解析，不走 AI
    if (ctx.text.startsWith('/')) {
      const parsed = this.parseSlashCommand(ctx.text)
      if (parsed.isBuiltin) return this.handleBuiltinCommand(parsed.command, parsed.args)
      if (parsed.isSkill) return { type: 'skill', skillName: parsed.command, skillUserText: parsed.args }
    }

    // 其余 → AI 意图检测
    return this.intentDetector.detect(ctx)
  }

  private parseSlashCommand(text: string): SlashCommandResult {
    const match = text.match(/^\/(\S+)\s*(.*)/)
    if (!match) return { isCommand: false, isSkill: false, isBuiltin: false, command: '', args: '' }
    const command = match[1]
    const args = match[2].trim()
    const BUILTIN = ['stop', 'pause', 'resume', 'list', 'help']
    return {
      isCommand: true,
      isBuiltin: BUILTIN.includes(command),
      isSkill: !BUILTIN.includes(command) && this.skillRegistry.has(command),
      command,
      args,
    }
  }
}
```

---

## 三、Phase 1: 意图检测 + 直接决策

### 职责

接收纯用户文本，**能处理就直接处理，处理不了才返回 [action] 进 Phase 2**。

### 判断逻辑

| 用户说 | Phase 1 输出 | 原因 |
|--------|-------------|------|
| "你好" | [chat] | 聊天 |
| "打开B站" | [command] navigate | URL 已知，不需要页面信息 |
| "搜索Vue教程" | [command] search | 全网搜索不需要定位元素 |
| "翻译" | [skill] 翻译 | 明确匹配技能触发词 |
| "点击登录按钮" | [action] | 需要骨架定位元素 |
| "帮我翻译这个页面" | [action] | 需要确认技能列表 |

### System Prompt

```
你是智能助手，负责判断用户意图并给出响应。

规则：
1. 聊天/闲聊/提问 → [chat]{"text":"你的回复"}[/chat]
2. 不需要页面上下文的操作（打开已知网站、全网搜索）→ [command]{"action":"..."}[/command]
3. 明确匹配某个技能（翻译、总结等）→ [skill]{"name":"技能名","userText":"描述"}[/skill]
4. 需要页面元素定位 → [action]
5. 所有输出必须用标签包裹，内容为JSON

示例:
- "你好" → [chat]{"text":"你好！有什么可以帮你的？"}[/chat]
- "打开B站" → [command]{"action":"navigate","url":"https://www.bilibili.com","description":"打开B站"}[/command]
- "翻译这个页面" → [skill]{"name":"翻译","userText":"这个页面"}[/skill]
- "帮我点登录按钮" → [action]
```

### 不需要重试

Phase 1 任务简单，即使判断错误也不会造成严重后果。格式异常时默认当作 [action] 进 Phase 2。

---

## 四、Phase 2: 操作决策

### 职责

接收用户描述 + 页面骨架 + 技能列表，决定执行方式：触发技能 or 生成浏览器指令。

### System Prompt（骨架格式、技能列表格式、能力域详见各专项文档）

```
你是浏览器操作助手。根据用户意图、页面骨架和可用技能，决定执行方式。

规则：
1. 有匹配技能 → 必须返回 [skill]{"name":"...","userText":"..."}[/skill]，不要返回浏览器指令
2. 无匹配技能 → 返回 [command]{"action":"..."}[/command]
3. 骨架找不到目标 → [need_html]{"query":"...","reason":"..."}[/need_html]
4. 所有输出必须用 [标签名]JSON[/标签名] 格式包裹

可执行技能工作流:
{skillList}

浏览器操作能力域:
click / type / clear / scroll / navigate / select / keyboard / focus / hover / wait
```

### Prompt 组合

```
系统 Prompt（含 {skillList} 占位符）
    +
用户消息:
  - 历史对话（最近 3 轮）
  - 当前用户描述
  - 页面语义骨架 JSON（详见 browser-command-arch）
  - 重试时附带：上次回复 + 错误原因 + 最新骨架
```

### 重试机制

Phase 2 解析失败或执行失败时，重试最多 3 次，每次带最新骨架和错误原因。详见 `06-14-browser-command-arch/prd.md`。

---

## 五、统一处理流水线

### 职责

串联 InputRouter → Phase 1 → Phase 2 → 分流执行。

### 实现

```typescript
// src/input/pipeline.ts

export class InputPipeline {
  async process(ctx: InputContext, callbacks: PipelineCallbacks): Promise<void> {
    // 1. 路由（/ 命令）
    const routeResult = await this.router.route(ctx)
    if (routeResult.type === 'skill') {
      await this.skillEngine.activate(routeResult.skillName!, routeResult.skillUserText || '')
      return
    }

    // 2. Phase 1
    const p1 = await this.phase1(ctx.text)
    if (p1.chat) { callbacks.onChatMessage(p1.chat); return }
    if (p1.commands?.length) { await this.executeCommands(p1.commands, ctx.mode); return }
    if (p1.skill) { await this.skillEngine.activate(p1.skill.name, p1.skill.userText); return }

    // 3. Phase 2（Phase 1 返回 [action]）
    const p2 = await this.phase2(ctx.text)
    if (p2.skill) { await this.skillEngine.activate(p2.skill.name, p2.skill.userText); return }
    if (p2.commands?.length) { await this.executeCommands(p2.commands, ctx.mode); return }
    if (p2.needHtml) { await this.handleNeedHtml(p2.needHtml, ctx, callbacks); return }
  }
}
```

---

## 六、目录结构

```
src/
├── input/                    # 统一输入处理层
│   ├── types.ts              # 类型定义
│   ├── router.ts             # 输入路由器（/命令解析）
│   ├── intent-detector.ts    # Phase 1 + Phase 2 AI 调用
│   ├── pipeline.ts           # 统一处理流水线
│   └── tag-parser.ts         # AI 标签解析
├── voice/                    # 语音相关
│   ├── broadcast.ts          # TTS 播报
│   ├── recognition.ts        # Web Speech API
│   ├── sherpa-recognition.ts # Sherpa 本地识别
│   └── session.ts            # 语音会话（重构接入 InputPipeline）
├── browser/                  # 浏览器命令执行 → 06-14-browser-command-arch
└── skills/                   # 技能工作流引擎 → 06-14-skill-workflow-arch
```

---

## 七、Acceptance Criteria

- [ ] `/翻译 中文` 直接执行技能（零 AI）
- [ ] `/stop` 停止当前技能
- [ ] Phase 1 聊天 → [chat] → 直接回复
- [ ] Phase 1 明确指令 "打开B站" → [command] → 1 次 AI
- [ ] Phase 1 明确技能 "翻译" → [skill] → 1 次 AI
- [ ] Phase 1 需页面上下文 "点击登录" → [action] → Phase 2
- [ ] Phase 2 有技能时返回 [skill]，无技能时返回 [command]
- [ ] Phase 2 解析失败重试最多 3 次
- [ ] 语音/文字模式统一处理流程
- [ ] TypeScript 类型检查通过

---

## Decision (ADR-lite)

### 两阶段 vs 单阶段

**Decision**: 两阶段——Phase 1 轻量分类+直接决策，Phase 2 完整上下文决策
**Consequences**: 聊天/明确操作只需 1 次 AI，需页面上下文的操作才 2 次

### Phase 1 职责范围

**Decision**: Phase 1 能处理就直接处理，处理不了才返回 [action]
**Consequences**: "打开B站"等明确操作延迟和 token 减半

### 意图检测方式

**Decision**: 全部交给 AI，不用关键词预匹配
**Consequences**: 更准确，每次都有 AI 消耗，但 / 前缀命令可跳过

### 技能优先级

**Decision**: 有匹配技能时 AI 必须返回 [skill]，不能返回浏览器指令
**Consequences**: 保证技能工作流的确定性
