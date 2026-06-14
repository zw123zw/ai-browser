# AI 驱动语音指令架构

## Goal

将语音交互架构升级为「AI 理解 + 扩展执行」模式：用户语音 → AI 从页面语义骨架中定位元素 → 返回结构化 action → 扩展执行。支持跨页面连续指令、执行失败重试、开放型 action 能力域。

核心设计：
1. **语义骨架提取** — 不发原始 HTML，提取 JSON 骨架（节省 70-80% token）
2. **AI 负责理解，扩展负责执行** — AI 返回结构化 action，扩展翻译为浏览器操作
3. **开放型 action** — AI 在声明的能力域内自由组合，不局限于固定指令
4. **跨页面连续指令** — 会话状态在 Background，页面导航不丢失
5. **双重定位 + 重试** — elementId + fallbackSelector，执行失败自动重试 3 次

---

## 一、整体架构

```
┌───────────────────────────────────────────────────────┐
│                   Background (核心)                     │
│                                                       │
│  ┌────────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ 会话状态机  │  │ AI 调用   │  │ 指令队列执行引擎 │  │
│  │ (不随页面   │  │ (骨架+    │  │ (顺序执行+       │  │
│  │  导航丢失)  │  │  用户指令) │  │  页面导航感知)   │  │
│  └────────────┘  └───────────┘  └──────────────────┘  │
│       ↑              ↑               ↑                │
└───────┼──────────────┼───────────────┼────────────────┘
        │              │               │
        ↓              ↓               ↓
┌───────────────────────────────────────────────────────┐
│              Content Script (页面端)                    │
│                                                       │
│  ┌──────────────────┐  ┌──────────────────┐           │
│  │ 语义骨架提取      │  │ Action 执行器    │           │
│  │ (JSON 结构化)    │  │ (开放型 action)  │           │
│  └──────────────────┘  └──────────────────┘           │
│                                                       │
│  页面 A ──导航──→ 页面 B ──导航──→ 页面 C              │
│  (content script 随页面销毁/重建，状态在 Background)    │
└───────────────────────────────────────────────────────┘
```

### 分工原则

**AI 的职责（语义层）：**
- 理解用户意图
- 从骨架中定位目标元素
- 决定操作类型和参数
- 返回结构化 action

**扩展的职责（执行层）：**
- 元素查找（elementId → fallbackSelector → 文本匹配）
- 等待元素出现（动态加载）
- 事件触发（完整 mouse/key 事件序列）
- 执行结果判定
- 失败重试 + 反馈给 AI

---

## 二、语义骨架提取

### 2.1 为什么不用原始 HTML

| 方式 | 大小 | tokens 估算 |
|------|------|------------|
| 原始清洗 HTML（当前方案） | 15-60KB | 4000-15000 |
| 语义骨架 JSON | 2-8KB | 500-2000 |
| **节省** | **70-85%** | |

原始 HTML 90% 是布局容器（div/span），对 AI 定位元素没有帮助。

### 2.2 提取规则

| 保留 | 提取内容 |
|------|---------|
| **可交互元素** | a / button / input / select / textarea / [onclick] / [role="button"] / [tabindex] |
| **文本内容** | h1-h6 / p / li / td / th / label / span（有直接文字的） |
| **表单元素** | input 的 type/name/placeholder/value |
| **地标元素** | nav / header / main / aside / footer / [role] |
| **媒体元素** | video / audio 的 src 和控件状态 |
| **父级上下文** | 保留 2-3 层父级，提供位置上下文 |

| 丢弃 |
|------|
| 纯布局 div/span（无文字、无交互、无语义 role） |
| 嵌套超过 3 层的中间容器 |
| SVG 图标（非交互的） |
| 空白节点、注释 |
| class/style（除非 data-testid 等定位属性） |

### 2.3 输出格式

```json
{
  "url": "https://www.bilibili.com",
  "title": "哔哩哔哩",
  "elements": [
    {"id": "e1", "tag": "a", "text": "首页", "href": "/", "parent": "nav"},
    {"id": "e2", "tag": "input", "type": "search", "placeholder": "搜索视频", "parent": "header"},
    {"id": "e3", "tag": "button", "text": "登录", "class": "login-btn"},
    {"id": "e4", "tag": "a", "text": "【热门】Vue教程入门到精通", "href": "/video/BV123"},
    {"id": "e5", "tag": "a", "text": "【推荐】React vs Vue 2024", "href": "/video/BV456"}
  ]
}
```

每个元素包含：
- `id` — 骨架中的唯一标识（用于 elementId 定位）
- `tag` — 标签名
- `text` — 可见文字（截断到 100 字符）
- `href` / `src` / `action` — 关键属性
- `type` / `name` / `placeholder` — 表单属性
- `role` / `aria-label` — 无障碍属性
- `parent` — 父级地标标签（提供位置上下文）

### 2.4 兜底机制：局部完整 HTML

骨架无法 100% 覆盖所有元素（div 做的按钮、图标按钮无文字、动态加载等）。

当 AI 在骨架中找不到目标时，可以请求局部完整 HTML：

```
AI 返回: [need_html]{"query":"登录按钮附近区域","reason":"骨架中未找到明确的登录入口"}[/need_html]
```

系统在 DOM 中搜索相关区域，提取该区域完整子树 HTML 发给 AI，AI 重新分析后给出精确指令。

**骨架保证效率（90% 一次命中），局部 HTML 保证准确性（10% 兜底）。**

---

## 三、AI 指令格式

### 3.1 指令标记

使用半角 `[command]`...`[/command]` 包裹，内容为 JSON：

```
[command]{"action":"click","elementId":"e3","fallbackSelector":".login-btn","description":"点击登录按钮"}[/command]
```

### 3.2 Action 能力域（开放型）

Prompt 中声明扩展支持的所有能力，AI 在范围内自由组合：

```
可执行操作：
- click: 点击元素
- type: 在输入框中输入文字
- clear: 清空输入框
- scroll: 滚动页面 (up/down/top/bottom)
- navigate: 打开新URL
- select: 选择下拉框选项
- keyboard: 模拟键盘 (Enter/Escape/Tab/ArrowUp/ArrowDown等)
- focus: 聚焦元素
- hover: 鼠标悬停
- wait: 等待指定毫秒

可组合多个操作，如: focus → type → keyboard(Enter)
```

### 3.3 Command JSON 结构

```typescript
interface Command {
  action: string           // 操作类型（AI 自由生成，在能力域内）
  elementId?: string       // 骨架中的元素 ID（主定位）
  fallbackSelector?: string // CSS 选择器（备选定位）
  text?: string            // type 操作的输入文字
  url?: string             // navigate 操作的目标 URL
  key?: string             // keyboard 操作的按键
  direction?: string       // scroll 操作的方向
  ms?: number              // wait 操作的等待时间
  description?: string     // 操作描述（日志用）
}
```

### 3.4 System Prompt

```
你是浏览器语音指令助手。根据用户语音和页面语义骨架，生成可执行的操作指令。

规则：
1. 所有可执行指令必须用 [command]...[/command] 包裹，内容为 JSON。
2. 多条指令按用户意图顺序排列，每条独立包裹。
3. 定位元素时优先用 elementId（骨架中的 id），同时提供 fallbackSelector 作为备选。
4. 如果骨架中找不到目标元素，返回 [need_html]{"query":"...","reason":"..."}[/need_html] 请求更多信息。
5. 若用户指令属于闲聊对话，直接输出简短口语回复（100字内，无 Markdown）。
6. 仅输出指令或对话，禁止多余解释。

可执行操作：click / type / clear / scroll / navigate / select / keyboard / focus / hover / wait
```

### 3.5 AI 输出示例

**场景 1：简单点击**
```
用户: "帮我点登录"
[command]{"action":"click","elementId":"e3","fallbackSelector":".login-btn","description":"点击登录"}[/command]
```

**场景 2：多步操作**
```
用户: "搜索Vue教程"
[command]{"action":"click","elementId":"e2","fallbackSelector":"input[type='search']","description":"聚焦搜索框"}[/command]
[command]{"action":"type","elementId":"e2","text":"Vue教程","description":"输入搜索关键词"}[/command]
[command]{"action":"keyboard","key":"Enter","description":"按回车搜索"}[/command]
```

**场景 3：跨页面操作**
```
用户: "打开B站搜索Vue教程点第一个视频"
[command]{"action":"navigate","url":"https://www.bilibili.com","description":"打开B站"}[/command]
[command]{"action":"wait","ms":2000,"description":"等待页面加载"}[/command]
[command]{"action":"type","fallbackSelector":"input.nav-search-input","text":"Vue教程","description":"输入搜索词"}[/command]
[command]{"action":"keyboard","key":"Enter","description":"搜索"}[/command]
[command]{"action":"wait","ms":2000,"description":"等待结果加载"}[/command]
[command]{"action":"click","fallbackSelector":"video-card:first-child a","description":"点击第一个视频"}[/command]
```

**场景 4：骨架找不到 → 请求局部 HTML**
```
用户: "点那个蓝色的下载按钮"
AI 骨架中没有明显匹配 →
[need_html]{"query":"下载按钮","reason":"骨架中未找到包含'下载'文字的按钮元素"}[/need_html]
→ 系统返回该区域完整 HTML →
[command]{"action":"click","fallbackSelector":".download-btn.blue","description":"点击蓝色下载按钮"}[/command]
```

---

## 四、执行引擎

### 4.1 元素查找策略（三重定位）

```
elementId 查找
    │
    ├── 找到 → 执行
    │
    └── 未找到
         │
         ↓
    fallbackSelector 查找
         │
         ├── 找到 → 执行
         │
         └── 未找到
              │
              ↓
         文本内容匹配（模糊搜索）
              │
              ├── 找到 → 执行
              │
              └── 未找到 → 返回失败原因
```

### 4.2 事件触发（完整序列）

不是简单调用 `.click()`，而是触发完整的浏览器事件序列：

```
click 操作:
  mousedown → mouseup → click
  如果是 <a> 标签，还需要处理 navigation

type 操作:
  focus → input 事件 → change 事件
  如果是 React/Vue 受控组件，需要触发 input 事件让框架感知

keyboard 操作:
  keydown → keypress → keyup
  需要正确的 key/code 值
```

### 4.3 执行结果判定

| Action | 成功判定 |
|--------|---------|
| click | 元素存在且可点击，触发事件无异常 |
| type | 输入框值已改变 |
| navigate | 页面开始导航（监听 beforeunload） |
| scroll | 页面滚动位置改变 |
| keyboard | 事件成功派发 |
| wait | 等待时间结束 |

---

## 五、重试机制

### 5.1 两种失败类型

| 失败类型 | 原因 | 重试方式 |
|---------|------|---------|
| **解析失败** | AI 返回格式错误，无法提取 [command] | 重发骨架 + 用户指令 + 错误格式说明 |
| **执行失败** | 元素不存在 / 页面变化 / 权限不足 | 重发骨架 + 原始指令 + 失败原因 + 请求新策略 |

### 5.2 重试流程

```
骨架 + 用户指令 → AI → [command] → 执行
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                  成功        解析失败    执行失败
                    │           │           │
                  完成         AI重试      AI重试
                             (格式错误)   (附带:
                              重发骨架     1. 原始 command
                              +用户指令    2. 失败原因
                                           3. 请求新策略)
                    两种重试共用 3 次上限
```

### 5.3 执行失败重试消息格式

```
上次指令: [command]{"action":"click","elementId":"e4"}[/command]
执行失败: 元素 e4 未找到（页面可能已滚动或动态加载）
当前页面骨架已更新（见下方）。
请根据新骨架重新定位目标元素，给出新的指令。
```

关键：**每次重试都带上最新骨架**，因为页面可能已经变化（滚动、动态加载、导航）。

---

## 六、跨页面连续指令

### 6.1 问题

当前会话状态在 VoicePanel（content script）中，页面导航 → content script 销毁 → 会话丢失。

### 6.2 解法：会话状态上移到 Background

```
VoicePanel (content script)
    │ 语音识别 + UI 显示
    ↓
Background (service worker)
    │ 会话状态机 + AI 调用 + 指令队列
    ↓
Content Script (每个页面)
    │ 骨架提取 + 指令执行
```

### 6.3 页面导航感知

```typescript
// Background 中监听页面加载
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // 只处理主框架
  if (!isSessionActive()) return;

  const nextStep = getNextPendingStep();
  if (nextStep?.action === 'wait' && nextStep.condition === 'page_loaded') {
    markStepComplete(nextStep);
    await injectContentScript(details.tabId);
    const skeleton = await getSkeletonFromTab(details.tabId);
    await executeNextStep(skeleton);
  }
});
```

### 6.4 多步骤指令队列

```typescript
interface StepQueue {
  steps: Command[]          // AI 返回的完整指令序列
  currentIndex: number      // 当前执行到第几步
  status: 'pending' | 'executing' | 'waiting_page' | 'completed' | 'failed'
  retryCount: number        // 当前步骤重试次数
}
```

执行流程：
1. AI 返回 N 条指令 → 入队
2. 逐条执行，每条等完成后再执行下一条
3. 遇到 `navigate` → 标记 `waiting_page` → 等 `onCompleted` → 继续
4. 遇到 `wait` → 延时后继续
5. 执行失败 → 重试（最多 3 次）→ 超限报错

---

## 七、TTS 播报

### 7.1 播报规则

| 场景 | 是否播报 | 内容 |
|------|---------|------|
| 轮次就绪 | ✅ | "请说出指令" |
| 识别失败 | ✅ | "没有检测到语音，请再说一次" |
| AI 纯对话 | ✅ | 直接播报 AI 回复 |
| 解析/执行失败（重试超限） | ✅ | "操作失败，请重新下达指令" |
| 指令执行中 | ❌ 静默 | — |
| 指令执行成功 | ❌ 静默 | — |

### 7.2 VoiceBroadcast 类

```typescript
class VoiceBroadcast {
  speak(text: string): Promise<void>
  cancel(): void
  destroy(): void
  onEnd: (() => void) | null
}
```

使用浏览器原生 SpeechSynthesis API。

---

## 八、状态机

### 8.1 四状态设计

| 状态 | 含义 | UI 表现 |
|------|------|---------|
| `IDLE` | 常驻等待 | 麦克风默认样式 |
| `LISTENING` | 聆听中 | 麦克风激活 + 波纹动画 |
| `PROCESSING` | AI 分析 + 执行 | 加载动画 |
| `SPEAKING` | 播报中（仅系统/错误/闲聊） | 播报状态文字 |

### 8.2 状态流转

```
              ┌──────────────────────────────────┐
              │                                  │
              ↓                                  │
       ┌──────────┐                              │
       │   IDLE   │                              │
       └────┬─────┘                              │
            │ 用户点击麦克风                       │
            ↓                                    │
       ┌──────────┐                              │
       │LISTENING │                              │
       └────┬─────┘                              │
            │                                    │
        ┌───┴───┐                                │
        │       │                                │
    识别失败  识别成功                             │
        │       │                                │
        ↓       ↓                                │
  SPEAKING  PROCESSING                            │
  "请再说"   │                                    │
        │     ├─── 纯对话 → SPEAKING(播报)        │
        │     ├─── 指令成功 → 静默执行            │
        │     └─── 失败 → 重试(≤3次)             │
        │              ├── 成功 → 静默执行        │
        │              └── 超限 → SPEAKING        │
        │                     ("操作失败")        │
        │                                        │
        └────────────────────────────────────────┘
                   自动回到 IDLE
```

---

## 九、VoicePanel UI

| 组件 | 变化 |
|------|------|
| 连续模式开关 | ❌ 移除（常驻等待） |
| 置信度显示 | ❌ 移除 |
| 消息记录区 | ✅ 保留（识别文字 + AI 对话 + 操作记录） |
| 麦克风按钮 + 波纹 | ✅ 保留 |
| 清空按钮 | ✅ 保留 |

---

## 十、全局日志系统

### Logger 类（已实现）

```typescript
const log = new Logger('Session')
log.info('执行指令', { action: 'click', elementId: 'e3' })
log.error('执行失败', { reason: '元素未找到', retry: 2 })
```

### 各模块日志点

| 模块 | 关键日志 |
|------|---------|
| `SkeletonExtractor` | 骨架提取开始、元素数量、耗时 |
| `CommandParser` | [command] 解析、每条指令内容、解析错误 |
| `Session` | 状态转换、AI 请求/响应、重试次数、指令执行顺序/结果、页面导航 |
| `ActionExecutor` | 元素查找（elementId/fallback/text）、事件触发、成功/失败 |
| `VoiceRecognition` | 启动、识别结果、错误 |
| `VoiceBroadcast` | 开始/完成/取消播报 |
| `adapters/*` | 请求发起、URL/model、响应状态、耗时 |

---

## 十一、实施方案

### Step 1: 语义骨架提取器
- 新增 `src/voice/skeleton.ts`
- 实现 `extractSkeleton(document): SemanticSkeleton`
- 遍历 DOM，按规则提取可交互+文本元素
- 输出 JSON 结构（带唯一 id）

### Step 2: 指令解析器重构
- 重构 `src/voice/commandParser.ts`
- 移除旧的 `【code】` 解析 + 8 种固定类型
- 新增 `[command]` JSON 解析
- 新增 `[need_html]` 请求解析

### Step 3: 执行引擎
- 新增 `src/voice/actionExecutor.ts`
- 实现三重元素定位（elementId → fallbackSelector → 文本匹配）
- 实现各 action 的事件触发（click/type/scroll/navigate/keyboard）
- 实现执行结果判定

### Step 4: 会话状态机重构
- 重构 `src/voice/session.ts`
- 会话逻辑移到 Background
- 实现指令队列 + 顺序执行
- 实现页面导航感知（chrome.webNavigation）
- 实现重试机制（解析失败 + 执行失败，共 3 次）

### Step 5: AI Prompt + 骨架发送
- 新增系统 Prompt（能力域声明 + 格式约束）
- 改造 `buildUserContent()`：骨架 JSON + 用户指令 + 历史上下文
- 实现 `[need_html]` 兜底：局部完整 HTML 提取

### Step 6: VoicePanel + voice.ts 清理
- 移除置信度相关代码
- 移除连续模式开关
- 适配新的 Background 会话架构

---

## Acceptance Criteria

- [ ] 语义骨架提取正确，可交互元素和文本内容不遗漏
- [ ] AI 返回的 `[command]` JSON 被正确解析
- [ ] 三重元素定位策略生效（elementId → fallbackSelector → 文本匹配）
- [ ] open 型 action 在能力域内正确执行
- [ ] 多条指令按顺序串行执行
- [ ] 跨页面连续指令不丢失（navigate → 等待加载 → 继续执行）
- [ ] 执行失败重试机制生效（最多 3 次，带最新骨架 + 失败原因）
- [ ] `[need_html]` 兜底机制生效（骨架找不到时请求局部 HTML）
- [ ] TTS 播报规则正确（闲聊/错误播报，指令执行静默）
- [ ] 状态机 4 状态流转正确，常驻等待
- [ ] Logger 覆盖所有关键路径
- [ ] TypeScript 类型检查通过

## Out of Scope

- Firefox 适配
- 移动端浏览器
- 离线语音识别
- 语音唤醒词
- 第三方模型/语音服务商适配

## Technical Notes

- `[command]` 使用半角括号，JSON 格式，不易与中文内容混淆
- 语义骨架 token 估算：500-2000（vs 原始 HTML 4000-15000，节省 70-80%）
- `chrome.webNavigation.onCompleted` 监听页面加载完成，用于跨页面指令衔接
- 多指令串行执行使用 `for...of` + `await`，顺序重要
- 元素查找优先用 elementId（快），fallbackSelector 兜底（容错）
- 事件触发需完整序列（mousedown→mouseup→click），不能只调 `.click()`
- Background 中的会话状态不随页面导航丢失
- `open_item` 参数从数字序号改为 elementId + fallbackSelector 双重定位

## Decision (ADR-lite)

**Context**: 原方案发送全量清洗 HTML（15-60KB）+ 固定 8 种指令类型 + 本地正则解析
**Decision**: 改为语义骨架 JSON（2-8KB）+ 开放型 action + AI 驱动指令 + 扩展执行
**Consequences**:
- Token 消耗降低 70-80%
- 指令灵活性大幅提升
- 需要实现骨架提取器和 Action 执行器
- 需将会话状态从 content script 迁移到 Background
