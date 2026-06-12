# 纯语音交互模式 + 全局日志系统

## Goal

改造 VoicePanel 为纯语音交互界面（无文字输入框），实现完整的"说话→识别→处理→播报"闭环。同时在整个项目中加入统一日志系统，方便排查问题。

---

## 核心流程图

```
┌─────────────────────────────────────────────────────────────┐
│                    语音模式完整循环                            │
│                                                             │
│   ① 等待指令 ──→ ② 语音识别(STT) ──→ ③ 显示识别文字          │
│        ↑                              │                     │
│        │                   置信度高? ──→ ④ 发送文字给 LLM      │
│        │                              │                     │
│        │                   置信度低? ──→ ⑤ 语音提示"没听清"    │
│        │                              │                     │
│        │                   识别失败? ──→ ⑤ 语音提示"请重说"    │
│        │                              │                     │
│        │                              ↓                     │
│        │                      ⑥ LLM 返回结果                 │
│        │                              │                     │
│        │                      ┌───────┴───────┐             │
│        │                      │               │             │
│        │                 是自动化指令?    是对话回复?           │
│        │                      │               │             │
│        │                      ↓               ↓             │
│        │               ⑦ 执行网页操作   ⑧ 语音播报AI回复      │
│        │                      │               │             │
│        │                      └───────┬───────┘             │
│        │                              │                     │
│        │                      ⑨ 语音播报结果                  │
│        │                              │                     │
│        └──────────────────────────────┘                     │
│                  (连续模式自动循环)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 一、语音识别层（STT）设计方案

**使用 Web Speech API**，当前代码已有 `VoiceRecognition` 类，需要增强置信度输出。

### 置信度阈值设计

| 置信度范围 | 处理方式 | 示例 |
|-----------|---------|------|
| `confidence >= 0.8` | 高置信度，直接处理 | "打开B站" → 直接执行 |
| `0.6 <= confidence < 0.8` | 中置信度，语音确认 | "你是说 搜索手机 吗？" |
| `confidence < 0.6` | 低置信度，语音提示重说 | "没听清，请再说一次" |
| 识别失败(no-speech/error) | 语音提示 | "没有检测到语音，请再说" |

### VoiceRecognition 改动

当前 `onResult` 回调签名：`(text: string, isFinal: boolean) => void`

改为：`(text: string, isFinal: boolean, confidence: number) => void`

在 `recognition.onresult` 中提取 `result[0].confidence` 并传递。

---

## 二、语音播报层（TTS）设计方案

**使用 Web Speech Synthesis API**，当前代码**完全没有 TTS 能力**，需要新增 `src/voice/broadcast.ts`。

### VoiceBroadcast 类设计

```typescript
class VoiceBroadcast {
  // 播报文字（中文）
  speak(text: string): Promise<void>

  // 播报优先级：系统提示 > AI回复 > 操作结果
  // 高优先级打断低优先级

  // 取消当前播报
  cancel(): void

  // 播报完成后回调（触发下一轮监听）
  onEnd: () => void
}
```

### 播报时机一览

| 场景 | 播报内容 | 示例 |
|------|---------|------|
| 开始监听 | "请说出指令" | |
| 识别成功（高置信度） | 不播报（直接显示文字处理） | |
| 置信度中 | "你是说 XXX 吗？" | "你是说 搜索手机 吗？" |
| 置信度低 | "没听清，请再说一次" | |
| 识别失败 | "没有检测到语音，请再说" | |
| 执行成功 | "已为你打开B站" | |
| 搜索中 | "正在搜索 手机" | |
| AI 对话回复 | 直接播报 AI 回复文字 | |
| 指令不支持 | "不支持这个操作" | |

### 语音模式 AI Prompt 设计

语音模式下发送给 LLM 的系统提示需要特殊处理：

```
你是一个语音助手，用户通过语音和你对话。
请用简洁的口语化中文回复，适合语音播报，不要使用 Markdown 格式。
回复控制在 100 字以内。
```

> 关键点：语音模式下 AI 回复要**口语化**，不能有 Markdown、代码块、表格等不适合朗读的内容。

---

## 三、指令分发层设计方案

当前 `commandParser` 已经能区分**自动化指令**和**对话**，逻辑保持不变：

```
语音文字 → commandParser 解析
  ├── 匹配自动化指令 → 执行网页操作 → 语音播报结果
  └── 不匹配（普通对话）→ 发送给 LLM → 语音播报回复
```

自动化指令（8种）：open_site / search / site_search / open_item / page_next / page_prev / video_play / video_pause

非匹配文字自动作为对话发送给 LLM。

---

## 四、语音会话状态机设计方案

新增 `src/voice/session.ts`，管理完整的语音交互生命周期。

```
         ┌──────────┐
         │   IDLE   │ ← 初始/空闲
         └────┬─────┘
              │ 用户点击麦克风 / 连续模式自动触发
              ↓
         ┌──────────┐
         │ LISTENING │ ← 正在听
         └────┬─────┘
              │ 识别完成
              ↓
         ┌──────────┐
         │EVALUATING│ ← 评估置信度
         └────┬─────┘
              │
      ┌───────┼───────┐
      ↓       ↓       ↓
   高置信  中置信   低置信/失败
      │       │       │
      │       ↓       ↓
      │   语音确认  语音提示重说 ──→ 回到 LISTENING
      │       │
      ↓       ↓
         ┌──────────┐
         │PROCESSING│ ← 发给 LLM / 执行自动化
         └────┬─────┘
              │
              ↓
         ┌──────────┐
         │SPEAKING  │ ← 语音播报结果
         └────┬─────┘
              │ 播报完成
              ↓
        连续模式? ──Yes──→ 回到 LISTENING
              │
              No
              ↓
           IDLE
```

### 状态定义

| 状态 | 含义 | UI 表现 |
|------|------|---------|
| `IDLE` | 空闲，未启动 | 麦克风按钮普通态 |
| `LISTENING` | 正在聆听 | 麦克风按钮激活 + 波纹动画 |
| `EVALUATING` | 评估置信度 | 状态文字"正在分析..." |
| `PROCESSING` | LLM/自动化处理中 | 状态文字"处理中..." + 加载动画 |
| `SPEAKING` | 语音播报中 | 状态文字"播报中..." |

### session.ts 核心职责

1. 持有 `VoiceRecognition`、`VoiceBroadcast` 实例
2. 监听识别结果，评估置信度
3. 调用 `commandParser` 解析指令
4. 调用 adapter 发送 LLM 请求 / 调用自动化执行
5. 调用 broadcast 播报结果
6. 管理状态转换，确保流程正确
7. 处理连续模式的循环逻辑

---

## 五、VoicePanel UI 改造方案

### 当前 UI 问题
- 有消息列表 + 底部控制栏（残留文字模式设计）
- 没有语音播报
- 没有波纹动画

### 目标 UI 布局

```
┌────────────────────────────────┐
│  🎤 AI 语音助手     [连续] [×]  │
├────────────────────────────────┤
│                                │
│     ┌──────────────────┐       │
│     │   🎤 波纹动画     │       │
│     │   正在聆听...     │       │
│     └──────────────────┘       │
│                                │
│  ┌─ 识别文字 ──────────────┐   │
│  │ 搜索2026热门景点         │   │
│  └──────────────────────────┘   │
│                                │
│  ┌─ AI 回复 ───────────────┐   │
│  │ 正在为你搜索...           │   │
│  └──────────────────────────┘   │
│                                │
│  ┌─ 操作记录 ──────────────┐   │
│  │ ✅ 已打开百度搜索         │   │
│  │ 🎤 "请说出下一个指令"     │   │
│  └──────────────────────────┘   │
│                                │
│         [ 🎤 按住说话 ]         │
│                                │
└────────────────────────────────┘
```

### 关键 UI 变化

| 组件 | 变化 |
|------|------|
| 输入框 | ❌ 移除，语音模式不需要 |
| 消息列表 | ⚠️ 简化为操作记录流（识别文字 + AI回复 + 操作结果） |
| 麦克风按钮 | ✅ 新增大按钮，点击开始/停止识别 |
| 状态动画 | ✅ 新增语音波纹动画（聆听中） |
| 连续模式开关 | ✅ 保留 |
| 清空按钮 | ✅ 保留 |

### 波纹动画设计

聆听状态下，麦克风按钮周围显示扩散的圆形波纹：

```css
@keyframes voice-ripple {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}
```

3 层波纹交错播放，形成持续扩散效果。

---

## 六、全局日志系统设计方案

### Logger 类设计

新增 `src/utils/logger.ts`：

```typescript
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

class Logger {
  constructor(private module: string) {}

  debug(...args: unknown[]): void   // 灰色
  info(...args: unknown[]): void    // 蓝色
  warn(...args: unknown[]): void    // 黄色
  error(...args: unknown[]): void   // 红色
}

// 使用方式
const log = new Logger('Voice')
log.info('识别完成', { text, confidence })
log.error('LLM 请求失败', error)
```

### 日志格式

```
[14:32:05] [INFO] [Voice] 识别完成 { text: "打开B站", confidence: 0.92 }
[14:32:06] [ERROR] [Adapter] LLM 请求失败 HTTP 401
```

### 各模块日志点

| 模块 | 关键日志点 |
|------|-----------|
| `VoiceRecognition` | 启动、识别结果(含confidence)、错误、重启、停止 |
| `VoiceBroadcast` | 开始播报、播报完成、播报取消 |
| `VoiceSession` | 状态转换、置信度评估结果、指令解析结果 |
| `adapters/*` | 请求发起、URL/model、响应状态、错误详情、耗时 |
| `automation/actions` | 执行动作、参数、成功/失败、DOM 选择器命中 |
| `stores/conversations` | 创建会话、发送消息、流式 chunk、完成/错误 |
| `stores/settings` | 设置加载、设置更新 |
| `stores/voice` | 状态变化、消息添加 |
| `background.ts` | 收到消息、转发请求 |
| `content/index.ts` | Shadow DOM 创建、toggle 消息 |

---

## Requirements

### R1: 纯语音交互闭环
- 语音模式下**不出现任何输入框**，所有交互都是语音
- 流程：聆听 → 识别(STT) → 置信度评估 → 处理(LLM/自动化) → 播报(TTS) → 循环
- 连续模式下自动循环，无需手动操作

### R2: 语音识别置信度处理
- `confidence >= 0.8`：高置信度，直接处理
- `0.6 <= confidence < 0.8`：中置信度，语音确认"你是说 XXX 吗？"
- `confidence < 0.6`：低置信度，语音提示"没听清，请再说一次"
- 识别失败(no-speech/error)：语音提示"没有检测到语音，请再说"

### R3: 语音播报(TTS)
- 使用 Web Speech Synthesis API
- 所有系统提示、AI 回复、操作结果都通过语音播报
- 播报完成后再进入下一轮聆听（避免打断）
- AI 回复 prompt 口语化：简洁、无 Markdown、100 字以内

### R4: VoicePanel UI 改造
- 移除输入框，纯语音界面
- 大麦克风按钮（点击开始/停止）
- 语音波纹动画（聆听中）
- 显示识别文字 + AI 回复 + 操作记录
- 连续模式开关保留

### R5: 全局日志系统
- 新增 `src/utils/logger.ts`，统一日志工具
- 支持级别：DEBUG / INFO / WARN / ERROR
- 带模块前缀：`[Voice]` `[Adapter]` `[Automation]` `[Store]` 等
- 带时间戳
- 所有模块关键路径写入日志

## Acceptance Criteria

- [ ] VoicePanel 无输入框，纯语音交互
- [ ] 语音识别后有置信度评估，低置信度语音提示重说
- [ ] 所有系统/AI/操作结果都有语音播报
- [ ] 播报完成后自动进入下一轮聆听
- [ ] 麦克风按钮有波纹动画
- [ ] Logger 在所有模块关键路径有日志输出
- [ ] `npm run dev` 无报错
- [ ] TypeScript 类型检查通过

## Technical Approach

### 新增文件
| 文件 | 作用 |
|------|------|
| `src/utils/logger.ts` | 统一日志系统 |
| `src/voice/broadcast.ts` | TTS 语音播报封装 |
| `src/voice/session.ts` | 语音会话状态机 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `src/voice/recognition.ts` | onResult 回调增加 confidence 参数 |
| `src/stores/voice.ts` | 增加播报状态、置信度字段 |
| `entrypoints/content/components/VoicePanel.vue` | 大改：纯语音 UI + 波纹动画 |
| `src/styles/global.css` | 新增语音动画样式 |
| `src/adapters/*.ts` | 加日志 |
| `src/automation/actions.ts` | 加日志 |
| `src/stores/*.ts` | 加日志 |
| `entrypoints/background.ts` | 加日志 |

## Out of Scope

- Firefox 特殊适配
- 移动端浏览器
- 离线语音识别
- 语音唤醒词
- 讯飞/Ollama adapter（后续单独做）

## Technical Notes

- Web Speech API confidence 在 `event.results[i][0].confidence`，范围 0-1
- Web Speech Synthesis: `window.speechSynthesis.speak(utterance)`
- TTS 完成事件：`utterance.onend`
- 语音模式 AI prompt 需要特殊系统提示（口语化、简短）
- 当前 VoiceRecognition 已有 `SpeechRecognitionAlternative` 接口定义（含 confidence 字段），只需在回调中传递
