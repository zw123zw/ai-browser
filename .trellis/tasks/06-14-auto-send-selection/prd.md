# 选中文字自动发送AI分析

## Goal

当用户在页面上选中一段文字，且右侧聊天抽屉已打开时，自动将选中的文字发送给 AI 进行分析，无需用户手动复制粘贴。

## What I already know

- 项目是 WXT + Vue 3 + TypeScript + Pinia 的浏览器扩展
- 聊天抽屉是 Shadow DOM 渲染的右侧滑入面板
- 消息发送流程：InputBar → ChatPanel → conversations store → adapter → AI API
- 目前没有任何文字选中检测机制
- Content script 运行在隔离的 Shadow DOM 中，但可以通过 `document.getSelection()` 读取页面选中文字
- 现有 toggle 机制：FloatingButton 点击、Chrome message、键盘快捷键

## Decision (ADR-lite)

**Context**: 选中文字后如何触发发送
**Decision**: 方案 A — 直接自动发送，选中文字后立即作为用户消息发送给 AI
**Consequences**: 零摩擦体验，但误选中也会触发；后续可通过设置开关缓解

## Decision (ADR-lite) — 触发时机

**Context**: 选中动作如何判定
**Decision**: mouseup 事件检测，用户松开鼠标时检查是否存在选中文字
**Consequences**: 实现简单可靠，但键盘选择（Shift+方向键）不会触发

## Decision (ADR-lite) — 抽屉状态

**Context**: 选中文字时抽屉是否需要已打开
**Decision**: 抽屉必须已打开，选中文字才触发自动发送
**Consequences**: 用户主动控制，不会意外弹出抽屉；但需要先打开抽屉再选中文字

## Decision (ADR-lite) — 功能开关

**Context**: 是否需要设置开关
**Decision**: 在通用配置中添加"选中文字自动发送"开关，默认开启
**Consequences**: 用户可按需关闭，增加一个设置项

## Decision (ADR-lite) — 长度限制

**Context**: 选中文字是否需要长度限制
**Decision**: 不限制，选中多少发多少
**Consequences**: 简单直接，但超长文字可能浪费 token

## Decision (ADR-lite) — 发送反馈

**Context**: 发送后需要什么视觉反馈
**Decision**: 无额外反馈，选中文字直接作为用户消息出现在聊天列表
**Consequences**: 最简洁，用户通过聊天内容自然感知

## Open Questions

- 选中文字后是自动发送，还是先填入输入框让用户确认？
- 是否需要在选中文字时显示一个浮动按钮/菜单作为触发器？
- 这个功能是否需要一个设置开关？
- 选中文字的长度是否需要限制？

## Requirements

1. 在 content script 中监听主页面的 `mouseup` 事件
2. 当抽屉处于打开状态时，检测 `document.getSelection()` 是否有选中文字
3. 如果有选中文字，自动将其作为用户消息发送给 AI（调用 `convStore.send()`）
4. 在通用设置中添加"选中文字自动发送"开关，默认开启
5. 开关闭合时，mouseup 事件不触发自动发送
6. 选中文字直接作为用户消息出现在聊天列表，AI 开始流式回复

## Acceptance Criteria

- [ ] 抽屉打开时，鼠标选中页面文字后自动发送给 AI
- [ ] 抽屉关闭时，选中文字不触发发送
- [ ] 设置中可切换"选中文字自动发送"开关
- [ ] 开关关闭后，选中文字不触发发送
- [ ] 选中文字在聊天中正确显示为用户消息
- [ ] AI 正常流式回复选中文字的分析结果

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes

## Out of Scope (explicit)

- 键盘选择（Shift+方向键）触发发送
- 选中文字时显示浮动按钮/菜单
- 自动打开抽屉
- 选中文字长度限制
- 发送时的 Toast 提示

## Technical Approach

### 核心流程

1. 在 `App.vue` 中添加 `mouseup` 事件监听器（监听主页面 document）
2. 事件处理函数中检查：
   - 抽屉是否打开（`open` ref）
   - 功能开关是否启用（从 settings store 读取）
   - `document.getSelection()` 是否有非空选区
3. 如果条件满足，获取选中文字，调用 `convStore.send(selectedText, [], false)`
4. 发送后清除选区（`window.getSelection().removeAllRanges()`）

### 设置项

- 在 `src/storage/index.ts` 的 `AppSettings` 中添加 `autoSendSelection: boolean`
- 默认值 `true`
- 在 `SettingsModal.vue` 的通用配置区域添加开关

### 关键修改文件

| 文件 | 修改内容 |
|------|---------|
| `entrypoints/content/App.vue` | 添加 mouseup 监听、自动发送逻辑 |
| `src/types.ts` | AppSettings 添加 autoSendSelection 字段 |
| `src/storage/index.ts` | 默认值添加 autoSendSelection: true |
| `src/stores/settings.ts` | 确保新字段被正确加载 |
| `entrypoints/content/components/SettingsModal.vue` | 添加开关 UI |

### Implementation Plan

- **PR1**: 类型定义 + 存储默认值 + 设置开关 UI
- **PR2**: App.vue 添加 mouseup 监听和自动发送逻辑
- **PR3**: 边界情况处理 + 测试

## Technical Notes

- 关键文件：
  - `entrypoints/content/index.ts` — Content script bootstrap
  - `entrypoints/content/App.vue` — Root component, toggle logic
  - `entrypoints/content/components/ChatPanel.vue` — Chat panel, send orchestration
  - `entrypoints/content/components/InputBar.vue` — Text input, send trigger
  - `src/stores/conversations.ts` — Core send logic
  - `src/types.ts` — Type definitions
  - `src/storage/index.ts` — Storage keys
- 选中文字检测需要在 content script 层面用 `document.getSelection()` 实现
- 由于 Shadow DOM 隔离，事件监听器需要挂在主页面的 document 上
- 需要注意避免在抽屉内部选中文字时也触发发送（应该只监听页面选区）
