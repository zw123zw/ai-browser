# AI Browser - Project Conventions

> Chrome 扩展：AI 语音浏览器助手。WXT + Vue 3 + TypeScript + Pinia，运行在 Shadow DOM 中。

## 技术栈约束

- **框架**: Vue 3 Composition API + `<script setup lang="ts">`，禁止 Options API
- **构建**: WXT (Manifest V3)，`@/` 路径别名指向项目根目录
- **状态管理**: Pinia，仅用 setup store（Composition API 写法）
- **类型检查**: `vue-tsc --noEmit`（`npm run compile`）
- **样式**: 纯 CSS，写在 `src/styles/global.css`，类名必须 `zwf-` 前缀
- **日志**: 统一使用 Logger，写入 `chrome.storage.local`，禁止 console

## 命名规范

| 类型 | 规则 | 示例 |
|------|------|------|
| Vue 组件 | PascalCase | `ChatDrawer.vue`, `InputBar.vue` |
| TS 文件 | kebab-case | `file-parsers.ts`, `storage-sync.ts` |
| 函数/变量 | camelCase | `createAdapter`, `useSettingsStore` |
| 类型/接口 | PascalCase | `ChatMessage`, `AppSettings` |
| CSS 类名 | `zwf-` 前缀 | `zwf-fab`, `zwf-msg-row` |
| Store ID | `zwf-` 前缀 | `zwf-settings`, `zwf-conversations` |

## 目录结构

```
entrypoints/
  background.ts              # 后台 Service Worker
  content/
    index.ts                 # Content Script 入口（Shadow DOM 挂载）
    App.vue                  # 根组件
    components/              # 所有 Vue 组件
src/
  adapters/                  # AI 适配器（工厂+策略模式）
  automation/                # 语音触发的网页自动化
  browser/                   # 浏览器命令执行引擎
  composables/               # Vue 组合式函数
  input/                     # 统一输入处理管线
  skills/                    # 技能系统（/命令）
  storage/                   # Chrome storage 抽象层
  stores/                    # Pinia 状态管理
  styles/                    # 全局 CSS
  utils/                     # 工具函数
  voice/                     # 语音识别与会话管理
  types.ts                   # 共享类型定义
```

## 关键架构模式

### 适配器模式（src/adapters/）
- `BaseAdapter` 抽象类定义 `chat()` 接口
- 工厂函数 `createAdapter(provider)` 创建具体实例
- 新增适配器：继承 BaseAdapter → 注册工厂 → 添加 Provider 联合类型
- 所有 API 请求通过 `proxyFetchStream()` 经 background 中转（CORS 规避）

### 存储同步（src/utils/storage-sync.ts）
- `defineStorageSync()` 实现 reactive ref ↔ chrome.storage 双向同步
- 200ms 防抖写入 + 500ms 回声窗口防跨标签页循环
- 序列化前用 `plain()` 剥离 Vue 代理

### 输入管线（src/input/）
- 路由：`/` 前缀 → 内置命令或技能激活，其他 → AI 意图检测
- 两阶段：AI 流式对话/动作检测 → 迭代命令执行（最多 5 次重试）

### 组件规范
```vue
<script setup lang="ts">
import { Logger } from '@/src/utils/logger';
const log = new Logger('ComponentName');

const props = defineProps<{ ... }>();      // 泛型语法
const emit = defineEmits<{ ... }>();      // 泛型语法
</script>

<template>
  <div class="zwf-xxx">...</div>
</template>
```

## 日志规范

**源码**: `src/utils/logger.ts` | **存储**: `src/utils/log-storage.ts`

### 基本用法

```typescript
import { Logger } from '@/src/utils/logger';

const log = new Logger('ModuleName');

log.debug('调试信息', { detail });
log.info('操作完成', { result });
log.warn('异常情况', { reason });
log.error('请求失败', error);          // Error 对象自动提取 message + stack
```

### 模块命名

Logger 构造参数是模块标识，用于日志分类和过滤：

| 场景 | 命名 | 示例 |
|------|------|------|
| Vue 组件 | 组件名 | `new Logger('InputBar')` |
| Store | `Store:名称` | `new Logger('Store:Conversations')` |
| 适配器 | `Adapter:名称` | `new Logger('Adapter:OpenAI')` |
| 工具模块 | 模块名 | `new Logger('Pipeline')` |
| Background | `Background` | `new Logger('Background')` |

### 规则

- **禁止 `console.log`** — 所有日志走 Logger，条件输出由 `VITE_LOG_ENABLED` 控制
- 日志写入 `chrome.storage.local`，不输出到控制台
- `API` 模块的日志走 `saveApiLog`，其他走 `saveFrontendLog`
- 对象参数自动 JSON.stringify，Error 自动提取 message + stack
- 全局级别可通过 `setLogLevel()` 调整，默认 `DEBUG`（全部输出）

## 开发命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 开发模式（HMR） |
| `npm run build` | 双构建（prod + debug） |
| `npm run build:prod` | 仅生产构建 |
| `npm run compile` | 类型检查 |

## 文档参考

- `README.md` — 架构总览（Mermaid 图）
- `DEVELOPMENT.md` — 开发指南与约定
- `docs/architecture/` — 11 篇架构文档（适配器、管线、存储、翻译等）
- `src/skills/workflows/README.md` — 技能系统开发指南
