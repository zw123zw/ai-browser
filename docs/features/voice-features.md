# 语音功能参考

语音输入、语音指令解析和语音播报能力，让用户通过语音与浏览器 AI 助手进行自然交互。

## 功能总览

| 功能 | 说明 | 引擎 |
|------|------|------|
| 语音识别 | 将语音转为文本 | Sherpa-ONNX（优先）/ Web Speech API（回退） |
| 语音播报 | 将文本转为语音 | Web Speech Synthesis API |
| 语音会话 | 完整交互循环（识别→AI→执行→播报） | VoiceSession 状态机 |
| 指令解析 | 从 AI 回复中提取可执行指令 | AI 驱动（`【code】` 标记） |

---

## 语音识别

### 双引擎策略

| 引擎 | 类型 | 语言 | 特点 |
|------|------|------|------|
| Sherpa-ONNX | 离线 | 中英双语 | WebAssembly、16kHz、本地处理、不依赖网络 |
| Web Speech API | 在线 | 多语言 | 连续模式、自动重启、interim 结果、依赖 Chrome/Edge |

**切换逻辑：** `VoiceSession.start()` 优先初始化 SherpaRecognition，若加载模型或获取麦克风失败，自动回退到 VoiceRecognition。

### Sherpa-ONNX 识别

- **模型：** `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`
- **音频管道：**
  1. `navigator.mediaDevices.getUserMedia()` 获取麦克风（16kHz、单声道、回声消除、降噪）
  2. `AudioContext({ sampleRate: 16000 })` 创建音频上下文
  3. `createScriptProcessor(4096, 1, 1)` 创建音频处理节点
  4. `recognizer.acceptWaveform(16000, samples)` 喂入识别器
- **模型加载：** 动态 `import('sherpa-onnx/sherpa-onnx-asr.js')`，首次启动时加载，后续复用
- **资源清理：** `stop()` 时断开 ScriptProcessor、停止 MediaStream 轨道、关闭 AudioContext

### Web Speech API 识别

- **连续模式：** `continuous: true`
- **中间结果：** `interimResults: true`
- **错误自动重启：**
  - `no-speech` / `audio-capture` → 延迟 1s 重启
  - `network` → 延迟 3s 重启
  - 其他错误 → 延迟 2s 重启
- **浏览器兼容：** `isSupported()` 检测 `SpeechRecognition` / `webkitSpeechRecognition`

---

## 语音合成（TTS）

基于 Web Speech Synthesis API。

| 方法 | 说明 |
|------|------|
| `speak(text)` | 播报文字，返回 Promise（播报完成时 resolve） |
| `cancel()` | 取消当前播报 |

**配置：** lang（默认 `zh-CN`）、rate（默认 `1.0`）、volume（默认 `1.0`）

**特性：** 新播报自动取消当前播报、`onStart`/`onEnd` 回调

---

## 语音会话状态机

```
┌─────────────────────────────────────────────────────────────┐
│   IDLE ──→ LISTENING ──→ PROCESSING ──→ SPEAKING ──→ IDLE  │
│    ↑          │              │              │               │
│    └──────────┴──────────────┴──────────────┘               │
│                    常驻循环，无需反复触发                      │
└─────────────────────────────────────────────────────────────┘
```

| 状态 | 说明 | 触发条件 |
|------|------|---------|
| idle | 空闲 | 初始状态 / 播报完成 |
| listening | 聆听中 | 用户开始语音输入 |
| processing | AI 处理中 | 识别完成，等待 AI 回复 |
| speaking | 播报中 | AI 回复后 TTS 播报 |

### 完整交互流程

1. **start()** → 初始化识别引擎（Sherpa 优先）→ 播报"请说出指令"
2. **LISTENING** → 识别引擎持续监听 → 中间结果更新 UI
3. **最终结果** → pause 识别 → **PROCESSING**
4. **AI 调用** → 发送语音文本 + 页面上下文 → 流式获取回复
5. **指令解析** → `parseBatchCommand(aiOutput)`
6. **执行指令** → 串行执行 → 播报结果 → **LISTENING**（继续循环）
7. **纯对话** → TTS 播报 → **LISTENING**（继续循环）

---

## 语音指令

AI 回复中的命令格式：`【code】type:params【/code】`

支持 8 种指令类型（详见 [automation-actions.md](./automation-actions.md)）：

| 指令 | 参数 | 说明 |
|------|------|------|
| open_site | URL | 打开网站 |
| search | 关键词 | 全网搜索 |
| site_search | 关键词 | 站内搜索 |
| open_item | 序号 | 点击第 N 个结果 |
| page_next | 无 | 下一页 |
| page_prev | 无 | 上一页 |
| video_play | 无 | 播放视频 |
| video_pause | 无 | 暂停视频 |

---

## AI 调用细节

### 系统提示词

- **自动化开启：** `COMMAND_SYSTEM_PROMPT` — 定义指令格式和规则，8 种指令类型
- **自动化关闭：** `CHAT_ONLY_SYSTEM_PROMPT` — 简单聊天助手，100 字以内口语化回复

### 上下文构建

- 最近 3 轮语音消息
- 当前页面 URL
- 清洗后 HTML（页面上下文）

### 重试机制

`processWithRetry()` 最多重试 3 次：
1. 将上次 AI 输出附加到上下文
2. 将解析错误信息附加到上下文
3. 让 AI 自我修正

---

## 多指令串行执行

用户一句话可包含多个操作（如"打开 B 站，搜索猫咪视频"），AI 会输出多条有序指令。

**执行策略：**
- 串行执行（一条完成后执行下一条）
- 单条失败不中断后续执行

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 浏览器不支持 Web Speech API | 提示用户使用 Chrome/Edge |
| 麦克风权限被拒绝 | 播报提示后停止会话 |
| Sherpa 模型加载失败 | 自动回退到 Web Speech API |
| 识别 `no-speech` / `audio-capture` | 延迟 1s 自动重启 |
| 识别 `network` 错误 | 延迟 3s 自动重启 |
| AI 返回空回复 | 重试，最多 3 次 |
| 指令解析失败 | 附加错误信息让 AI 自我修正，最多 3 次 |
| 单条指令执行失败 | 记录日志，继续后续指令 |
| 浏览器不支持 TTS | `speak()` 静默 resolve |
