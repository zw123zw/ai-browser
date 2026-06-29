# 语音播报增强与Action支持

## Goal

增强语音播报系统，支持更多action类型的播报，优化播报条件和内容，并改进自动笔记的触发方式。当第三方语音引擎API调用出错时，错误信息需要播报并在聊天区域显示。

## What I already know

* 项目使用 VoiceBroadcast 类（`src/voice/broadcast.ts`）封装浏览器原生 SpeechSynthesis API
* VoiceManager（`src/voice/voice-manager.ts`）管理语音状态机：IDLE -> WAKE -> COMMAND -> PROCESSING -> SPEAKING
* 当前TTS播报条件：`enableTts` 为 true 且文本非空
* 翻译功能有三种模式：划词翻译、自动翻译、点击翻译
* 笔记功能有四种模式：selection、click、auto、off
* 自动笔记当前在页面加载/导航时自动触发（`entrypoints/content/index.ts` 的 `runAutoNote()`）
* 意图检测器（`src/input/intent-detector.ts`）通过 Phase 1 和 Phase 2 分类输入为 chat 或 action
* 当前支持的action类型：click、type、scroll、navigate、summarize 等
* 第三方语音引擎包括：Web Speech API 和讯飞WebSocket引擎
* 错误处理：引擎错误通过 `onError` 回调处理，但未播报

## Assumptions (temporary)

* 用户希望在语音助手面板打开或常驻语音开启时才进行播报
* 翻译和笔记功能需要被识别为独立的action类型
* 自动笔记应该改为用户主动触发（发送 `/note` 命令）
* 每种action需要明确播报内容（原文 vs 提取结果）

## Open Questions

* **播报条件**：如何判断"语音助手面板打开"或"常驻语音开启"状态？
* **播报内容**：每种action应该播报什么内容？（原文、提取结果、摘要等）
* **翻译action**：翻译action需要什么样的页面骨架？
* **笔记action**：笔记action需要什么样的页面骨架？
* **错误播报**：语音引擎API错误应该如何播报？（语音+文字同时显示？）

## Requirements (evolving)

### 1. 语音引擎API错误播报
* 当第三方语音引擎API调用出错时，错误信息需要播报并在聊天区域显示
* 错误信息通过 `VoiceManager.speak()` 播报
* 错误信息同时显示在聊天区域（status: 'error'）

### 2. 翻译和笔记作为action触发
* 增加 `translate` 和 `note` 两个action到 `CAPABILITY_DOMAIN_LIST`
* 这些action只是触发现有功能，不修改显示逻辑
* 语音和文字命令都可以触发（"翻译这个页面" / `/translate`，"记笔记" / `/note`）
* 复用现有 `TranslateService.translateVisible()` 和 `optimizeAsNoteStream()` 实现

### 3. 播报范围扩展
| Action | 播报内容 |
|--------|----------|
| 分析总结（summarize） | 播报AI的分析结果 |
| 翻译（translate） | 播报翻译结果 |
| 笔记（note） | 播报笔记内容（AI优化后的笔记） |
| 提取数据（download） | 播报"数据提取完成"（简短提示） |
| [need_input] | 保持现在不变（播报"请提供输入"） |

### 4. 播报条件
**播报触发条件（OR关系）：**
- 条件1：侧边栏抽屉打开 **且** 处于语音助手界面模式
- 条件2：`VoiceSettings.alwaysOnVoice` 设置为 true

**不播报场景：**
- 侧边栏抽屉关闭
- 侧边栏抽屉打开但处于文字模式
- `alwaysOnVoice` 为 false 且侧边栏未打开

### 5. 自动笔记触发方式
* 改为用户发送 `/note` 命令触发
* 不再在页面加载时自动触发

## Acceptance Criteria (evolving)

* [ ] 语音引擎API错误能够语音播报并在聊天区域显示
* [ ] 翻译功能能够作为action被识别和执行（`translate` action）
* [ ] 笔记功能能够作为action被识别和执行（`note` action）
* [ ] 播报范围包含：分析总结、翻译、笔记、提取数据、[need_input]
* [ ] 播报仅在语音助手面板打开或常驻语音开启时触发
* [ ] 自动笔记通过用户发送 `/note` 命令触发

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 不修改现有的翻译/笔记显示逻辑
* 不为翻译/笔记创建新的骨架系统
* 不修改自动翻译/笔记的触发逻辑（只增加命令触发入口）

## Technical Approach

### 1. 语音引擎API错误播报
* 在 `VoiceManager` 中捕获引擎错误
* 调用 `speak()` 播报错误信息
* 同时将错误信息添加到聊天区域（status: 'error'）

### 2. 翻译和笔记作为action触发
* 在 `CAPABILITY_DOMAIN_LIST` 中增加 `translate` 和 `note` 两个能力
* 在 `InputPipeline.processPhase2WithRetry()` 中增加这两个action的处理逻辑
* `translate` action：调用 `TranslateService.translateVisible()`
* `note` action：调用 `optimizeAsNoteStream()`

### 3. 播报范围扩展
* 在 `InputPipeline` 中，action执行完成后调用播报
* 根据action类型选择播报内容：
  - summarize：播报AI分析结果
  - translate：播报翻译结果
  - note：播报笔记内容
  - download：播报"数据提取完成"
  - [need_input]：播报"请提供输入"

### 4. 播报条件判断
* 在 `VoiceManager.speak()` 中增加条件判断
* 检查侧边栏抽屉状态和语音助手界面模式
* 检查 `VoiceSettings.alwaysOnVoice` 设置
* 只有满足条件时才播报

### 5. 自动笔记触发方式
* 移除页面加载时自动触发的逻辑
* 增加 `/note` 命令的处理逻辑

## Technical Notes

* 语音播报核心：`src/voice/broadcast.ts` 和 `src/voice/voice-manager.ts`
* 翻译服务：`src/browser/translate-service.ts`
* 笔记服务：`src/browser/note-service.ts`
* 意图检测：`src/input/intent-detector.ts`
* 输入管线：`src/input/pipeline.ts`
* Action执行器：`src/browser/action-executor.ts`
* 能力域定义：`src/input/prompts/common.ts`
