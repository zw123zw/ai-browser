# feat: 文件下载保持原格式

## Goal

刷新页面后下载附件时，能根据文件类型生成对应格式的文件（xlsx、docx、pdf、图片等），而不是一律降级为 .txt。

## Problem

当前 `FilePreviewModal.vue` 的 `downloadFile()` 逻辑：

1. 优先从内存缓存获取原始 `File` 对象（`originalFileCache`）→ 原格式下载 ✅
2. 缓存丢失（刷新后）→ 用 `attachment.content`（纯文本）生成 `.txt` ❌

问题：
- 图片有 `dataUrl`（base64，持久化在 attachment 中），但下载逻辑没有处理 → 刷新后图片无法下载
- `.xlsx` 文件 content 是解析后的文本，可以反向用 xlsx 库生成 .xlsx，但当前只存 .txt
- `.docx`、`.pdf` 同理，可用库生成对应格式
- `.json`、`.csv`、`.md`、`.html` 等文本格式 content 就是原始内容，但被强制改扩展名为 .txt

## Requirements

### 下载优先级（从高到低）

| 优先级 | 条件 | 处理方式 |
|--------|------|---------|
| 1 | `originalFileCache` 有原始 File | 直接用原始 File 下载 |
| 2 | 图片类型 + 有 `dataUrl` | base64 → Blob → 原格式下载 |
| 3 | 扩展名在文本白名单中 | content 直接存，保持原扩展名 |
| 4 | `.xlsx` | 用 xlsx 库从 content 生成 |
| 5 | `.docx` | 用 docx 库从 content 生成 |
| 6 | `.pdf` | 用 jspdf 库从 content 生成 |
| 7 | 其他 | content 存为 .txt |

### 文本白名单（content 即原始内容）

```
.json, .csv, .tsv, .md, .txt, .html, .htm, .xml, .yaml, .yml,
.ini, .env, .log, .cfg, .conf, .toml,
.py, .js, .ts, .jsx, .tsx, .java, .go, .rs, .rb, .php,
.c, .cpp, .h, .hpp, .cs, .swift, .kt, .scala,
.sh, .bash, .zsh, .bat, .ps1,
.css, .scss, .less, .sql, .graphql
```

### xlsx 生成

- 已有 `xlsx` 依赖（MessageItem.vue 中用于表格下载）
- 刷新后 content 是纯文本，尝试解析为表格：
  - 如果 content 包含 tab 分隔 → 按 TSV 解析
  - 如果 content 包含 `|` 分隔（markdown 表格）→ 按 markdown 表格解析
  - 其他 → 按行分割，每行一个单元格

### docx 生成

- 新增依赖：`docx`（npm 包，纯前端生成 .docx）
- 从 content 生成简单文档：段落文本，保留换行

### pdf 生成

- 新增依赖：`jspdf`（npm 包，纯前端生成 .pdf）
- 从 content 生成简单文档：A4 页面，自动换行，支持中文需嵌入字体（或用 html 方案）

### 图片下载

- 检查 `attachment.type === 'image'` 且 `attachment.dataUrl` 存在
- 将 dataUrl base64 转为 Blob
- 用原文件名（.png/.jpg）下载

## Technical Approach

### 改动文件

| 文件 | 改动 |
|------|------|
| `entrypoints/content/components/FilePreviewModal.vue` | 重写 `downloadFile()` 函数 |
| `package.json` | 新增 `docx`、`jspdf` 依赖（如需要） |

### downloadFile() 伪代码

```typescript
function downloadFile() {
  const { attachment } = props;

  // 1. 原始 File（当前会话）
  const file = getOriginalFile(attachment);
  if (file) {
    triggerDownload(URL.createObjectURL(file), file.name);
    return;
  }

  // 2. 图片 dataUrl（刷新后仍在）
  if (attachment.type === 'image' && attachment.dataUrl) {
    const blob = dataUrlToBlob(attachment.dataUrl);
    triggerDownload(URL.createObjectURL(blob), attachment.name);
    return;
  }

  const content = attachment.content;
  if (!content || content.startsWith('[')) return;

  const ext = getExtension(attachment.name);

  // 3. 文本白名单
  if (TEXT_EXTENSIONS.has(ext)) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(URL.createObjectURL(blob), attachment.name);
    return;
  }

  // 4. xlsx
  if (ext === 'xlsx' || ext === 'xls') {
    downloadAsXlsx(content, attachment.name);
    return;
  }

  // 5. docx
  if (ext === 'docx' || ext === 'doc') {
    downloadAsDocx(content, attachment.name);
    return;
  }

  // 6. pdf
  if (ext === 'pdf') {
    downloadAsPdf(content, attachment.name);
    return;
  }

  // 7. 兜底 .txt
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const name = attachment.name.replace(/\.[^.]+$/, '') + '.txt';
  triggerDownload(URL.createObjectURL(blob), name);
}
```

## Acceptance Criteria

- [ ] 刷新页面后，图片附件可下载（原格式 .png/.jpg）
- [ ] 刷新页面后，.json/.csv/.md 等文本文件下载保持原扩展名
- [ ] 刷新页面后，.xlsx 附件可下载为 Excel 格式
- [ ] 刷新页面后，.docx 附件可下载为 Word 格式
- [ ] 刷新页面后，.pdf 附件可下载为 PDF 格式
- [ ] 不可识别格式兜底为 .txt
- [ ] 当前会话的原始 File 下载逻辑不变

## Out of Scope

- 不处理 .pptx、.zip 等复杂二进制格式
- 不保证 PDF 中文字体完美（可后续迭代）
- 不做文件内容格式校验（如损坏的 xlsx content）
