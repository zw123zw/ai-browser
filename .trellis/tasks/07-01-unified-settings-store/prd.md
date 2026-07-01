# refactor: 统一 settingsStore —— 所有配置和用户数据合并到单一存储对象

## Goal

将分散在多个 store 和 storage key 中的配置、用户数据统一合并到 `settingsStore`，通过一个 `AppSettings` 对象 + 一个 `chrome.storage.local` key 管理。清除缓存时只需重置对象中的用户数据字段，配置不受影响。

## Motivation

当前架构存在以下问题：

1. **配置分散**：AppSettings 在 `settingsStore`，VoiceSettings 在 `voiceStore`（独立 storage key `local:voice-settings`），voiceMode 在 `chrome.storage.local` 的 `aib-voice-mode` key
2. **初始化散乱**：`settingsStore.init()` + `voiceStore.initSettings()` + `voiceStore.initMode()` + `convStore.init()` + `notesStore.init()`，5 个独立初始化
3. **清除缓存复杂**：需要记住多个 storage key，手动 `chrome.storage.local.remove()`
4. **语音模式管理混乱**：ChatDrawer.vue 手动读写 chrome.storage.local + 自定义事件派发

## Requirements

### 核心变更

1. **VoiceSettings 合并进 AppSettings**：所有语音配置（引擎类型、API 密钥、TTS 参数等）作为 AppSettings 的 `voice*` 字段
2. **Conversation 合并进 AppSettings**：当前会话数据作为 `conversation` 字段
3. **Notes 合并进 AppSettings**：笔记数据作为 `notes` 字段
4. **InputHistory 合并进 AppSettings**：输入历史作为 `inputHistory` 字段
5. **voiceMode 统一管理**：ChatDrawer.vue 直接读写 `settingsStore.settings.voiceMode`
6. **清除缓存简化**：重置 `conversation`、`notes`、`inputHistory` 字段即可
7. **日志保持独立**：`logs:frontend`、`logs:api` 高频写入，不适合放进大对象

### 保持不变

- FabPos 保持独立（纯 UI 状态，跨标签页同步已有）
- drawerOpen 保持独立（纯 UI 状态）
- queuedTask 保持独立（临时跨标签页任务）
- voiceStore 保留运行时状态（status, sessionState, interimText, finalText）

## Acceptance Criteria

- [ ] `AppSettings` 接口包含所有语音配置字段（voiceEngineType, voiceApiKey 等）
- [ ] `AppSettings` 包含 conversation、notes、inputHistory 字段
- [ ] `src/storage/index.ts` 删除 `voiceSettingsStorage`，DEFAULT_SETTINGS 包含语音默认值
- [ ] `settingsStore.init()` 完成所有配置初始化（含语音引擎配置回填）
- [ ] `voiceStore` 仅保留运行时状态，不再管理持久化设置
- [ ] `ChatDrawer.vue` 通过 `settingsStore.settings.voiceMode` 管理模式切换
- [ ] `SettingsModal.vue` 语音设置读写改用 `settingsStore`
- [ ] `VoicePanel.vue` 设置读取改用 `settingsStore`
- [ ] `App.vue` 从 `settingsStore` 读语音配置和模式
- [ ] `clearCache()` 改为重置 settingsStore 中的用户数据字段
- [ ] `npm run compile` 类型检查通过
- [ ] `npm run build` 打包成功
- [ ] 文字聊天模式不触发语音引擎
- [ ] 切换到语音助手模式正常启动引擎
- [ ] 跨标签页同步：一个标签页切模式，另一个同步更新
- [ ] 清除缓存后配置（API key、主题、语音引擎等）保留

## Technical Approach

### 1. 类型变更 (`src/types.ts`)

```typescript
export interface AppSettings {
  // === 现有字段保持不变 ===
  provider, baseUrl, apiKey, authField, models, defaultModelId
  drawerWidth, primaryColor, theme, shortcut
  maxConversations, maxContext, autoSendSelection
  translateTargetLang, translateMode, noteMode
  automationEnabled, locale

  // === 新增：语音配置 ===
  voiceEngineType?: 'web-speech' | 'iflytek' | 'baidu' | 'tencent'
  voiceAppId?: string
  voiceApiKey?: string
  voiceApiSecret?: string
  voiceEngineConfs?: EngineConf[]
  voiceRecognitionLang?: string
  voiceWakeWord?: string
  voiceAlwaysOn?: boolean
  voiceEnableTts?: boolean
  voiceTtsRate?: number
  voiceTtsVolume?: number
  voiceBufferTimeout?: number
  voiceIdleTimeout?: number
  voiceMode?: 'chat' | 'voice'

  // === 新增：用户数据 ===
  conversation?: Conversation
  notes?: NotesData
  inputHistory?: string[]
}
```

新增类型导出：
```typescript
export type VoiceEngineType = 'web-speech' | 'iflytek' | 'baidu' | 'tencent'
export interface EngineConf { engineType: string; appId: string; apiKey: string; apiSecret: string }
```

### 2. 存储变更 (`src/storage/index.ts`)

- 删除 `VoiceSettings` 接口、`DEFAULT_VOICE_SETTINGS`、`voiceSettingsStorage`
- 删除 `conversationStorage`、`notesStorage`、`inputHistoryStorage`（合并进 settingsStorage）
- `DEFAULT_SETTINGS` 增加语音默认值 + 空 conversation/notes/inputHistory
- 保留 `voiceConfig` 导入（用于 DEFAULT_SETTINGS 中 engineConfs 的初始值）

### 3. settingsStore 变更 (`src/stores/settings.ts`)

- `init()` 增加：从 `voice-config.json` 填充 voiceEngineConfs（首次运行）、回填空的 API 密钥
- `init()` 增加：迁移旧 `local:voice-settings` 数据（一次性）
- `init()` 增加：迁移旧 `local:ai-browser-conversation` 数据（一次性）
- `init()` 增加：迁移旧 `local:ai-browser-notes` 数据（一次性）
- `init()` 增加：迁移旧 `local:ai-browser-input-history` 数据（一次性）
- `clearUserData()` 方法：重置 conversation/notes/inputHistory

### 4. voiceStore 精简 (`src/stores/voice.ts`)

删除：
- `settings` ref、`sync` defineStorageSync
- `initSettings()`、`updateSetting()`、`updateSettings()`、`resetSettings()`
- `activeMode`、`initMode()`、`setActiveMode()`
- `voiceSettingsStorage` 相关导入

保留：
- `status`、`sessionState`、`interimText`、`finalText`（运行时状态）
- `settingsVersion`（触发 VoiceManager 重建的信号）
- `setStatus()`、`setSessionState()`、`updateText()`、`reset()`

新增：
- 从 `settingsStore.settings` 读取语音配置的 getter（供 VoiceManager 使用）

### 5. ChatDrawer.vue 变更

- 删除 local `activeMode` ref
- 删除 `chrome.storage.local.get('aib-voice-mode')` 初始化
- 删除 `watch(activeMode)` 的 chrome.storage + 事件派发
- 改用 computed get/set 绑定 `settingsStore.settings.voiceMode`
- `switchToVoice()` / `switchToChat()` 直接调 `settingsStore.update({ voiceMode })`

### 6. App.vue 变更

- 删除 `voiceStore.initMode()` 调用
- `isVoiceAssistantMode()` 改读 `settingsStore.settings.voiceMode`
- `startBgVoice()` 的配置从 `settingsStore.settings.voiceXxx` 读取
- `onModeChanged` 改写 `settingsStore.update({ voiceMode })`
- 删除 `aib-mode-changed` 事件监听
- `startVoiceIfAllowed()` 简化

### 7. SettingsModal.vue 变更

- `voiceForm` 初始化改读 `settingsStore.settings.voiceXxx`
- `saveVoice()` 改调 `settingsStore.update({ voiceXxx: ... })`
- 删除 `useVoiceStore` 导入（设置相关）

### 8. VoicePanel.vue 变更

- `voiceStore.settings.enableWakeWord` → `settingsStore.settings.voiceEnableWakeWord`
- `voiceStore.settings.wakeWord` → `settingsStore.settings.voiceWakeWord`

### 9. clearCache 变更 (`src/utils/cache.ts`)

```typescript
export async function clearCache(): Promise<void> {
  const settingsStore = useSettingsStore()
  await settingsStore.clearUserData()
  await chrome.storage.local.remove(['logs:frontend', 'logs:api'])
}
```

### 10. 迁移策略

首次运行新版本时，`settingsStore.init()` 检测并迁移旧数据：
1. 读 `local:voice-settings` → 映射到 AppSettings voice* 字段 → 删除旧 key
2. 读 `local:ai-browser-conversation` → 写入 conversation 字段 → 删除旧 key
3. 读 `local:ai-browser-notes` → 写入 notes 字段 → 删除旧 key
4. 读 `local:ai-browser-input-history` → 写入 inputHistory 字段 → 删除旧 key

## 文件清单

| 文件 | 操作 |
|------|------|
| `src/types.ts` | 加语音字段 + EngineConf 类型 + conversation/notes/inputHistory |
| `src/storage/index.ts` | 删 VoiceSettings/voiceSettingsStorage/conversationStorage/notesStorage/inputHistoryStorage，DEFAULT_SETTINGS 加默认值 |
| `src/stores/settings.ts` | init() 加迁移逻辑，加 clearUserData() |
| `src/stores/voice.ts` | 删除设置相关代码，保留运行时状态 |
| `src/utils/cache.ts` | clearCache() 改用 settingsStore.clearUserData() |
| `entrypoints/content/App.vue` | 从 settingsStore 读语音配置和模式 |
| `entrypoints/content/components/ChatDrawer.vue` | 用 settingsStore 管理 voiceMode |
| `entrypoints/content/components/SettingsModal.vue` | 语音设置改读 settingsStore |
| `entrypoints/content/components/VoicePanel.vue` | 设置读取改用 settingsStore |
| `src/stores/__tests__/voice.test.ts` | 适配 voiceStore 精简 |

## Out of Scope

- FabPos、drawerOpen、queuedTask 保持独立 storage key（纯 UI 状态，合并无收益）
- 日志存储保持独立（高频追加写入）
- voiceStore 运行时状态不合并（语义不同：配置 vs 实时状态）
- 不添加缓存大小显示功能

## 验证步骤

1. `npm run compile` — 类型检查通过
2. `npm run build` — 打包成功
3. 手动测试：文字聊天模式不触发语音引擎
4. 手动测试：切换到语音助手模式正常启动引擎
5. 手动测试：跨标签页模式同步
6. 手动测试：清除缓存后配置保留、会话清空
7. 手动测试：旧版本数据自动迁移到新存储结构
