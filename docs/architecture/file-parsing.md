# File Parsing Module

## 模块概述

文件解析模块提供完整的文件处理管线：文件类型检测、内容解析、格式生成、文件标签解析、图表渲染和 OCR 识别。支持 60+ 种代码文件扩展名、PDF/Word/Excel 文档解析、以及 ECharts 图表渲染导出。

**源文件**:
- `src/utils/file-parsers.ts` - 文件解析入口
- `src/utils/file-type.ts` - 文件类型检测
- `src/utils/file-generators.ts` - 文件格式生成
- `src/utils/file-tag-parser.ts` - AI 文件标签解析
- `src/utils/echart-renderer.ts` - ECharts 图表渲染
- `src/utils/ocr.ts` - OCR 文字识别

## 架构设计

```
┌───────────────────────────────────────────────────────────┐
│                    File Parsing Pipeline                    │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ File Parsers │  │ File Type    │  │ File Generators│  │
│  │              │  │ Detection    │  │                │  │
│  │ parseFile()  │──│ detectType() │  │ generateXlsx() │  │
│  │ parseImage() │  │ getCodeLang()│  │ generateDocx() │  │
│  │ parseText()  │  │ getExtension│  │ generatePdf()  │  │
│  │ parsePdf()   │  └──────────────┘  └────────────────┘  │
│  │ parseWord()  │                                         │
│  │ parseExcel() │  ┌──────────────┐  ┌────────────────┐  │
│  └──────────────┘  │ File Tag     │  │ ECharts        │  │
│                    │ Parser       │  │ Renderer       │  │
│  ┌──────────────┐  │              │  │                │  │
│  │ OCR          │  │ parseFileTags│  │ loadECharts()  │  │
│  │              │  │ renderCards  │  │ renderToBlob() │  │
│  │ recognize()  │  │ download     │  │ templates      │  │
│  └──────────────┘  └──────────────┘  └────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

## 核心类型定义

```typescript
// 附件类型
type AttachmentType = 'image' | 'text' | 'code' | 'pdf' | 'word' | 'excel' | 'binary';

// 附件结构
interface Attachment {
  id: string;
  type: AttachmentType;
  name: string;
  size: number;
  mimeType: string;
  content?: string;     // 文本内容
  dataUrl?: string;     // 图片 base64
  lang?: string;        // 代码语言标识
  truncated?: boolean;  // 是否被截断
}

// 文件分类（标签解析用）
type FileCategory = 'text' | 'data' | 'excel' | 'json' | 'pdf' | 'chart';

// 解析后的文件信息
interface ParsedFile {
  filename: string;
  content: string;
  extension: string;
  category: FileCategory;
  chartConfig?: ChartConfig;
  size: number;
  index: number;
}

// 图表配置
interface ChartConfig {
  option: EChartsOption;
  width?: number;   // 默认 800
  height?: number;  // 默认 500
  theme?: string;
}
```

## 实现细节

### 文件类型检测 (file-type.ts)

`detectFileType(file)` 按优先级判断：

1. **MIME 前缀**: `image/*` -> `'image'`
2. **PDF**: 扩展名 `pdf` 或 MIME `application/pdf`
3. **Word**: 扩展名 `doc/docx` 或对应 MIME
4. **Excel**: MIME 匹配（排除 csv/tsv）或扩展名 `xls/xlsx`
5. **代码**: 扩展名在 `CODE_EXTENSIONS` 映射中（60+ 种）
6. **文本**: 扩展名在 `TEXT_EXTENSIONS` 集合中，或无扩展名但文件名匹配 `TEXT_FILENAMES`
7. **MIME 兜底**: `text/*` -> `'text'`
8. **无扩展名无MIME**: 按文本尝试读取
9. **其他**: `'binary'`

**代码扩展名映射**: 覆盖 JavaScript/TypeScript、Python、Java/Kotlin/Scala、C/C++/C#、Go、Rust、Ruby、PHP、Swift、Shell、SQL、JSON/YAML/TOML、Markdown/LaTeX 等 60+ 种扩展名到语言标识。

### 文件解析 (file-parsers.ts)

`parseFile(file)` 统一入口，按类型分发：

**大小限制**:
- 文本内容: 500KB (MAX_TEXT_CONTENT_SIZE)
- 文本文件: 2MB (MAX_TEXT_FILE_SIZE)
- 二进制文件: 10MB (MAX_BINARY_FILE_SIZE)
- 图片: 20MB (MAX_IMAGE_FILE_SIZE)

**解析器**:
- **parseImage**: `fileToDataURL()` 转 base64，OCR 由调用方异步触发
- **parseText**: `FileReader.readAsText('UTF-8')`，代码文件额外调用 `getCodeLang()` 获取语言标识
- **parsePdf**: `pdfjs-dist` 提取文本，Worker 在 content script 中使用 fake worker 模式（预导入 worker 模块到 `globalThis.pdfjsWorker`）
- **parseWord**: `mammoth.extractRawText()` 提取纯文本
- **parseExcel**: `xlsx` 库读取为 CSV，CSV/TSV 直接读文本
- **parseBinary**: 先尝试 `tryReadAsText()`，失败则仅保留元信息

**级联回退**: 专用解析器失败或内容为空时，尝试 `tryReadAsText()` 按文本读取（去除 null 字节后至少 10 个可打印字符才算成功）

**原始文件缓存**: `originalFileCache: Map<string, File>` 缓存原始 File 引用，供预览 modal 下载使用（内存级，页面刷新释放）

### OCR 识别 (ocr.ts)

基于 Tesseract.js 的前端 OCR：

- **语言**: `chi_sim+eng`（中文简体 + 英文混合）
- **语言包路径**: 从扩展本地加载 (`chrome.runtime.getURL('/tesseract')`)，避免 CSP 阻止 CDN
- **超时保护**: 30 秒 (`OCR_TIMEOUT`)，防止语言包下载失败导致永久卡住
- **进度回调**: `recognizing text` 状态时报告进度 (0~1)

### 文件生成 (file-generators.ts)

**generateXlsx(rows, sheetName)**: `xlsx` 库将二维数组写为 xlsx Blob

**generateDocx(content)**: `docx` 库按行分割为段落，生成 Word Blob

**generatePdf(content)**: html2canvas + jsPDF 实现：
1. 纯文本转 HTML（按行分割为 `<p>` 标签）
2. Markdown 转 HTML（简易解析：标题、代码块、列表、粗体/斜体）
3. 创建离屏容器（`position: absolute; left: -9999px`），注入 scoped 样式
4. `html2canvas` 截图（自动降 scale 避免 canvas 16384px 高度上限）
5. 按 A4 高度 (`1123px @ 96dpi`) 逐页切分 canvas
6. `jsPDF` 逐页添加图片（JPEG 0.92 质量）

**下载工具**: `triggerDownload()` 通过创建临时 `<a>` 标签触发浏览器下载

### 文件标签解析 (file-tag-parser.ts)

解析 AI 回复中的 `[FILE:filename.ext]...[/FILE]` 标签：

**正则**: `/\[FILE:\s*([^\]]+)\]\r?\n?([\s\S]*?)(?:\[\/FILE\]|$)/gi`

兼容各种格式：标准格式、有换行、Windows 换行、冒号后有空格、小写标签、无闭合标签

**复合扩展名检测**: 如果最后扩展名是 `md/txt`，检查前面是否有目标格式扩展名（如 `report.pdf.md` -> `pdf`）

**分类映射**: 60+ 种扩展名映射到 6 种分类 (`text/data/excel/json/pdf/chart`)

**下载分发**: 根据分类选择不同生成策略：
- `text` -> 直接 Blob
- `data` (csv/tsv) -> 添加 BOM 前缀
- `excel` -> `generateXlsxFromCsv()`
- `json` -> `formatJson()` 格式化
- `pdf` -> `generatePdfFromMarkdown()`
- `chart` -> JSON 配置或 PNG 图片

### ECharts 渲染 (echart-renderer.ts)

**懒加载**: `loadECharts()` 动态 `import('echarts')`，模块缓存在 `echartsModule` 变量中

**渲染模式**:
- `renderChartToElement(container, config)`: 在 DOM 容器中渲染，返回 `dispose` 清理函数
- `renderChartToCanvas(config)`: 离屏 Canvas 渲染（2x 分辨率）
- `renderChartToBlob(config)`: 创建临时 DOM 容器 -> 渲染 -> `getDataURL()` -> base64 转 Blob
- `renderChartToSvg(config)`: SVG 渲染器 -> `XMLSerializer` 序列化

**配置解析 (parseChartConfig)**: 支持两种格式：
- 完整格式: `{ option: {...}, width, height, theme }`
- 简化格式: 直接是 option 对象（向后兼容，检测 `series/xAxis/yAxis/radar/tooltip` 字段）

**图表模板工厂**:
- `createBarChartConfig()`: 柱状图
- `createLineChartConfig()`: 折线图（支持多数据集）
- `createPieChartConfig()`: 饼图（支持环形图）
- `createRadarChartConfig()`: 雷达图

## 数据流

### 文件上传解析

```
用户拖拽/选择文件
    │
    ▼
parseFile(file)
    │
    ├─ detectFileType(file) -> AttachmentType
    │
    ├─ type='image'  -> parseImage() -> dataUrl + (异步 OCR)
    ├─ type='text'   -> parseText() -> content + lang
    ├─ type='code'   -> parseText() -> content + lang
    ├─ type='pdf'    -> parsePdf() -> pdfjs 提取文本
    ├─ type='word'   -> parseWord() -> mammoth 提取文本
    ├─ type='excel'  -> parseExcel() -> xlsx 转 CSV
    └─ type='binary' -> parseBinary() -> tryReadAsText 兜底
    │
    ▼
Attachment 对象 -> 加入消息附件列表
```

### AI 文件标签下载

```
AI 回复包含 [FILE:report.xlsx]...[/FILE]
    │
    ▼
parseFileTags(text) -> ParsedFile[]
    │
    ▼
generateFileBlob(file)
    │
    ├─ category='text'   -> Blob([content])
    ├─ category='data'   -> Blob([BOM + content])
    ├─ category='excel'  -> generateXlsxFromCsv()
    ├─ category='json'   -> Blob([formatJson()])
    ├─ category='pdf'    -> generatePdfFromMarkdown()
    └─ category='chart'  -> renderChartToBlob() 或 JSON
    │
    ▼
triggerDownload(blob, filename)
```

## 配置与扩展

- **大小限制**: 文本 500KB 内容 / 2MB 文件，二进制 10MB，图片 20MB
- **PDF Worker**: 使用 fake worker 模式（预导入到 `globalThis.pdfjsWorker`）
- **ECharts 像素比**: 默认 2x（高清）
- **PDF 分页**: A4 尺寸 (210x297mm)，96dpi 下 1123px/页
- **Canvas 高度上限**: 16384px，超出时自动降 scale
- **OCR 超时**: 30 秒
- **OCR 语言**: `chi_sim+eng`（硬编码）

## 已知限制

1. **PDF 扫描件**: pdfjs-dist 只能提取文本型 PDF，扫描件/图片型 PDF 返回空内容提示。
2. **Word 格式丢失**: mammoth 只提取纯文本，所有格式（粗体、表格、图片）丢失。
3. **ECharts 离屏渲染**: `renderChartToBlob` 创建临时 DOM 容器添加到 `document.body`，可能影响页面布局（虽然设置了 `left: -9999px`）。
4. **html2canvas 兼容性**: 某些 CSS 特性（如 `backdrop-filter`、复杂渐变）可能渲染不准确。
5. **OCR 准确率**: Tesseract.js 在复杂背景、手写体、小字体场景下准确率较低。
6. **无并发文件解析**: `parseFile` 是串行处理，多文件上传时逐个解析。
7. **原始文件缓存泄漏**: `originalFileCache` 是模块级 Map，如果附件被删除但未调用 `removeFromFileCache()`，File 对象不会被 GC。
