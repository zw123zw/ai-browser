# Background Service Worker

## 模块概述

Background Service Worker 是扩展的后台中枢，运行在 Manifest V3 的 Service Worker 上下文中。作为所有 content script 与外部网络之间的消息代理，承担流式请求转发、标签页管理、跨标签页状态同步三大核心职责。

**源文件**: `entrypoints/background.ts`

## 架构设计

```
┌─────────────────────────────────────────────────────┐
│                Background Service Worker             │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Message Hub  │  │ Stream Proxy │  │ Tab Mgmt  │ │
│  │              │  │              │  │           │ │
│  │ chrome.runtime│  │ activeStreams│  │ newTab    │ │
│  │ .onMessage   │  │ Map<id,rdr>  │  │ closeTab  │ │
│  └──────┬───────┘  └──────┬───────┘  │ switchTab │ │
│         │                 │          └───────────┘ │
└─────────┼─────────────────┼────────────────────────┘
          │                 │
    ┌─────▼─────┐    ┌──────▼──────┐
    │  Content   │    │  External   │
    │  Scripts   │    │  APIs (SSE) │
    └───────────┘    └─────────────┘
```

### 消息类型一览

| 消息类型 | 方向 | 用途 |
|---------|------|------|
| `get-tab-id` | Content -> BG | 获取当前标签页 ID（跨标签页续接） |
| `read-local-file` | Content -> BG | 读取 `file://` 本地文件（Content Script 受限） |
| `proxy-fetch` | Content -> BG | 代理普通 HTTP 请求（规避 CORS） |
| `proxy-fetch-stream` | Content -> BG | 代理 SSE 流式请求 |
| `stream-chunk` | BG -> Content | 转发流式数据块 |
| `stream-end` | BG -> Content | 流结束通知 |
| `stream-error` | BG -> Content | 流错误通知 |
| `abort-stream` | Content -> BG | 中止进行中的流式请求 |
| `aib-toggle` | BG -> Content | 工具栏图标/快捷键触发抽屉开关 |
| `aib-drawer-changed` | Content -> BG -> All | 抽屉状态变更（广播同步） |
| `aib-drawer-sync` | BG -> Content | 接收其他标签页的抽屉状态 |
| `tab-action` | Content -> BG | 标签页操作（newTab/closeTab/switchTab） |

## 核心类型定义

```typescript
// 活跃流跟踪
interface ActiveStream {
  reader: ReadableStreamDefaultReader;
  tabId: number;
}

// activeStreams: Map<string, ActiveStream>
// key = requestId (格式: stream_{timestamp}_{random7})

// 站点别名映射
type SITE_ALIASES = Record<string, string[]>;
// key = 用户输入（小写），value = 匹配关键词列表
```

## 实现细节

### 流式请求代理（SSE）

流式代理是 Background 最核心的功能，流程如下：

1. Content script 发送 `proxy-fetch-stream` 消息，携带 `url/method/headers/body`
2. Background 生成唯一 `requestId`，发起 `fetch()` 请求
3. 通过 `sendResponse` 立即返回 `{ success: true, streaming: true, requestId }`
4. 获取 `res.body.getReader()`，进入 `while(true)` 读取循环
5. 每次 `reader.read()` 后，将 buffer 通过 `chrome.tabs.sendMessage` 转发 `stream-chunk`
6. 循环结束（done=true）后发送 `stream-end`
7. 整个 reader 和 tabId 存入 `activeStreams` Map，支持中止

**中止机制**: Content script 发送 `abort-stream` + requestId，Background 调用 `reader.cancel()` 并从 Map 中移除。读取循环在每次迭代时检查 `activeStreams.has(requestId)`，如果已被移除则 break。

**错误处理**: 流读取异常时，检查是否为中止导致（`!activeStreams.has(requestId)`），若是则静默退出，否则发送 `stream-error` 到 content script。

### 本地文件读取

Content Script 受浏览器安全策略限制无法直接 `fetch('file://...')`。Background 通过 `read-local-file` 消息代理读取，返回 base64 编码的文件内容和 MIME 类型。

### 标签页管理

`tab-action` 支持三种操作：

- **newTab**: `chrome.tabs.create` + 自动聚焦新标签页和窗口
- **closeTab**: 关闭发送方标签页（`sender.tab.id`）
- **switchTab**: 支持两种模式
  - 相对切换: `query='next'/'prev'`，基于当前窗口标签页列表的索引循环
  - 关键词匹配: 使用 `SITE_ALIASES` 扩展匹配词，在所有标签页的 title/url 中查找

### 跨标签页抽屉同步

当某个标签页的抽屉状态变化时，通过 `aib-drawer-changed` 消息通知 Background，Background 遍历所有标签页广播 `aib-drawer-sync`（排除发送方），实现多标签页抽屉状态同步。

### 工具栏与快捷键

- `chrome.action.onClicked`: 点击工具栏图标，发送 `aib-toggle`
- `chrome.commands.onCommand`: 快捷键（`toggle-chat` 命令），发送 `aib-toggle`

## 数据流

```
用户操作 AI 对话
    │
    ▼
Content Script (useAdapter.chat)
    │ proxy-fetch-stream { url, headers, body }
    ▼
Background Service Worker
    │ fetch(url) -> SSE 流
    │ reader.read() loop
    │ stream-chunk { requestId, chunk }
    ▼
Content Script (adapter callback)
    │ 解析 chunk -> 更新 UI
    ▼
用户看到流式输出
```

## 配置与扩展

- **无外部配置**: Background Worker 不读取用户设置，纯消息转发角色
- **站点别名扩展**: `SITE_ALIASES` 对象可直接添加新的中英文别名映射
- **请求 ID 生成**: `stream_{Date.now()}_{random7}` 格式，碰撞概率极低
- **MIME 检测**: `read-local-file` 依赖 `res.headers.get('content-type')`，无后缀推断

## 已知限制

1. **Service Worker 生命周期**: Manifest V3 的 Service Worker 可能被浏览器回收（idle 30s），活跃流会中断。当前无 keep-alive 机制。
2. **单流无并发控制**: `activeStreams` 无上限，极端情况下可能同时存在大量流式请求。
3. **sendResponse 时序**: 流式代理中 `sendResponse` 在 fetch 成功后立即调用，但流数据通过独立的 `sendMessage` 通道传输，两条通道无严格顺序保证。
4. **标签页切换无权限检查**: `switchTab` 按关键词匹配可能切换到非预期标签页（如多标签页标题相似）。
5. **无重试机制**: 流式请求失败后直接通知 content script 错误，Background 层不做重试。
