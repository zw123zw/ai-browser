# 文件解析架构

## 概述

文件上传后经过三个阶段：**类型识别 → 按类型解析 → 通用兜底**。所有路径最终都产出纯文本或占位符字符串，不存在真正的"二进制读取"路径。

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/utils/file-type.ts` | 文件类型检测与分类 |
| `src/utils/file-parsers.ts` | 统一解析入口 + 各类型解析器 |
| `src/utils/ocr.ts` | 图片 OCR（Tesseract.js） |
| `src/utils/file.ts` | `fileToDataURL` 工具函数 |
| `src/types.ts` | `Attachment` / `AttachmentType` 类型定义 |
| `entrypoints/content/components/InputBar.vue` | UI 层：文件选择、粘贴、OCR 触发 |

## 第一步：类型识别

`detectFileType(file)` 按优先级返回 7 种 `AttachmentType`：

```
图片(image) → PDF → Word → Excel → 代码(code) → 文本(text) → 兜底(binary)
```

| 优先级 | 类型 | 判断依据 |
|--------|------|----------|
| 1 | `image` | MIME 以 `image/` 开头 |
| 2 | `pdf` | 扩展名 `pdf` 或 MIME `application/pdf` |
| 3 | `word` | 扩展名 `doc`/`docx` 或对应 MIME |
| 4 | `excel` | 扩展名 `xls`/`xlsx` 或对应 MIME（CSV/TSV 不算 excel） |
| 5 | `code` | 扩展名命中 57 种代码文件映射表（`CODE_EXTENSIONS`） |
| 6 | `text` | 扩展名在 `TEXT_EXTENSIONS` / 文件名匹配 `TEXT_FILENAMES` / MIME `text/*` / 无扩展名无 MIME 的兜底 |
| 7 | `binary` | 以上都不匹配 |

### text 类型的多重兜底

`text` 本身有四层判断，最后一层是真正的兜底：

1. 扩展名匹配（`txt`, `log`, `csv`, `tsv` 等）
2. 无扩展名文件名匹配（`LICENSE`, `README`, `Makefile` 等）
3. MIME 匹配（`text/*`）
4. **无扩展名 + 无 MIME / `application/octet-stream`** → 归为 `text`

`binary` 只捕获"有扩展名但不识别"的文件。

## 第二步：按类型解析

`parseFile(file)` 根据类型分发到专用解析器：

```
parseFile(file)
  │
  ├─ image  → parseImage()     → FileReader.readAsDataURL → base64 dataUrl
  ├─ text   → parseText()      → FileReader.readAsText → UTF-8
  ├─ code   → parseText()      → FileReader.readAsText → UTF-8 + lang 标识
  ├─ pdf    → parsePdf()       → pdfjs-dist 逐页提取文字
  ├─ word   → parseWord()      → mammoth.extractRawText
  ├─ excel  → parseExcel()     → xlsx 库转 CSV（CSV/TSV 直接读文本）
  └─ binary → parseBinary()    → tryReadAsText() → 成功返回 text，失败返回占位符
```

### 各类型解析细节

| 类型 | 解析器 | 库 | 大小限制 | 输出 |
|------|--------|-----|---------|------|
| image | `parseImage` | FileReader | 20 MB | base64 dataUrl，content 为空 |
| text | `parseText` | FileReader | 2 MB（截断到 500KB） | UTF-8 文本 |
| code | `parseText` | FileReader | 2 MB（截断到 500KB） | UTF-8 文本 + lang 标识 |
| pdf | `parsePdf` | pdfjs-dist | 10 MB | 提取的文字，失败返回占位符 |
| word | `parseWord` | mammoth | 10 MB | 提取的文字，失败返回占位符 |
| excel | `parseExcel` | xlsx | 10 MB | CSV 文字，失败返回占位符 |
| binary | `parseBinary` | — | — | tryReadAsText 成功返回 text，失败返回占位符 |

### 图片 OCR

图片解析 (`parseImage`) 只负责转 base64 dataUrl，**不触发 OCR**。

OCR 在 UI 层 (`InputBar.vue`) 异步触发，不阻塞附件添加：

- 使用 Tesseract.js，语言包 `chi_sim+eng`（简体中文 + 英文）
- 30 秒超时，失败静默返回空字符串
- OCR 结果写入 `attachment.content`，UI 显示进度条

## 第三步：通用兜底

### tryReadAsText 函数

所有兜底逻辑的核心：

```
读 UTF-8 → 去掉 null 字节 → 去掉控制字符 → 可打印字符 ≥ 10？
  ├─ 是 → 返回 text/code 附件
  └─ 否 → 返回 null
```

### 触发时机

**时机一**：`parseBinary()` 内部直接调用
```typescript
async function parseBinary(file: File): Promise<Attachment> {
  const textResult = await tryReadAsText(file);
  if (textResult) return textResult;
  return { content: '[不支持预览此文件类型: ...]' };
}
```

**时机二**：`parseFile()` 后处理，仅限非 binary 类型
```typescript
// 专用解析器失败或内容为空时，尝试按文本读取作为兜底
if (type !== 'binary' && (!attachment.content || attachment.content.startsWith('['))) {
  const textFallback = await tryReadAsText(file);
  if (textFallback) attachment = textFallback;
}
```

这意味着：PDF/Word/Excel 解析失败后，还会再尝试当纯文本读一次。

## 完整流程图

```
文件上传
  │
  ├─ image → base64 显示，UI 异步 OCR → content 写入识别文字
  │
  ├─ text/code → 直接读 UTF-8
  │
  ├─ pdf/word/excel → 专用库提取文字
  │     │
  │     ├─ 成功 → 纯文本
  │     └─ 失败（空内容或占位符）→ tryReadAsText() 再试一次
  │           ├─ 成功 → 纯文本
  │           └─ 失败 → 保留占位符
  │
  └─ binary → tryReadAsText()
        ├─ 成功 → 纯文本
        └─ 失败 → 占位符 "[不支持预览此文件类型]"
```

## 发送给 LLM

所有附件最终以文本形式拼接到消息中，不存在二进制传输：

```typescript
// 图片附件
`[图片文字识别: ${name}]\n${ocrText}`

// 其他附件（含占位符）
`[文件: ${name}]\n\`\`\`${lang}\n${content}\n\`\`\``
```

占位符（如 `[不支持预览此文件类型]`）也会发给 AI，因为 `content` 不为空。AI 会收到文件名和类型信息，知道该附件无法解析。
