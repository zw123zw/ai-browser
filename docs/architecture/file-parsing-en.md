# File Parsing Module

> **🌐 中文版本：[file-parsing.md](./file-parsing.md)**

## Module Overview

The file parsing module provides a complete file processing pipeline: file type detection, content parsing, format generation, file tag parsing, chart rendering, and OCR recognition. It supports 60+ code file extensions, PDF/Word/Excel document parsing, and ECharts chart rendering and export.

**Source Files**:
- `src/utils/file-parsers.ts` - File parsing entry point
- `src/utils/file-type.ts` - File type detection
- `src/utils/file-generators.ts` - File format generation
- `src/utils/file-tag-parser.ts` - AI file tag parsing
- `src/utils/echart-renderer.ts` - ECharts chart rendering
- `src/utils/ocr.ts` - OCR text recognition

## Architecture

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

## Core Type Definitions

```typescript
// Attachment types
type AttachmentType = 'image' | 'text' | 'code' | 'pdf' | 'word' | 'excel' | 'binary';

// Attachment structure
interface Attachment {
  id: string;
  type: AttachmentType;
  name: string;
  size: number;
  mimeType: string;
  content?: string;     // Text content
  dataUrl?: string;     // Image base64
  lang?: string;        // Code language identifier
  truncated?: boolean;  // Whether it was truncated
}

// File category (used by tag parser)
type FileCategory = 'text' | 'data' | 'excel' | 'json' | 'pdf' | 'chart';

// Parsed file information
interface ParsedFile {
  filename: string;
  content: string;
  extension: string;
  category: FileCategory;
  chartConfig?: ChartConfig;
  size: number;
  index: number;
}

// Chart configuration
interface ChartConfig {
  option: EChartsOption;
  width?: number;   // Default 800
  height?: number;  // Default 500
  theme?: string;
}
```

## Implementation Details

### File Type Detection (file-type.ts)

`detectFileType(file)` determines the type by priority:

1. **MIME prefix**: `image/*` -> `'image'`
2. **PDF**: Extension `pdf` or MIME `application/pdf`
3. **Word**: Extension `doc/docx` or corresponding MIME
4. **Excel**: MIME match (excluding csv/tsv) or extension `xls/xlsx`
5. **Code**: Extension exists in `CODE_EXTENSIONS` mapping (60+ types)
6. **Text**: Extension exists in `TEXT_EXTENSIONS` set, or no extension but filename matches `TEXT_FILENAMES`
7. **MIME fallback**: `text/*` -> `'text'`
8. **No extension, no MIME**: Attempt to read as text
9. **Other**: `'binary'`

**Code extension mapping**: Covers 60+ extensions mapping to language identifiers, including JavaScript/TypeScript, Python, Java/Kotlin/Scala, C/C++/C#, Go, Rust, Ruby, PHP, Swift, Shell, SQL, JSON/YAML/TOML, Markdown/LaTeX, and more.

### File Parsing (file-parsers.ts)

`parseFile(file)` serves as the unified entry point, dispatching by type:

**Size limits**:
- Text content: 500KB (MAX_TEXT_CONTENT_SIZE)
- Text file: 2MB (MAX_TEXT_FILE_SIZE)
- Binary file: 10MB (MAX_BINARY_FILE_SIZE)
- Image: 20MB (MAX_IMAGE_FILE_SIZE)

**Parsers**:
- **parseImage**: `fileToDataURL()` converts to base64; OCR is triggered asynchronously by the caller
- **parseText**: `FileReader.readAsText('UTF-8')`; code files additionally call `getCodeLang()` to obtain the language identifier
- **parsePdf**: `pdfjs-dist` extracts text; the worker uses fake worker mode in the content script (the worker module is pre-imported into `globalThis.pdfjsWorker`)
- **parseWord**: `mammoth.extractRawText()` extracts plain text
- **parseExcel**: `xlsx` library reads the file as CSV; CSV/TSV files are read directly as text
- **parseBinary**: First attempts `tryReadAsText()`; on failure, only metadata is retained

**Cascade fallback**: When a dedicated parser fails or returns empty content, `tryReadAsText()` is attempted as a text read (requires at least 10 printable characters after removing null bytes to be considered successful).

**Original file cache**: `originalFileCache: Map<string, File>` caches original File references for use by the preview modal's download function (memory-level, released on page refresh).

### OCR Recognition (ocr.ts)

Frontend OCR based on Tesseract.js:

- **Languages**: `chi_sim+eng` (Simplified Chinese + English mixed)
- **Language pack path**: Loaded locally from the extension (`chrome.runtime.getURL('/tesseract')`) to avoid CSP blocking CDN
- **Timeout protection**: 30 seconds (`OCR_TIMEOUT`), prevents permanent hang when language pack download fails
- **Progress callback**: Reports progress (0~1) during the `recognizing text` state

### File Generation (file-generators.ts)

**generateXlsx(rows, sheetName)**: Uses the `xlsx` library to write a 2D array as an xlsx Blob.

**generateDocx(content)**: Uses the `docx` library to split content by lines into paragraphs and generate a Word Blob.

**generatePdf(content)**: Implemented with html2canvas + jsPDF:
1. Converts plain text to HTML (splits by lines into `<p>` tags)
2. Converts Markdown to HTML (simple parsing: headings, code blocks, lists, bold/italic)
3. Creates an offscreen container (`position: absolute; left: -9999px`) and injects scoped styles
4. `html2canvas` captures a screenshot (automatically reduces scale to avoid the canvas 16384px height limit)
5. Splits the canvas page by page based on A4 height (`1123px @ 96dpi`)
6. `jsPDF` adds images page by page (JPEG quality 0.92)

**Download utility**: `triggerDownload()` triggers a browser download by creating a temporary `<a>` tag.

### File Tag Parsing (file-tag-parser.ts)

Parses `[FILE:filename.ext]...[/FILE]` tags in AI responses:

**Regex**: `/\[FILE:\s*([^\]]+)\]\r?\n?([\s\S]*?)(?:\[\/FILE\]|$)/gi`

Compatible with various formats: standard format, with line breaks, Windows line breaks, space after colon, lowercase tags, and unclosed tags.

**Compound extension detection**: If the last extension is `md/txt`, it checks whether a target format extension precedes it (e.g., `report.pdf.md` -> `pdf`).

**Category mapping**: Maps 60+ extensions to 6 categories (`text/data/excel/json/pdf/chart`).

**Download dispatch**: Selects different generation strategies based on category:
- `text` -> Direct Blob
- `data` (csv/tsv) -> Adds BOM prefix
- `excel` -> `generateXlsxFromCsv()`
- `json` -> `formatJson()` formatting
- `pdf` -> `generatePdfFromMarkdown()`
- `chart` -> JSON config or PNG image

### ECharts Rendering (echart-renderer.ts)

**Lazy loading**: `loadECharts()` dynamically imports via `import('echarts')`; the module is cached in the `echartsModule` variable.

**Rendering modes**:
- `renderChartToElement(container, config)`: Renders in a DOM container; returns a `dispose` cleanup function
- `renderChartToCanvas(config)`: Offscreen canvas rendering (2x resolution)
- `renderChartToBlob(config)`: Creates a temporary DOM container -> renders -> `getDataURL()` -> base64 to Blob
- `renderChartToSvg(config)`: SVG renderer -> `XMLSerializer` serialization

**Configuration parsing (parseChartConfig)**: Supports two formats:
- Full format: `{ option: {...}, width, height, theme }`
- Simplified format: Directly an option object (backward compatible; detects `series/xAxis/yAxis/radar/tooltip` fields)

**Chart template factories**:
- `createBarChartConfig()`: Bar chart
- `createLineChartConfig()`: Line chart (supports multiple datasets)
- `createPieChartConfig()`: Pie chart (supports donut chart)
- `createRadarChartConfig()`: Radar chart

## Data Flow

### File Upload Parsing

```
User drags/selects file
    │
    ▼
parseFile(file)
    │
    ├─ detectFileType(file) -> AttachmentType
    │
    ├─ type='image'  -> parseImage() -> dataUrl + (async OCR)
    ├─ type='text'   -> parseText() -> content + lang
    ├─ type='code'   -> parseText() -> content + lang
    ├─ type='pdf'    -> parsePdf() -> pdfjs extracts text
    ├─ type='word'   -> parseWord() -> mammoth extracts text
    ├─ type='excel'  -> parseExcel() -> xlsx converts to CSV
    └─ type='binary' -> parseBinary() -> tryReadAsText fallback
    │
    ▼
Attachment object -> Added to message attachment list
```

### AI File Tag Download

```
AI response contains [FILE:report.xlsx]...[/FILE]
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
    └─ category='chart'  -> renderChartToBlob() or JSON
    │
    ▼
triggerDownload(blob, filename)
```

## Configuration and Extension

- **Size limits**: Text 500KB content / 2MB file, binary 10MB, image 20MB
- **PDF Worker**: Uses fake worker mode (pre-imported into `globalThis.pdfjsWorker`)
- **ECharts pixel ratio**: Default 2x (high resolution)
- **PDF pagination**: A4 size (210x297mm), 1123px per page at 96dpi
- **Canvas height limit**: 16384px; scale is automatically reduced when exceeded
- **OCR timeout**: 30 seconds
- **OCR languages**: `chi_sim+eng` (hardcoded)

## Known Limitations

1. **Scanned PDFs**: pdfjs-dist can only extract text-based PDFs. Scanned or image-based PDFs return an empty content notice.
2. **Word formatting loss**: mammoth extracts plain text only; all formatting (bold, tables, images) is lost.
3. **ECharts offscreen rendering**: `renderChartToBlob` creates a temporary DOM container appended to `document.body`, which may affect page layout (although `left: -9999px` is set).
4. **html2canvas compatibility**: Some CSS features (such as `backdrop-filter`, complex gradients) may not render accurately.
5. **OCR accuracy**: Tesseract.js has lower accuracy with complex backgrounds, handwriting, and small font sizes.
6. **No concurrent file parsing**: `parseFile` processes files serially; multiple files are parsed one by one during upload.
7. **Original file cache leak**: `originalFileCache` is a module-level Map. If an attachment is deleted without calling `removeFromFileCache()`, the File object will not be garbage collected.
