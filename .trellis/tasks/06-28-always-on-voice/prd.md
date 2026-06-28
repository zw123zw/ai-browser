# 常驻语音模式

## Goal

语音配置新增"常驻语音"开关。开启后，即使聊天抽屉关闭，语音引擎仍然运行。用户随时说唤醒词即可自动打开抽屉并进入命令模式，无需手动操作。

## 现状

- VoicePanel（`v-if="open && activeMode === 'voice'"`）控制 VoiceManager 生命周期
- 抽屉关闭 → VoicePanel 卸载 → 引擎销毁 → 无法语音交互
- 用户必须手动打开抽屉才能使用语音

## 方案

### 1. 新增设置项

`VoiceSettings` 新增：
```typescript
alwaysOnVoice: boolean  // 默认 false
```

SettingsModal 语音配置页新增开关，绑定 `voiceForm.alwaysOnVoice`。

### 2. VoiceManager 生命周期提升到 App.vue

**核心思路**：`alwaysOnVoice` 开启时，VoiceManager 由 App.vue 创建和管理，不随 VoicePanel 卸载而销毁。

App.vue 新增逻辑：
- watch `voiceStore.settings.alwaysOnVoice`
- 开启 → 创建持久 VoiceManager，监听唤醒事件
- 关闭 → 销毁持久 Manager
- 唤醒词检测到 → 自动 `open = true`（打开抽屉）

VoicePanel 修改：
- onMounted 时检查是否有 App.vue 传下来的持久 Manager
- 有 → 直接用，不创建新的，onUnmounted 不销毁
- 没有 → 走现有逻辑（创建/销毁）

### 3. 唤醒时自动打开抽屉

App.vue 监听 VoiceManager 的状态变化：
- `sessionState` 从 `idle` → `wake` 或 `speaking` 时，设置 `open = true`
- 这样用户说唤醒词 → 引擎进入 speaking → 抽屉自动打开

### 4. 消息显示

VoicePanel 挂载后，需要能访问持久 Manager 的消息数据。
- 用户消息通过 `convStore.conversation.messages` 显示（已有）
- TTS 播报通过 watcher 监听 assistant 消息（已有）
- VoicePanel 只需要拿到 manager 引用来调用 `speak()` 等方法

### 5. 标签页可见性

`alwaysOnVoice` 开启时，`visibilitychange` 逻辑需要调整：
- 标签页隐藏 → 不停止引擎（保持监听）
- 标签页可见 → 正常工作

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/stores/voice.ts` | 新增 `alwaysOnVoice` 字段 |
| `src/i18n/zh-CN.json` | 新增翻译 |
| `src/i18n/en-US.json` | 新增翻译 |
| `entrypoints/content/App.vue` | 持久 Manager 创建/销毁/唤醒事件 |
| `entrypoints/content/components/VoicePanel.vue` | 接收持久 Manager / 回退逻辑 |
| `entrypoints/content/components/SettingsModal.vue` | 新增开关 |

## 验收标准

1. [ ] 设置页语音配置有"常驻语音"开关，默认关闭
2. [ ] 开启后关闭抽屉，引擎继续运行（日志可见引擎状态）
3. [ ] 关闭抽屉状态下说唤醒词，抽屉自动打开并播报"您好，请说"
4. [ ] 关闭常驻语音开关，引擎销毁，回到原有行为
5. [ ] 标签页隐藏时引擎不停止（常驻模式下）
6. [ ] 标签页可见时正常工作
