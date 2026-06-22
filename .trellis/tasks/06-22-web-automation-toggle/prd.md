# 网页自动化配置开关

## Goal

在设置 > 通用配置 > 快捷键下方，新增"网页自动化配置"区域，包含一个 Switch 开关（默认打开）。关闭后，所有网页自动化相关提示词不再注入到 AI 请求中，扩展退化为纯聊天 + 文件生成工具。

## Requirements

### UI 层
- SettingsModal.vue 通用配置 tab，快捷键区块下方新增"网页自动化配置"
- Switch 开关，默认 `true`（开启）
- 开关旁文字说明当前状态

### 存储层
- `AppSettings` 新增 `automationEnabled: boolean` 字段，默认 `true`
- 通过 `useSettingsStore().update()` 持久化到 chrome.storage

### 提示词层（核心）
- 新建 `buildPhase1Prompt(enabled: boolean)` 替代原 `PHASE1_SYSTEM_PROMPT` 静态常量
- 新建 `buildPhase2Prompt(enabled: boolean)` 替代原 `PHASE2_SYSTEM_PROMPT` 静态常量
- voice/session.ts 的 `COMMAND_SYSTEM_PROMPT` 改为根据开关动态构建
- EXTRACT_SYSTEM_PROMPT（download 专用）随开关一起禁用

### 禁用时移除的指令（共 16 个 + download）

**Phase 1（10 个）**: navigate, scroll, newTab, closeTab, nextTab, prevTab, switchTab, keyboard, wait, search
**Phase 2（7 个）**: click, type, clear, select, focus, hover, download
**Voice（7 个）**: open_site, search, site_search, open_item, page_next, page_prev, video_play/pause

### 调用链路
- `IntentDetector` 构造时接收 `getSettings`，调用 `buildPhase1Prompt(settings.automationEnabled)`
- `InputPipeline.callStreamingAI()` 调用 `buildPhase2Prompt(settings.automationEnabled)`
- `VoiceSession.callAI()` 调用动态 `COMMAND_SYSTEM_PROMPT`
- `buildExtractPrompt()` 接收 `enabled` 参数

## Acceptance Criteria

- [ ] 设置页通用配置 > 快捷键下方显示"网页自动化配置"Switch
- [ ] 默认开启，关闭后设置持久化到 chrome.storage
- [ ] 关闭后输入"打开百度" → AI 纯聊天回复，不生成 [command]/[action] 标签
- [ ] 关闭后输入"帮我翻译这段话" → 正常聊天，不受影响
- [ ] 开启后输入"打开百度" → 正常生成 [command] 并执行
- [ ] 语音指令同样受开关控制
- [ ] 类型检查通过（npm run compile）

## Decision (ADR-lite)

**Context**: 需要一个全局开关控制网页自动化能力的注入
**Decision**: 动态构建提示词函数方案 — 新建 `buildPhase1Prompt(enabled)` / `buildPhase2Prompt(enabled)` 函数，根据开关组装提示词
**Consequences**: 原有静态常量改为函数调用，改动集中在 prompts.ts + 调用方；维护一套代码，通过参数区分两种模式

## Out of Scope

- 不做细粒度指令选择（如只禁用部分指令）
- 不做按域名/页面的自动化白名单
- 不做 UI 上的指令列表展示

## Technical Notes

- 涉及文件：`src/types.ts`, `src/stores/settings.ts`, `src/input/prompts.ts`, `src/input/intent-detector.ts`, `src/input/pipeline.ts`, `src/voice/session.ts`, `entrypoints/content/components/SettingsModal.vue`
- AppSettings 类型定义在 `src/types.ts`
- Settings store 使用 `defineStorageSync` 模式
- Switch 组件样式已在 SettingsModal.vue 中定义（`.aib-switch` / `.aib-switch-on` / `.aib-switch-thumb`）
