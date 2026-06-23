# Storage Module

## 模块概述

存储模块基于 WXT 框架的 `wxt/storage` API，提供类型安全的 Chrome storage 抽象层。定义了 6 个存储项，涵盖应用设置、对话数据、UI 状态、输入历史和跨标签页任务队列。所有存储项使用 `local:` 前缀，数据持久化在 `chrome.storage.local` 中。

**源文件**: `src/storage/index.ts`

## 架构设计

```
┌─────────────────────────────────────────────────┐
│                  Storage Module                   │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │         wxt/storage (底层抽象)              │  │
│  │    chrome.storage.local + fallback         │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │         storage.defineItem<T>()            │  │
│  │    类型安全 + fallback 默认值               │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────┬──────┬────┴────┬──────┬──────┐        │
│  │settings│conv │fabPos │drawer│history│queued│  │
│  │Storage│Storage│Storage│Storage│Storage│Task │  │
│  └──────┴──────┴───────┴──────┴──────┴──────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │         local-config.json                  │  │
│  │    DEFAULT_SETTINGS 种子数据               │  │
│  │    parseLocalModels() 模型解析             │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 核心类型定义

```typescript
// 应用设置（主配置）
interface AppSettings {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  authField: string;
  defaultModelId: string;
  drawerWidth: number;
  primaryColor: string;
  theme: string;
  shortcut: string;
  maxConversations: number;
  maxContext: number;
  autoSendSelection: 'auto' | 'manual' | 'off';
  translateTargetLang: string;
  translateMode: 'off' | 'selection' | 'auto' | 'click';
  automationEnabled: boolean;
  locale: 'zh-CN' | 'en-US';
  models: ModelConfig[];
}

// 模型配置
interface ModelConfig {
  id: string;
  label: string;
  provider: Provider;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  website: string;
}

// 悬浮按钮位置
interface FabPos {
  right: number;   // 距视口右边距
  bottom: number;  // 距视口下边距
}

// 跨标签页排队任务
interface QueuedTask {
  originalRequest: string;
  completedSteps: Array<{
    action: string;
    elementId?: string;
    description?: string;
  }>;
  timestamp: number;
}
```

## 实现细节

### 模型配置解析 (parseLocalModels)

从 `local-config.json` 读取原始模型列表，转换为 `ModelConfig[]`：

1. **baseUrl 清洗**: 去除末尾 `/chat/completions` 后缀（adapter 会自动拼接）
2. **ID 级联回退**: `m.id || m.modelName || m.model || 'model-{timestamp}'`
3. **modelName 级联回退**: `m.modelName || m.model || id`
4. **label 默认**: `m.label || modelName`
5. **provider 默认**: `m.provider || 'openai'`

### 默认设置 (DEFAULT_SETTINGS)

从解析后的 `localModels` 数组第一个元素填充默认值：

```typescript
{
  provider: 'openai',
  baseUrl: localModels[0]?.baseUrl || 'https://api.openai.com/v1',
  apiKey: localModels[0]?.apiKey || '',
  defaultModelId: localModels[0]?.id || '',
  drawerWidth: 480,
  primaryColor: '#4f46e5',
  theme: 'classic',
  shortcut: 'Ctrl+`',
  maxConversations: 100,
  maxContext: 50,
  autoSendSelection: 'auto',
  translateTargetLang: '中文',
  translateMode: 'off',
  automationEnabled: true,
  locale: 'zh-CN',
  models: localModels,
}
```

### 6 个存储项

| 存储项 | 键名 | 类型 | fallback | 用途 |
|-------|------|------|----------|------|
| `settingsStorage` | `local:ai-browser-settings` | `AppSettings` | `DEFAULT_SETTINGS` | 全局配置 |
| `conversationStorage` | `local:ai-browser-conversation` | `Conversation \| null` | `null` | 当前会话 |
| `fabPosStorage` | `local:ai-browser-fab-pos` | `FabPos` | `{ right: 24, bottom: 24 }` | 悬浮按钮位置 |
| `drawerOpenStorage` | `local:ai-browser-drawer-open` | `boolean` | `false` | 抽屉展开状态 |
| `inputHistoryStorage` | `local:ai-browser-input-history` | `string[]` | `[]` | 输入历史（上限 100） |
| `queuedTaskStorage` | `local:aib-queued-task` | `QueuedTask \| null` | `null` | 跨标签页任务队列 |

### wxt/storage API

`storage.defineItem<T>(key, options)` 返回的存储项提供：
- `getValue()`: 异步读取当前值
- `setValue(value)`: 异步写入
- `watch(callback)`: 监听值变化（跨标签页同步）
- `fallback`: 当存储中无值时返回的默认值

## 数据流

```
应用启动
    │
    ▼
settingsStorage.getValue()
    │ fallback: DEFAULT_SETTINGS
    │ 如果 chrome.storage 中有值 -> 返回存储值
    │ 如果无值 -> 返回 DEFAULT_SETTINGS
    ▼
useSettingsStore.init()
    │ 加载设置到 Pinia store
    ▼
组件通过 store 读取/修改设置
    │
    ▼
settingsStorage.setValue(updatedSettings)
    │ wxt/storage 写入 chrome.storage.local
    ▼
其他标签页 watch 回调触发
    │ 跨标签页同步
```

## 配置与扩展

- **存储前缀**: 所有键使用 `local:` 前缀，存储在 `chrome.storage.local`（非 `sync`）
- **配置来源**: `local-config.json` 作为模型配置种子文件
- **无加密**: apiKey 明文存储在 chrome.storage.local 中
- **无过期机制**: 所有存储项永不过期，需手动清理
- **输入历史上限**: 100 条（由 `useInputHistory` composable 控制，非存储层限制）

## 已知限制

1. **apiKey 明文存储**: `settingsStorage` 中的 `apiKey` 以明文形式存储在 `chrome.storage.local`，任何有扩展权限的代码都可读取。
2. **单会话设计**: `conversationStorage` 只存储一个会话，不支持多会话并行。
3. **无存储迁移**: 存储结构变更时没有版本号和迁移机制，旧数据可能与新类型不兼容。
4. **Chrome Storage 容量**: `chrome.storage.local` 有 5MB 限制（默认），大量对话历史可能接近上限。
5. **queuedTask 无持久化保护**: 跨标签页任务仅靠 `timestamp` 做 30s 过期判断，Service Worker 重启后任务丢失。
6. **parseLocalModels 硬编码**: 模型解析逻辑硬编码在存储模块中，不支持运行时动态添加模型（需修改 JSON 文件重新构建）。
