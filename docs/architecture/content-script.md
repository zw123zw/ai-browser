# Content Script

## 模块概述

Content Script 是扩展注入到每个网页的前端入口，负责在 Shadow DOM 中挂载 Vue 3 应用、监听页面事件（URL 变化、DOM 变化、文本选择）、初始化翻译功能、以及跨标签页任务续接。它是用户与扩展交互的第一层界面。

**源文件**: `entrypoints/content/index.ts`, `entrypoints/content/App.vue`

## 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                    宿主网页 (Host Page)                    │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Shadow DOM (隔离边界)                    │ │
│  │                                                     │ │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │ │
│  │  │ Floating │  │  Chat    │  │  Settings Modal   │ │ │
│  │  │  Button  │  │  Drawer  │  │                   │ │ │
│  │  └──────────┘  └──────────┘  └───────────────────┘ │ │
│  │                                                     │ │
│  │  ┌──────────────────────────────────────────────┐  │ │
│  │  │              Pinia Stores                    │  │ │
│  │  │  settings | conversations                    │  │ │
│  │  └──────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Content Script 入口 (index.ts)                          │
│  ├─ Shadow DOM 挂载                                      │
│  ├─ 翻译初始化 (selection / click / auto)                 │
│  ├─ SPA URL 变化检测                                      │
│  ├─ MutationObserver (DOM 变化 -> 自动翻译)               │
│  └─ 跨标签页任务续接                                      │
└──────────────────────────────────────────────────────────┘
```

## 核心类型定义

```typescript
// WXT Shadow Root UI 配置
interface ShadowRootUiConfig {
  name: string;           // 'browser-ai-chat'
  position: 'inline';
  anchor: 'body';
  onMount: (container, shadow, shadowHost) => App;
  onRemove: (app) => void;
}

// 跨标签页排队任务
interface QueuedTask {
  originalRequest: string;
  completedSteps: Array<{
    action: string;
    elementId?: string;
    description?: string;
  }>;
  timestamp: number;  // 过期判断用
}
```

## 实现细节

### Shadow DOM 隔离

通过 WXT 的 `createShadowRootUi` API 创建 Shadow DOM 容器：

- **样式隔离**: `global.css` 以 `<style>` 标签注入 shadow root，所有 CSS 类名使用 `aib-` 前缀
- **宿主定位**: shadowHost 设置 `position: fixed; z-index: 2147483647; width: 0; height: 0`，不占据页面布局
- **Vue 挂载**: 在 `onMount` 回调中 `createApp(App).use(createPinia()).mount(container)`
- **卸载清理**: `onRemove` 中 unmount Vue 实例 + 重置翻译状态 + 隐藏翻译弹窗

### SPA URL 变化检测

由于 SPA 通过 `history.pushState/replaceState` 改变 URL 而不触发 `popstate`，需要 monkey-patch：

```typescript
history.pushState = function (...args) {
  origPushState.apply(this, args)
  onUrlChange('pushState')
}
history.replaceState = function (...args) {
  origReplaceState.apply(this, args)
  onUrlChange('replaceState')
}
// 同时监听 popstate 和 hashchange
window.addEventListener('popstate', () => onUrlChange('popstate'))
window.addEventListener('hashchange', () => onUrlChange('hashchange'))
```

URL 变化后延迟 800ms 执行：重置翻译状态 -> 重新扫描翻译。

### MutationObserver 监听 DOM 变化

监听 `document.body` 的 `childList` 和 `characterData` 变化，过滤纯属性修改，200ms 防抖后触发自动翻译扫描。

### 翻译初始化

Content Script 入口统一初始化三种翻译模式：

1. **划词翻译 (selection)**: `mouseup` 事件监听，检查 `translateMode === 'selection'`，获取选中文本后调用 `TranslateService.translateSelection()`
2. **点击翻译 (click)**: 通过 `initClickTranslate()` 初始化，独立的 click 事件监听
3. **自动翻译 (auto)**: 页面加载后首次触发 + 监听 settingsStorage 变化 + URL 变化时重新触发

翻译设置变化时的响应逻辑：
- 切换到 `auto` -> 立即触发翻译
- 从 `auto` 切走 -> 还原所有翻译 (`translateService.restoreAll()`)

### 跨标签页任务续接

页面加载后检查 `queuedTaskStorage`：
- 任务存在且未过期（30s 内）-> 清空存储 -> 动态导入 `usePipeline` -> 调用 `resumeQueuedTask()`
- 任务过期 -> 直接丢弃

### App.vue 组件

**核心状态**:
- `open: ref<boolean>` - 抽屉展开状态
- `showSettings: ref<boolean>` - 设置模态框显隐

**功能**:
- **浮动按钮**: `<FloatingButton @click="toggle" />`
- **聊天抽屉**: `<ChatDrawer :open="open" />`
- **设置模态框**: `<SettingsModal v-if="showSettings" />`
- **主题应用**: 通过 `getThemeById()` 获取主题 CSS 变量，设置到 shadowHost style
- **键盘快捷键**: `matchShortcut(e, sc)` 匹配用户配置的快捷键
- **文本选中自动发送**: `mouseup` 检测选中文本，`autoSendSelection` 支持 `off/manual/auto` 三种模式
- **跨标签页抽屉同步**: `watch(open)` 时写入 `drawerOpenStorage` + 发送 `aib-drawer-changed` 消息；接收 `aib-drawer-sync` 消息时更新本地状态（`syncingFromRemote` 标志防止循环）
- **国际化**: 监听 `settings.locale` 变化，调用 `setLocale()` 切换语言
- **自动化指令**: 接收 `automation` 类型消息，调用 `executeAutomationAction()` 执行

## 数据流

```
页面加载
    │
    ▼
defineContentScript.main(ctx)
    │
    ├─ initAllSkeletonIds()     <- 骨架 ID 打标
    ├─ new TranslateService()   <- 翻译服务初始化
    ├─ initClickTranslate()     <- 点击翻译
    ├─ mouseup 监听             <- 划词翻译
    ├─ settingsStorage.watch()  <- 翻译模式切换
    ├─ URL 变化检测             <- pushState/replaceState/popstate/hashchange
    ├─ MutationObserver         <- DOM 变化自动翻译
    │
    ▼
createShadowRootUi -> mount
    │
    ├─ createApp(App).use(Pinia)
    ├─ 注入 global.css 到 shadow root
    ├─ shadowHost 定位 (fixed, z-index max)
    │
    ▼
App.vue onMounted
    │
    ├─ settingsStore.init() + convStore.init()
    ├─ initI18n(locale)
    ├─ applyTheme()
    ├─ drawerOpenStorage.getValue() -> 恢复抽屉状态
    ├─ chrome.runtime.onMessage.addListener()
    │
    ▼
跨标签页续接检查
    │ queuedTaskStorage -> resumeQueuedTask()
    ▼
用户交互就绪
```

## 配置与扩展

- **CSS 注入模式**: `cssInjectionMode: 'ui'` 由 WXT 框架控制
- **匹配规则**: `matches: ['<all_urls>']` 在所有页面生效
- **翻译防抖间隔**: URL 变化 800ms，DOM 变化 200ms
- **跨标签页任务过期**: 30 秒硬编码阈值
- **shadowHost z-index**: `2147483647`（32 位整数最大值），确保在最顶层

## 已知限制

1. **Shadow DOM 事件穿透**: `mouseup` 事件需要检查 `isInExtensionUI()` 避免扩展内部操作干扰，但 `composedPath` 检测可能在极端场景下漏判。
2. **SPA 检测不完整**: 仅 monkey-patch `pushState/replaceState` + 监听 `popstate/hashchange`，无法覆盖所有框架的路由机制（如某些框架使用 `location.assign`）。
3. **翻译模式互斥**: 三种翻译模式（selection/click/auto）在同一时间只能激活一种，切换时需要手动还原前一种模式的状态。
4. **跨标签页同步延迟**: 抽屉状态同步通过 Background 中转广播，存在网络延迟，快速连续操作可能导致状态不一致。
5. **Store 初始化顺序**: `settingsStore.init()` 和 `convStore.init()` 并行执行，但后续代码依赖两者都完成，`Promise.all` 确保了这一点但异常时只 catch 不区分。
