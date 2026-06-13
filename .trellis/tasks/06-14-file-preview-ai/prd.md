# brainstorm: 全文件类型支持 - 预览与AI发送

## Goal

扩展现有的纯图片附件系统，支持常见文件类型（txt, md, json, csv, pdf, docx, code files 等）的上传、预览、和发送给 AI。用户点击附件可预览文件内容，文本类文件按原样读取显示，所有文件内容可发送给大模型进行分析。

## What I already know

### 当前图片处理流程
- **入口**: InputBar.vue 的 `<input type="file" accept="image/*" multiple>` + 剪贴板粘贴
- **转换**: `fileToDataURL()` → FileReader.readAsDataURL → base64 dataURL
- **存储**: `ChatMessage.images: string[]` (base64 dataURL 数组)
- **发送**: OpenAI adapter 的 `toRequestMessages()` 将 images 转为 `{type: 'image_url', image_url: {url}}` content parts
- **显示**: MessageItem.vue 中 220x220px 缩略图，无点击放大
- **限制**: 仅 `image/*` MIME 类型，无文件大小限制，无压缩

### 当前文件处理的空白
- 文件输入 `accept="image/*"` — 只允许图片
- 粘贴处理只检查 `type.startsWith('image/')`
- `ChatMessage` 类型无通用附件字段，只有 `images?: string[]`
- 无拖拽上传
- 无文件预览功能（图片也没有点击放大）
- Qwen/Wenxin adapter 完全忽略图片

### AI API 支持的多模态格式
- **OpenAI/兼容**: `image_url` content part (base64 dataURL) — 仅图片
- **Anthropic**: `image` content block (base64) + `document` content block (base64 PDF/文本)
- **通用方式**: 将文件内容作为文本拼入 `content` 字段 — 所有模型都支持

### 关键文件
| 文件 | 作用 |
|------|------|
| `src/types.ts` | ChatMessage, Conversation 类型定义 |
| `src/utils/file.ts` | fileToDataURL() 工具函数 |
| `src/adapters/openai.ts` | toRequestMessages() 多模态消息构造 |
| `src/adapters/qwen.ts` | 仅文本，忽略图片 |
| `src/adapters/wenxin.ts` | 仅文本，忽略图片 |
| `entrypoints/content/components/InputBar.vue` | 文件选择/粘贴 UI |
| `entrypoints/content/components/MessageItem.vue` | 消息渲染（含图片显示） |
| `src/stores/conversations.ts` | send() 方法，消息构建 |
| `src/styles/global.css` | 所有样式 |

## Decision: 全格式支持

用户选择全格式支持：文本/代码 + PDF + Word/Excel/PPT。

### 需引入的依赖
- **pdf.js** (`pdfjs-dist`): ~400KB，浏览器端解析 PDF 为文本
- **mammoth.js** (`mammoth`): ~100KB，docx 转文本/HTML
- **xlsx** (`xlsx`/`SheetJS`): ~300KB，xlsx/csv 解析
- **文本/代码文件**: 零依赖，FileReader.readAsText()

### 文件分类处理策略
| 类型 | 读取方式 | 预览方式 | 发送AI |
|------|----------|----------|--------|
| 文本/代码 (txt, md, json, csv, js, ts, py...) | FileReader.readAsText() | 语法高亮显示 | 文本拼入 content |
| PDF | pdf.js extractText() | pdf.js 渲染/文本提取 | 文本拼入 content |
| Word (docx) | mammoth.extractRawText() | 文本/HTML 预览 | 文本拼入 content |
| Excel (xlsx/xls) | xlsx.read() → CSV/文本 | 表格预览 | CSV 文本拼入 content |
| 图片 (已有) | fileToDataURL() | 缩略图 | base64 image_url |
| 二进制/不支持 | — | 显示元信息 | 提示不支持 |

## Assumptions (temporary)

- 浏览器端 FileReader API 可读取文本文件内容
- pdf.js 可在浏览器扩展 content script 环境运行（Web Worker 可能受限）
- mammoth.js 纯 JS，无外部依赖，扩展环境兼容
- xlsx (SheetJS) 社区版免费可用
- 大文件需要截断策略（避免撑爆 AI context window）
- 浏览器扩展环境支持 ES module import 和 npm 依赖

## Open Questions

- 文件大小上限？（建议文本 100KB，PDF 10MB，Office 10MB）
- 预览是弹窗/modal 还是在聊天气泡内展开？

## Requirements (evolving)

- 支持常见文本文件上传（txt, md, json, csv, xml, yaml, log, ini, env 等）
- 支持代码文件上传（js, ts, py, java, go, rust, c, cpp, html, css, sql, sh 等）
- 支持 PDF 文件上传和文本提取（pdf.js）
- 支持 Word 文档上传和文本提取（mammoth.js）
- 支持 Excel/CSV 上传和表格解析（xlsx/SheetJS）
- 文件内容可读取为文本并发送给 AI
- 文件点击可预览内容（文本/代码高亮，PDF/Office 文本提取后显示）
- 保持现有图片上传功能不变
- InputBar 支持同时上传图片和文件
- 消息气泡中显示附件列表（文件名+类型图标+文件大小）
- 附件预览：点击弹出居中 Modal，显示文件内容（代码高亮），ESC/遮罩关闭
- 大文件截断保护：文本最大 100KB，PDF/Office 最大 10MB，超出提示用户
- 文本超长自动截断到 100KB，消息中提示"文件已截断"
- 不支持的文件类型显示友好提示

## Acceptance Criteria (evolving)

- [ ] 文件选择器支持 txt/md/json/csv/代码文件等
- [ ] 选择文件后在输入区显示文件名+大小+类型图标
- [ ] 点击附件可预览文件内容（文本/代码高亮显示）
- [ ] 发送消息时文件内容作为文本发送给 AI
- [ ] 消息气泡中展示附件列表
- [ ] 消息气泡中附件可点击预览
- [ ] 保持现有图片功能不变
- [ ] 支持同时附加图片和文件

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- 文件上传到服务器/云存储
- 文件拖拽上传（后续迭代）
- 图片点击放大/lightbox（后续迭代）
- Qwen/Wenxin adapter 的图片支持修复（独立任务）
- PPT 解析（pptx 解析库体积大，可后续迭代）
- 音视频文件支持
- 文件编辑功能

## Technical Notes

- 文件读取使用 FileReader.readAsText() 读取文本内容
- 文件类型判断基于 MIME type 和文件扩展名
- 预览组件需要支持代码语法高亮（可复用已有的 highlight.js）
- 统一 attachments 字段取代现有 images 字段
- AI 发送时将文件内容格式化为：`[文件: name.ext]\n\`\`\`lang\ncontent\n\`\`\``

## Implementation Plan (small PRs)

### PR1: 类型系统 + 文件工具层
- 新增 `src/types.ts` 中的 `Attachment` 接口
- 新增 `src/utils/file-parsers.ts` — 统一的文件解析入口
  - `parseTextFile(file: File): Promise<Attachment>` — FileReader.readAsText
  - `parsePdfFile(file: File): Promise<Attachment>` — pdf.js 提取文本
  - `parseWordFile(file: File): Promise<Attachment>` — mammoth.js 提取文本
  - `parseExcelFile(file: File): Promise<Attachment>` — xlsx 转 CSV 文本
  - `parseFile(file: File): Promise<Attachment>` — 自动路由到对应解析器
- 新增 `src/utils/file-type.ts` — 文件类型检测和分类
- 安装依赖: `pdfjs-dist`, `mammoth`, `xlsx`

### PR2: InputBar 改造 — 文件选择与预览
- 修改 `InputBar.vue`:
  - 文件选择器 `accept` 改为 `*/*` 或列出所有支持类型
  - `pickImages()` 重命名为 `pickFiles()`，调用 `parseFile()`
  - 粘贴处理扩展到非图片文件
  - 输入区预览：图片缩略图 + 文件卡片（图标+文件名+大小+删除按钮）
- 修改 `conversations.ts`:
  - `draftImages` 迁移为 `draftAttachments`
  - `send()` 方法适配新字段

### PR3: MessageItem 改造 — 消息展示 + 预览 Modal
- 修改 `MessageItem.vue`:
  - `images` 渲染迁移到 `attachments` 渲染
  - 新增文件附件卡片展示（图标+文件名+大小）
  - 点击附件触发预览 Modal
- 新增 `FilePreviewModal.vue`:
  - 居中弹窗，显示文件名、类型、大小
  - 文本/代码：语法高亮显示内容
  - PDF：文本提取后显示
  - Office：文本提取后显示
  - 图片：全尺寸显示
  - ESC / 遮罩关闭

### PR4: Adapter 层适配
- 修改 `openai.ts` 的 `toRequestMessages()`:
  - 图片 attachments → `image_url` content parts（保持现有行为）
  - 文本 attachments → 拼入 content 文本
  - PDF/Office → 提取的文本拼入 content
- 修改 `qwen.ts` / `wenxin.ts`:
  - 至少支持文本附件（拼入 content）
  - 图片仍然可选择性忽略（这些 API 可能不支持）

### PR5: 收尾 — 迁移 + 边界处理
- 旧数据兼容：`images` 字段自动迁移到 `attachments`
- 大文件截断逻辑（文本 > 100KB）
- 不支持的文件类型友好提示
- 文件大小校验（PDF/Office > 10MB 拒绝）
- 全局样式调整

## Decision (ADR-lite)

### 数据模型: 统一 attachments 字段

**Context**: ChatMessage 目前只有 `images?: string[]`（base64 数组），需要支持多种文件类型。
**Decision**: 创建统一的 `Attachment` 接口，图片和文件共用一个 `attachments` 字段，废弃 `images` 字段。
**Consequences**:
- 需要迁移现有图片相关代码（InputBar, MessageItem, conversations store, adapters）
- 结构清晰，未来扩展容易（加新类型只需加 type 枚举值）
- 一次性改动量较大但收益高

### 预览方式: 弹窗 Modal

**Context**: 用户点击附件需要预览内容。
**Decision**: 居中弹窗 Modal，代码高亮显示，ESC/遮罩关闭。
**Consequences**: 实现简单，不干扰聊天流，复用已有 highlight.js。

### 文件范围: 全格式支持

**Context**: 用户需要支持文本/代码 + PDF + Word + Excel。
**Decision**: 引入 pdf.js + mammoth.js + xlsx 三个依赖。
**Consequences**: 包体积增加约 800KB，但覆盖所有常见文件格式。
