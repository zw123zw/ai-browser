# brainstorm: 输入框上下箭头切换历史输入

## Goal

在 InputBar 的 textarea 中实现 Up/Down 箭头键切换历史输入（类似终端命令历史），让用户能快速回填之前发送过的文本消息。需要过滤掉纯文件消息（无文本内容、仅有附件的消息）。

## What I already know

* **项目类型**: Chrome Extension (Manifest V3)，WXT + Vue 3 + Pinia + TypeScript
* **输入组件**: `entrypoints/content/components/InputBar.vue`，基于 `<textarea>`，绑定 `conversation.draftText`
* **发送流程**: `send()` → emit `send` 事件 → `ChatPanel` → `conversationsStore.sendMessage()` → 将用户消息 push 到 `conversation.messages[]`
* **存储现状**: 使用 `wxt/storage`（封装 `chrome.storage.local`），当前存储的数据：
  - `local:zwf-settings` — 全局设置（provider、API key、模型列表等）
  - `local:zwf-conversation` — 单个活跃会话（messages、draftText、draftAttachments 等）
  - `local:zwf-fab-pos` — 悬浮按钮位置
  - `local:zwf-drawer-open` — 抽屉展开状态
  - `logs:frontend` / `logs:api` — 仅 debug 构建
* **消息结构**: `ChatMessage` 包含 `role`、`content`、`attachments?`、`timestamp`、`status`
* **当前无历史功能**: InputBar 没有 Up/Down 处理，没有 inputHistory 字段，发送后 draftText 清空
* **过滤逻辑**: 用户消息中，纯文件消息的特征是 `content` 为空且 `attachments` 非空

## Decision (ADR-lite)

**Context**: 需要在输入框实现 Up/Down 箭头切换历史输入，用户要求跨标签页、跨浏览器重启都可用。

**Decision**:
* **存储方案**: 独立 key `local:zwf-input-history`，使用 `chrome.storage.local` 持久化，跨标签页天然同步
* **去重策略**: 连续去重（与 bash history 行为一致）
* **上限**: 100 条
* **触发条件**: 仅空输入框按 Up 触发历史切换，有文本时 Up/Down 正常移动光标

**Consequences**:
* 新增一个 storage key，数据量极小（100 条文本约几 KB）
* 自动继承 WXT 的 `defineStorageSync` 双向同步机制
* 不影响现有存储结构

## Requirements (evolving)

* InputBar 的 textarea 监听 Up/Down 箭头键
* Up 回退到上一条历史输入，Down 前进到下一条
* 过滤掉纯文件消息（content 为空 + 有 attachments）
* 输入框为空时按 Up 才触发历史切换（有文本时不影响光标移动）
* 切换历史时保存当前未发送的草稿

## Acceptance Criteria (evolving)

* [x] 在空输入框按 Up 键，回填上一条历史文本输入
* [x] 连续按 Up 可逐条回退
* [x] 按 Down 可前进到下一条
* [x] 到达最新一条时，恢复为切换前的草稿文本
* [x] 纯文件消息不出现在历史中
* [x] 历史记录持久化（关闭浏览器后仍可用）

## Definition of Done

* 代码实现完成，功能可用
* 无 TypeScript 类型错误
* 存储方案合理，不影响现有功能

## Out of Scope

* 搜索历史功能（Ctrl+R 模式）
* 历史记录的 UI 管理界面（删除、编辑）
* 语音输入的历史

## Technical Approach

### 存储层（`src/storage/index.ts`）

新增 storage key:
```typescript
export const inputHistoryStorage = storage.defineItem<string[]>(
  'local:zwf-input-history',
  { fallback: [] }
);
```

### 写入时机（`src/stores/conversations.ts`）

在 `sendMessage()` 中，用户消息 push 到 messages 后，将文本写入历史：
```typescript
// 过滤：有文本内容才记录（跳过纯文件消息）
if (text.trim()) {
  pushInputHistory(text.trim());
}
```

`pushInputHistory` 逻辑：
1. 读取当前历史数组
2. 如果最后一条与新文本相同 → 跳过（连续去重）
3. 追加到末尾
4. 超过 100 条 → 截掉头部
5. 写回 storage

### 读取 + 导航（`InputBar.vue`）

在 `onKeydown` 中增加 Up/Down 处理：
- 仅当输入框为空（`text.value === ''`）且按下 Up 时，进入历史模式
- 维护 `historyIndex` 指针（-1 表示未进入历史模式）
- Up: index--，回填 `history[index]`
- Down: index++，到末尾时恢复原始草稿
- 进入历史模式时保存当前 draftText 作为 `savedDraft`

### 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/storage/index.ts` | 新增 `inputHistoryStorage` |
| `src/stores/conversations.ts` | sendMessage 中调用 `pushInputHistory` |
| `InputBar.vue` | onKeydown 增加 Up/Down 历史导航逻辑 |

## Technical Notes

* InputBar.vue: `E:\note\ai-browser\entrypoints\content\components\InputBar.vue`
* 类型定义: `E:\note\ai-browser\src\types.ts` (Conversation, ChatMessage)
* 存储: `E:\note\ai-browser\src\storage\index.ts`
* 会话 store: `E:\note\ai-browser\src\stores\conversations.ts`
* 发送消息时 push 用户消息: `conversations.ts:167`
* `onKeydown` 当前只处理 Enter: `InputBar.vue:298-303`
* `storage-sync.ts` 提供 `defineStorageSync` 双向同步，新 key 自动继承
