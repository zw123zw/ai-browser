# 语音助手全面改造：统一管线 + 唤醒词 + 双轨引擎 + 语音设置

## Goal

语音助手从"两套独立管线 + 手动点击麦克风"改造为"统一 InputPipeline + 唤醒词激活 + 双轨识别引擎 + 自动监听"，实现零操作语音交互，支持海外/国内用户不同需求。

## Decision (ADR-lite)

### Phase 1：统一管线

**Context**: 项目有两套独立管线（VoiceSession 单阶段 AI + 8 命令 vs InputPipeline 两阶段 AI + 21 命令 + 骨架 + 重试链），代码重复且语音能力受限。

**Decision**:
1. 删除 VoiceSession，语音识别文字直接进入 InputPipeline
2. TTS 在 VoicePanel 层 watch conversationsStore 新消息自动播报
3. 语音和文本共享 conversationsStore，对话历史互通

**Consequences**: 语音模式获得 21 种命令 + 骨架 + 重试链能力。

### Phase 2：唤醒词 + 双轨引擎 + 自动监听

**Context**: Sherpa-ONNX 本地模型需要下载 477MB 且识别质量不如云端。Web Speech API 在国内被墙，讯飞在国内识别质量顶级且免费 5 万次/天。

**Decision**:
1. 去掉 Sherpa-ONNX（模型太大，不实用）
2. 恢复 Web Speech API（海外用户零配置）
3. 新增讯飞 WebSocket 引擎（国内用户填 Key 即用）
4. 新增唤醒词功能（默认"你好，小灵"，可自定义）
5. 打开语音面板自动监听，去掉手动点击麦克风

**Consequences**: 语音功能从"演示级"升级为"可用级"，支持海外/国内双轨，用户体验从"3 步操作"简化为"1 步操作"。

## Requirements

### 1. 统一管线

- 删除 VoiceSession（`src/voice/session.ts`）
- 删除 commandParser（`src/voice/commandParser.ts`）
- 识别文字 → `usePipeline().processInput()` 走 InputPipeline
- 语音模式支持 21 种命令 + 骨架 + 两阶段 AI + 重试链
- 语音和文本共享 conversationsStore

### 2. 双轨识别引擎

- **Web Speech API 引擎**：海外用户默认，零配置
- **讯飞 WebSocket 引擎**：国内用户，需要配置 API Key + App ID
- 统一 `VoiceEngine` 接口：`start()` / `stop()` / `pause()` / `resume()` / `onResult()` / `onError()`
- 用户在设置页选择引擎

### 3. 唤醒词

- 默认唤醒词：`你好，小灵`
- 用户可自定义，支持中英文任意文本
- 匹配方式：interim 文本包含唤醒词即触发（模糊匹配）
- 检测到唤醒词 → 播放提示音 → 进入命令模式
- 命令执行完毕 → 自动回到唤醒词监听状态
- 可开关（启用/禁用唤醒词）

### 4. 自动监听

- **打开语音面板** → 自动开始监听（不需要点麦克风按钮）
- **关闭语音面板** → 自动停止监听
- 去掉麦克风按钮的点击功能，只保留波纹动画作为状态指示器
- 命令执行完毕 → TTS 播报 → 自动回到监听状态（循环）

### 5. 语音播报 (TTS)

- AI 聊天回复自动 TTS 播报
- 命令执行结果自动播报摘要
- 可关闭播报
- 可调语速（0.8x ~ 1.5x，默认 1.0x）
- 可调音量（0% ~ 100%，默认 80%）
- 可选播报语音（系统可用语音列表）

### 6. 语音设置项（10 个配置，4 组）

```
语音设置
├── 🎤 语音识别
│   ├── 引擎选择        [Web Speech API ▼]  / [讯飞]
│   ├── 讯飞 API Key    [________________] (选讯飞时显示)
│   ├── 讯飞 App ID     [________________] (选讯飞时显示)
│   └── 识别语言        [中文 ▼]  / [英文] / [中英混合]
│
├── 🔔 唤醒词
│   ├── 启用唤醒词      [开关] 默认开
│   ├── 唤醒词          [你好，小灵] 可自定义，支持中英文
│   └── 唤醒提示音      [开关] 默认开
│
├── 🔊 语音播报 (TTS)
│   ├── 启用播报        [开关] 默认开
│   ├── 播报语速        [0.8x ──●── 1.5x] 默认 1.0x
│   └── 播报音量        [─────●──] 默认 80%
│
└── ⚡ 行为
    └── 自动启动监听    [开关] 默认关（打开面板才监听）
```

## Acceptance Criteria

- [x] 语音识别后文字直接进入 InputPipeline，与文本输入走完全相同的 AI 处理流程
- [x] 语音模式支持 21 种命令类型（与文本模式一致）
- [x] 语音模式支持骨架提取和两阶段 AI
- [x] 语音模式聊天回复自动 TTS 播报
- [x] 删除 VoiceSession（session.ts）
- [x] 删除 commandParser.ts
- [x] 删除 Sherpa-ONNX（sherpa-recognition.ts）
- [x] VoicePanel 和 ChatPanel 共享同一份对话历史（conversationsStore）
- [x] 打开语音面板自动开始监听，不需要点麦克风
- [x] 说唤醒词"你好，小灵"后进入命令模式
- [x] 识别到命令自动执行，不需要确认
- [x] 命令执行完自动回到监听状态（循环）
- [x] 关闭面板自动停止监听
- [x] Web Speech API 引擎正常工作（海外）
- [x] 讯飞引擎代码就绪（国内，填入 Key 后可用）
- [x] 唤醒词可自定义
- [x] 设置项全部生效
- [x] 类型检查通过（vue-tsc --noEmit）
- [x] 打包成功（npm run build）

## Definition of Done

- 所有 Acceptance Criteria 通过
- `npm run compile` 无新增错误
- `npm run build` 成功（prod + test）

## Out of Scope

- 唤醒词语音训练（用模糊匹配，不做声纹识别）
- 讯飞语音合成（TTS 用浏览器原生 SpeechSynthesis）
- 离线语音识别（去掉 Sherpa-ONNX，不做离线方案）
- 语音唤醒词自定义提示音（用系统默认提示音）

## Technical Architecture

### 状态机

```
IDLE
 │ 用户打开语音面板
 ▼
WAKE_LISTENING（监听唤醒词）←──────────────┐
 │ 检测到唤醒词                             │
 │ 播放提示音                               │
 ▼                                         │
COMMAND_LISTENING（监听命令）                │
 │ 识别到最终文本                           │
 ▼                                         │
PROCESSING（AI 处理 + 执行命令）             │
 │ 完成                                    │
 ▼                                         │
SPEAKING（TTS 播报结果）                     │
 │ 播报完毕                                 │
 └─────────────────────────────────────────┘
 │ 用户关闭面板
 ▼
IDLE
```

### 文件结构

```
src/voice/
├── engines/
│   ├── types.ts              # VoiceEngine 统一接口
│   ├── web-speech-engine.ts  # Web Speech API 封装
│   └── iflytek-engine.ts     # 讯飞 WebSocket 封装
├── wake-word.ts              # 唤醒词检测器
├── broadcast.ts              # TTS 播报（保留）
├── voice-manager.ts          # 语音管理器（状态机 + 引擎调度）
└── index.ts                  # barrel export

src/stores/voice.ts           # 语音状态 + 11 个设置项

entrypoints/content/components/
├── VoicePanel.vue            # 自动监听 + 唤醒词 UI
└── ChatDrawer.vue            # 模式切换（保留）
```

### 数据流

```
用户说话
    │
    ▼
VoiceEngine (Web Speech API / 讯飞)
    │
    ▼ onResult(text, isFinal)
    │
VoiceManager (状态机)
    │ wake 模式 → 检查唤醒词
    │ command 模式 → 执行命令
    ▼
pipeline.processInput(text)
    │
    ▼ InputPipeline (两阶段 AI + 骨架 + 重试)
    │
    ▼ callbacks (onChatStart / onChatDelta / onChatEnd / ...)
    │
VoicePanel (watch conversationsStore 新消息)
    │
    ▼ VoiceBroadcast.speak(回复文本)
    │
用户听到播报 → 自动回到监听
```

### 删除清单

| 文件 | 操作 |
|------|------|
| `src/voice/session.ts` | 删除（VoiceSession 独立管线） |
| `src/voice/commandParser.ts` | 删除（【code】解析器） |
| `src/voice/recognition.ts` | 删除（被 WebSpeechEngine 替代） |
| `src/voice/sherpa-recognition.ts` | 删除（模型太大，不实用） |
| `src/voice/__tests__/commandParser.test.ts` | 删除 |
| `src/voice/__tests__/recognition.test.ts` | 删除 |
| `src/voice/__tests__/sherpa-recognition.test.ts` | 删除 |

### 新增清单

| 文件 | 说明 |
|------|------|
| `src/voice/engines/types.ts` | VoiceEngine 统一接口 |
| `src/voice/engines/web-speech-engine.ts` | Web Speech API 引擎 |
| `src/voice/engines/iflytek-engine.ts` | 讯飞 WebSocket 引擎 |
| `src/voice/wake-word.ts` | 唤醒词检测器 |
| `src/voice/voice-manager.ts` | 语音管理器（状态机） |
| `src/voice/index.ts` | barrel export（重写） |
| `src/stores/voice.ts` | 改造：11 个设置项 + 持久化 |

### 改造清单

| 文件 | 改动 |
|------|------|
| `entrypoints/content/components/VoicePanel.vue` | 使用 VoiceManager，自动监听，唤醒词 UI |
| `src/stores/voice.ts` | 精简状态 + 新增 11 个设置项 |
| `src/voice/index.ts` | 重写导出 |
| `src/automation/actions.ts` | AutomationAction 类型本地化 |
| `src/__tests__/functional-test.test.ts` | 移除 commandParser 测试 |

## Technical Notes

### 讯飞 API 参考

- 文档：https://www.xfyun.cn/doc/asr/voicedictation/API.html
- WebSocket 地址：`wss://iat-api.xfyun.cn/v2/iat`
- 鉴权方式：URL 签名（HMAC-SHA256）
- 音频格式：16kHz, 16bit, mono PCM
- 免费额度：5 万次/天

### Web Speech API 参考

- MDN：https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- Chrome 需要外网访问 Google 服务
- 支持 continuous + interimResults 模式
- 语言通过 `lang` 属性设置

### 用户流程

#### 手动模式（默认）

```
用户浏览网页
    │ 点击语音图标
    ▼
打开语音面板 → 自动开始监听
    │ 说 "你好，小灵"
    ▼
提示音 → 进入命令模式
    │ 说 "打开B站"
    ▼
AI 处理 → 打开 B 站 → TTS 播报 "好的，已打开"
    │ 自动回到监听
    ▼
继续说唤醒词或点返回关闭
```

#### 自动模式（设置开启）

```
页面加载 → 后台自动监听唤醒词
    │ 随时说 "你好，小灵"
    ▼
自动弹出语音面板 → 提示音 → 命令模式
    │ 说 "搜索天气"
    ▼
AI 处理 → 搜索 → TTS 播报
    │ 面板自动收起 → 回到后台监听
    ▼
继续浏览网页...
```
