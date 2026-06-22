# 文件功能参考

文件上传解析、OCR 识别、文件生成和 `[FILE]` 标签系统。

## 功能总览

| 功能 | 说明 |
|------|------|
| 文件解析 | 7 种文件类型自动识别和解析 |
| OCR | 图片文字识别（Tesseract.js） |
| 文件生成 | 5+ 种格式文件生成和下载 |
| [FILE] 标签 | AI 回复中的文件输出标记 |
| ECharts 图表 | 动态图表渲染和导出 |

---

## 文件解析

### 支持的文件类型

| 类型 | 格式 | 大小限制 | 处理方式 | 输出 |
|------|------|---------|---------|------|
| image | png/jpg/gif/webp/svg | 20MB | FileReader → dataURL | base64 dataUrl |
| text | txt/md/csv/log | 2MB | FileReader → UTF-8（截断到 500KB） | 纯文本 |
| code | 57+ 语言扩展名 | 2MB | FileReader → UTF-8 + lang 标识 | 语法高亮文本 |
| pdf | pdf | 10MB | pdfjs-dist 逐页提取文字 | 纯文本 |
| word | doc/docx | 10MB | mammoth.extractRawText | 纯文本 |
| excel | xlsx/xls | 10MB | xlsx 库转 CSV | CSV 文本 |
| binary | 其他 | — | tryReadAsText 降级 | 文本或占位符 |

### 类型检测优先级

```
图片(MIME) → PDF(ext/MIME) → Word(ext/MIME) → Excel(ext/MIME)
→ 代码(57+扩展名) → 文本(扩展名/文件名/MIME) → 兜底(binary)
```

**代码文件扩展名（57+ 种）：** js, ts, jsx, tsx, py, java, c, cpp, h, cs, go, rs, rb, php, swift, kt, sh, sql, html, css, json, yaml, xml, toml, vue, svelte 等。

### 解析失败兜底

所有类型解析失败后，都会尝试 `tryReadAsText()` 降级：

```
读 UTF-8 → 去掉 null 字节 → 去掉控制字符 → 可打印字符 ≥ 10？
  ├─ 是 → 返回 text 附件
  └─ 否 → 返回占位符 "[不支持预览此文件类型]"
```

---

## OCR（图片文字识别）

**引擎：** Tesseract.js

**语言：** `chi_sim` + `eng`（简体中文 + 英文）

**超时：** 30 秒

**触发方式：** 在 `InputBar.vue` 中异步触发（`ocrAttachment()`），不阻塞附件添加

**流程：**

1. 用户上传图片附件 → 立即添加到附件列表（显示预览）
2. 后台异步启动 OCR
3. 识别完成后写入 `attachment.content`
4. UI 显示识别进度条

**语言包加载：** 从扩展本地路径 `chrome.runtime.getURL('/tesseract')` 加载。

---

## 文件生成

| 格式 | 函数 | 说明 |
|------|------|------|
| XLSX | `generateXlsx(rows)` | 从二维数组生成 Excel |
| CSV→XLSX | `generateXlsxFromCsv(csv)` | CSV 文本转 Excel |
| DOCX | `generateDocx(content)` | 文本按行分割为段落生成 Word |
| PDF | `generatePdf(content)` | html2canvas + jsPDF，A4 分页 |
| Markdown→PDF | `generatePdfFromMarkdown(md)` | Markdown → HTML → PDF |
| PNG | `canvasToBlob(canvas)` | Canvas 转 PNG Blob |

---

## [FILE] 标签系统

AI 回复中的文件标签，用于生成可下载的文件。

### 标签格式

```
[FILE:type:filename.ext]
内容
[/FILE]
```

### 支持的分类

| category | 扩展名 | 生成方式 |
|----------|--------|---------|
| text | txt, md, html, css, js, ts, py, java, go, rs, sql, yaml, docx 等 | Blob → 下载 |
| data | csv, tsv | 添加 BOM → Blob → 下载 |
| excel | xlsx, xls | `generateXlsxFromCsv()` → 下载 |
| json | json | `formatJson()` → Blob → 下载 |
| pdf | pdf | `generatePdfFromMarkdown()` → 下载 |
| chart | chart | ECharts 渲染 → PNG 下载 / JSON 配置下载 |

### 文件卡片功能

- 显示文件图标、文件名、文件大小
- 普通文件：「下载」按钮
- 图表文件：内联渲染预览 +「下载 PNG」和「下载 JSON」两个按钮

---

## ECharts 图表

**加载方式：** 动态 `import('echarts')`，首次使用时加载

**支持的渲染目标：**
- Canvas（默认）
- SVG
- Blob（用于导出 PNG）

**配置格式：**

```typescript
interface ChartConfig {
  option: EChartsOption  // ECharts 配置项
  width?: number         // 默认 800
  height?: number        // 默认 500
  theme?: string         // 'light' | 'dark'
}
```

**模板函数：**

| 函数 | 说明 |
|------|------|
| `createBarChartConfig(title, categories, data)` | 柱状图 |
| `createLineChartConfig(title, categories, datasets)` | 折线图 |
| `createPieChartConfig(title, data, options?)` | 饼图（支持环形图） |
| `createRadarChartConfig(title, indicators, datasets)` | 雷达图 |

---

## 发送给 LLM

所有附件最终以文本形式拼接到消息中：

```typescript
// 图片附件（有 OCR 结果时）
`[图片文字识别: ${name}]\n${ocrText}`

// 其他附件
`[文件: ${name}]\n\`\`\`${lang}\n${content}\n\`\`\``
```

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 文件超过大小限制 | 抛出错误，调用方捕获显示提示 |
| PDF/Word/Excel 解析失败 | 降级到 tryReadAsText |
| OCR 超时（30秒） | 静默返回空字符串 |
| ECharts 加载失败 | 返回错误提示 |
