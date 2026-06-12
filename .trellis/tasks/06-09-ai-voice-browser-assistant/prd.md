# AI 浏览器语音助手 - Vite 打包 + 热更新 + 浏览器插件

## Goal

构建一个基于 WXT + Vue 3 + TypeScript 的浏览器扩展，整合：
- **AI 对话能力**（参考 browser-ai-chat-main 的现有架构）
- **语音控制 + 网页自动化**（参考 AI 浏览器助手方案）
- **本地热更新调试** + **Vite 生产打包**

最终产出一个可安装的浏览器插件 `.zip`。

## What I already know

### 参考项目 1: AI 浏览器助手方案
- 原生 JS 实现，无构建工具
- 核心能力：语音识别 → AI 语义解析 → 网页自动化操控
- 支持多模型切换：通义千问 / 文心一言 / 讯飞星火 / Ollama
- 文件结构：manifest.json, popup.html/css/js, content.js, background.js, model.config.js
- MV3 架构，background service_worker 模式

### 参考项目 2: browser-ai-chat-main
- **WXT 框架** + Vue 3 + TypeScript + Pinia
- Content Script 注入方式：Shadow DOM（不污染宿主页面）
- Adapter 模式适配不同 AI 协议（当前仅 OpenAI）
- 状态管理：Pinia stores (settings, conversations)
- 消息通信：chrome.runtime.onMessage
- 已有功能：对话面板、设置弹窗、快捷键切换、Markdown 渲染
- `wxt.config.ts` 配置了 Vite + esbuild

### 关键差异
| 维度 | 方案 1 (语音助手) | 方案 2 (AI Chat) |
|------|------------------|-----------------|
| 框架 | 原生 JS | WXT + Vue 3 + TS |
| UI | popup 弹窗 | Content Script 注入 |
| 核心功能 | 语音 + 自动化 | 对话 + 设置 |
| 模型适配 | 独立 config 文件 | Adapter 模式 |
| 状态管理 | 无 | Pinia |

## Assumptions (temporary)

- 使用 WXT 框架（内置 Vite + 热更新 + 多浏览器打包）
- 以 browser-ai-chat-main 为代码基础进行扩展
- 保留 Shadow DOM 注入方式
- 需要同时支持 popup 和 content script 两种 UI 形态

## Decision (ADR-lite)

**Context**: 需要选择项目架构方式
**Decision**: 以 browser-ai-chat-main (WXT + Vue 3 + TS) 为基础进行扩展
**Consequences**: 复用现有 AI 对话架构、Shadow DOM、Pinia 状态管理；新增 voice 和 automation 模块

## Decision (ADR-lite) - UI

**Context**: 语音控制的 UI 入口选择
**Decision**: 新增独立浮动面板，与现有 ChatDrawer 并存
**Consequences**: 需要新增 VoicePanel 组件，管理两个浮动面板的布局和交互

## Decision (ADR-lite) - 语音

**Context**: 语音识别方案选择
**Decision**: 使用 Web Speech API (SpeechRecognition)
**Consequences**: 零依赖免费，Chrome/Edge 支持好，后续可扩展其他方案

## Decision (ADR-lite) - 自动化

**Context**: 网页自动化操控范围
**Decision**: MVP 支持基础 + 中级（打开网站、全网搜索、站内搜索、点击第N个结果）
**Consequences**: 翻页、视频控制等高级功能后续迭代

## Open Questions

（已全部解决）

## Final Confirmation - APPROVED

**UI 设计**：一个浮动球 → ChatDrawer 内含文字/语音两个 Tab

**技术方案**：WXT + Vue 3 + TS + Pinia + Web Speech API

**功能范围**：
- AI 对话（多模型、会话管理、Markdown）
- 语音控制（连续对话、语音识别 → AI 解析）
- 网页自动化（打开网站、搜索、站内搜索、点击）
- 开发体验（热更新 + 生产打包）

**下一步**：进入实现阶段

## Requirements (final)

### 核心需求
1. **AI 对话**：复用现有 Adapter 模式，支持 OpenAI 兼容协议 + 国产模型
2. **语音控制**：Web Speech API 语音识别，独立浮动面板 UI
3. **网页自动化**：打开网站、全网搜索、站内搜索、点击第N个结果
4. **连续对话**：语音可以连续交互，无需每次点击麦克风
5. **热更新调试**：`npm run dev` 启动 WXT 开发模式，支持 HMR
6. **生产打包**：`npm run build` 生成可安装的浏览器扩展

### UI 组件
- **FloatingButton**：统一浮动球入口，点击打开面板
- **ChatDrawer**：主面板，内含模式切换 Tab
  - **文字模式 Tab**：现有对话功能（模型选择、多会话、文字输入）
  - **语音模式 Tab**：语音输入 + 连续对话 + AI 回复 + 网页自动化
- 模式切换通过 Tab 实现，不新增浮动球

### 模块划分
- `src/voice/`：语音识别核心（SpeechRecognition 封装）
- `src/automation/`：网页自动化操控（指令解析 + DOM 操作）
- `src/adapters/`：扩展支持国产模型（通义千问、文心一言等）
- `src/stores/`：扩展 Pinia store 管理语音状态

## Requirements (evolving)

- 基于 WXT 框架，支持 `wxt` 命令启动本地热更新
- 支持 `wxt build` 生产打包为浏览器扩展 `.zip`
- 集成 AI 对话能力（多模型支持）
- 集成语音控制能力
- 集成网页自动化操控能力
- Shadow DOM 注入，不污染宿主页面

## Acceptance Criteria (evolving)

- [ ] `npm run dev` 启动本地热更新，修改代码后浏览器自动刷新
- [ ] `npm run build` 生成可安装的浏览器扩展包
- [ ] 支持至少 2 种 AI 模型（OpenAI 兼容 + 国产模型）
- [ ] 语音输入 → AI 解析 → 网页操作 全链路可用
- [ ] Shadow DOM 隔离，不影响宿主页面样式

## Definition of Done

- 代码通过 TypeScript 类型检查
- 无 lint 错误
- README 文档完整
- 可在 Chrome/Edge 中加载使用

## Out of Scope (explicit)

- Firefox 特殊适配（后续扩展）
- 移动端浏览器支持
- 服务端部署
- 用户账号系统

## Technical Notes

- WXT 框架文档: https://wxt.dev
- WXT 内置 Vite，支持 HMR 热更新
- Content Script 通过 Shadow DOM 注入需要 `cssInjectionMode: 'ui'`
- Chrome MV3 要求 background 使用 service_worker
- Web Speech API (SpeechRecognition) 需要 `microphone` 权限
- 参考代码位于 `docs/browser-ai-chat-main/`
- 原始方案位于 `docs/AI 浏览器助手.txt`
