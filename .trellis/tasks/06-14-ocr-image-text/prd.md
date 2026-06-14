# brainstorm: 前端OCR图片文字识别

## Goal

在浏览器扩展中集成 Tesseract.js，所有模型统一做 OCR 图片文字识别。上传图片时自动执行 OCR，识别结果作为文本内容附加到消息中发送给 AI。

## Requirements

- 集成 tesseract.js 依赖
- 所有图片上传后统一执行 OCR（不区分模型 vision 能力）
- OCR 识别语言：chi_sim+eng（中文简体+英文）
- OCR 进度在 UI 上显示（进度条/spinner）
- 不做图片预处理，直接识别
- 识别结果附加到消息文本中
- 支持图片的模型：同时发送图片 + OCR 文本
- 不支持图片的模型：只发送 OCR 文本（替换当前的"不支持图片"提示）

## Acceptance Criteria

- [ ] 安装 tesseract.js 并正确配置
- [ ] 图片上传后自动执行 OCR，显示进度
- [ ] 识别结果正确附加到消息文本中
- [ ] OpenAI 等支持图片的端点：图片 + OCR 文本都发送
- [ ] Anthropic/Qwen/Wenxin 等端点：OCR 文本替换"不支持图片"提示
- [ ] 不影响现有文件上传/预览流程

## Definition of Done

- Lint / typecheck 通过
- 各端点下图片消息行为正确

## Out of Scope

- 服务端 OCR（纯前端方案）
- 手写体识别优化（印刷体优先）
- 图片编辑/裁剪/预处理功能
- 多语言选择 UI（固定中文+英文）

## Technical Approach

**核心改动点：**

1. **`file-parsers.ts` — parseImage() 改造**
   - 图片转 base64 后，立即启动 Tesseract.js OCR
   - OCR 结果存入 `Attachment.content` 字段
   - 提供进度回调给 UI 层

2. **`openai.ts` — toOpenAIMessages() / toAnthropicMessages() 改造**
   - `toOpenAIMessages()`：图片部分不变，额外在 text 中附加 OCR 内容
   - `toAnthropicMessages()`：用 OCR 文本替换"不支持图片"提示
   - `collectFileTexts()`：已过滤 `type !== 'image'`，需要额外处理图片的 OCR 文本

3. **`InputBar.vue` — 进度显示**
   - 图片上传后显示 OCR 进度（复用 Tesseract.js logger 回调）

4. **类型扩展**
   - `Attachment` 接口：图片类型也可携带 `content`（OCR 文本）

## Decision (ADR-lite)

**Context**: 用户希望所有模型统一做 OCR，不区分 vision 能力。
**Decision**: 上传图片时统一执行 OCR，识别结果存入 Attachment.content。适配器根据端点能力决定发送方式。
**Consequences**: 所有图片都经过 OCR，增加处理时间；需显示进度；Tesseract.js 语言包首次下载约 4MB。

## Technical Notes

- `src/utils/file-parsers.ts` — 核心改造文件
- `src/adapters/openai.ts` — 消息构建改造
- `src/types.ts` — Attachment 接口调整
- `entrypoints/content/components/InputBar.vue` — 进度 UI
- `src/stores/conversations.ts` — send() 流程
- Tesseract.js v5：核心 ~2MB + chi_sim 语言包 ~4MB
- `ModelConfig.vision` 字段仍可用于判断是否同时发送图片数据
