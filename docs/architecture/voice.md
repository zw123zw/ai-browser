# Voice Module

## 模块概述

语音模块实现完整的语音交互生命周期：语音识别 -> AI 指令解析 -> 自动化执行 -> 语音播报。支持双引擎识别（Web Speech API + Sherpa-ONNX WASM 本地识别），通过 AI 驱动的指令解析替代传统正则匹配，实现更灵活的语音控制。

**源文件**:
- `src/voice/recognition.ts` - Web Speech API 识别封装
- `src/voice/sherpa-recognition.ts` - Sherpa-ONNX 本地识别
- `src/voice/broadcast.ts` - TTS 语音播报
- `src/voice/session.ts` - 语音会话状态机
- `src/voice/commandParser.ts` - AI 指令解析器

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    Voice Session                         │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              State Machine                        │  │
│  │  IDLE -> LISTENING -> PROCESSING -> SPEAKING -> IDLE│ │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ Recognition │  │   AI Call    │  │   Broadcast   │  │
│  │             │  │             │  │               │  │
│  │ Web Speech  │  │ adapter.chat│  │ Speech Synth  │  │
│  │ Sherpa-ONNX │  │ + retry     │  │ speak(text)   │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────────┘  │
│         │                │                              │
│  ┌──────▼──────┐  ┌──────▼──────┐                      │
│  │ onResult    │  │ parseBatch  │                      │
│  │ handleResult│  │ Command     │                      │
│  └─────────────┘  └─────────────┘                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Command Execution                    │   │
│  │  executeAutomation(action, params) -> content script│ │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 核心类型定义

```typescript
// 语音识别状态
type VoiceStatus = 'idle' | 'listening' | 'processing' | 'error';

// 会话状态（扩展了识别状态）
type SessionState = 'idle' | 'listening' | 'processing' | 'speaking';

// 指令类型
type CommandType =
  | 'open_site'    // 打开网站
  | 'search'       // 全网搜索
  | 'site_search'  // 站内搜索
  | 'open_item'    // 点击第N个结果
  | 'page_next'    // 下一页
  | 'page_prev'    // 上一页
  | 'video_play'   // 播放视频
  | 'video_pause'; // 暂停视频

// 指令信息
interface CommandInfo {
  type: CommandType;
  params: string;
}

// 批量解析结果
interface BatchParseResult {
  total: number;
  commandList: CommandInfo[];
  hasError: boolean;
  errorMsg?: string;
  plainText?: string;  // 无指令标记时的纯对话文本
}
```

## 实现细节

### VoiceRecognition (Web Speech API)

基于浏览器原生 `SpeechRecognition` API 的封装：

**自动重启机制**:
- `no-speech` / `audio-capture` 错误 -> 1s 后重启
- `network` 错误 -> 3s 后重启（Chrome 语音识别依赖 Google 服务）
- 其他错误 -> 2s 后重启
- `not-allowed` (麦克风权限) -> 停止，不重启
- `onend` 事件 -> 连续模式下 300ms 后自动重启

**配置**: `lang='zh-CN'`, `continuous=true`, `interimResults=true`, `maxAlternatives=1`

**状态管理**: `start()` -> `listening`, `stop()` -> `idle`, `pause()` -> `processing`

### SherpaRecognition (Sherpa-ONNX WASM)

完全离线的本地语音识别：

**音频管道**:
1. `navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })`
2. `AudioContext({ sampleRate: 16000 })`
3. `createMediaStreamSource(stream)`
4. `createScriptProcessor(4096, 1, 1)` -> `onaudioprocess` 回调
5. `recognizer.acceptWaveform(16000, samples)` 喂入识别器
6. `recognizer.getResult()` 获取识别结果

**模型**: `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`（中英双语流式 zipformer 模型）

**去重**: 记录 `lastText`，避免重复回调相同结果

### VoiceBroadcast (TTS 播报)

基于 `SpeechSynthesisUtterance` 的语音播报：

- `speak(text)` 返回 Promise，播报完成时 resolve
- 播报前自动 `cancel()` 当前播报（新播报打断旧播报）
- 配置: `lang='zh-CN'`, `rate=1.0`, `volume=1.0`
- 回调: `onStart`, `onEnd`

### VoiceSession (状态机)

管理完整的语音交互生命周期：

**状态转换**:
```
IDLE -> LISTENING (start/resume)
LISTENING -> PROCESSING (识别完成，开始 AI 分析)
PROCESSING -> SPEAKING (AI 返回对话文本)
PROCESSING -> LISTENING (指令执行完毕)
SPEAKING -> IDLE (播报完成，broadcast.onEnd)
```

**常驻循环**: `broadcast.onEnd` 回调中自动调用 `toListening()`，实现持续监听

**引擎选择**: 优先 Sherpa-ONNX 本地识别，失败时回退到 Web Speech API

**AI 调用 + 重试 (processWithRetry)**:

1. 构建 userContent：历史对话 + 当前语音 + 页面 URL + 页面 HTML
2. 调用 `adapter.chat()` 获取 AI 输出
3. `parseBatchCommand()` 解析指令
4. 解析成功 -> 返回指令列表
5. 纯对话 -> 返回对话文本
6. 解析失败 -> 将 AI 输出 + 错误信息附加到下一次请求（让 AI 自我修正）
7. 最多重试 3 次 (MAX_RETRY)

**系统 Prompt**: 根据 `settings.automationEnabled` 动态选择：
- 开启自动化: `COMMAND_SYSTEM_PROMPT`（包含 8 种指令格式说明）
- 关闭自动化: `CHAT_ONLY_SYSTEM_PROMPT`（纯聊天模式）

**多指令串行执行**: `executeCommandList()` 按顺序逐条执行，失败不中断后续指令

### CommandParser (指令解析)

解析 AI 输出中的 `【code】...【/code】` 标记：

**批量解析流程**:
1. 按 `【/code】` 分割文本
2. 过滤包含 `【code】` 的块
3. 逐条提取指令内容（`:` 分隔类型和参数）
4. 验证指令类型（8 种合法类型）
5. 验证参数（无参指令不需要参数）

**无指令标记**: 判定为纯对话，返回 `plainText`

**合法指令类型**:
- 需要参数: `open_site`, `search`, `site_search`, `open_item`
- 无参指令: `page_next`, `page_prev`, `video_play`, `video_pause`

## 数据流

```
用户说出语音
    │
    ▼
VoiceRecognition / SherpaRecognition
    │ onResult(text, isFinal, confidence)
    ▼
VoiceSession.handleResult()
    │ isFinal -> processCommand(text)
    ▼
VoiceSession.processCommand()
    │
    ├─ pause() 识别
    ├─ getPageContext() -> { url, html }
    ├─ processWithRetry(text, url, html)
    │       │
    │       ├─ callAI(userContent)
    │       │      adapter.chat(messages)
    │       │
    │       ├─ parseBatchCommand(aiOutput)
    │       │      【code】...【/code】 -> CommandInfo[]
    │       │
    │       └─ 失败时重试（附加错误信息）
    │
    ▼
结果分发
    │
    ├─ type='commands' -> executeCommandList()
    │       │ 逐条调用 executeAutomation(action, params)
    │       ▼ 回到 LISTENING
    │
    ├─ type='chat' -> broadcast.speak(text)
    │       │ 播报完成
    │       ▼ 回到 IDLE -> LISTENING
    │
    └─ type='error' -> 显示在聊天中（不播报）
            ▼ 回到 IDLE -> LISTENING
```

## 配置与扩展

- **识别引擎**: `useSherpa` 标志控制优先级，Sherpa 失败自动回退
- **语言**: 硬编码 `zh-CN`（识别 + 播报）
- **最大重试**: `MAX_RETRY = 3`
- **语速**: `rate = 1.0`
- **模型路径**: `/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`
- **音频参数**: 16kHz 采样率, 单声道, 回声消除 + 降噪
- **ScriptProcessor buffer**: 4096 样本

## 已知限制

1. **ScriptProcessorNode 已废弃**: `createScriptProcessor` 是旧 API，已被 `AudioWorklet` 取代。当前 Sherpa 识别依赖此 API，未来浏览器可能移除支持。
2. **Web Speech API 依赖网络**: Chrome 的语音识别使用 Google 服务，离线不可用。Sherpa 回退机制部分缓解此问题。
3. **页面 HTML 体积**: `getPageContext()` 将清洗后的 HTML 发送给 AI，大型页面可能导致 token 超限。
4. **指令解析依赖 AI 格式**: `【code】...【/code】` 标记格式需要 AI 严格遵守，三层重试机制提供容错但仍可能失败。
5. **无语音活动检测 (VAD)**: 识别器持续运行，无法区分语音和环境噪音，`no-speech` 错误依赖浏览器判断。
6. **播报语言硬编码**: `lang='zh-CN'` 不支持多语言播报切换。
