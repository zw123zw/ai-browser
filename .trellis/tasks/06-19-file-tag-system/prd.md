# AI 文件标签系统 [FILE] 统一文件生成

## Goal

实现统一的 AI 文件生成标签系统，让 AI 通过 `[FILE:文件名.扩展名]...[/FILE]` 标签输出可下载的文件内容。支持文本、数据、Excel、PDF、ECharts 图表等多种格式，前端解析标签后渲染为下载卡片或可视化图表。

## Background

### 当前问题

1. **文件生成逻辑分散**：`FilePreviewModal.vue` 和 `MessageItem.vue` 各自实现 xlsx 生成，代码重复
2. **缺乏统一接口**：AI 无法主动生成文件，用户只能下载之前上传的文件
3. **图表能力缺失**：没有数据可视化能力，用户无法获取图表文件
4. **下载体验割裂**：不同场景的下载逻辑不一致

### 现有架构

```
文件上传流程：
InputBar.vue → parseFile() → Attachment → conversations store → adapter.chat()

刷新后下载：
FilePreviewModal.vue → downloadFile() → 7级优先级策略

表格下载：
MessageItem.vue → onTableDownload() → 从 DOM 提取 → xlsx 生成
```

## Requirements

### 核心需求

1. **标签格式规范**
   - 格式：`[FILE:文件名.扩展名]\n内容\n[/FILE]`
   - 支持单文件和多文件输出
   - 文件名有意义，便于用户理解

2. **支持的文件类型**

   | 类型 | 扩展名 | 生成方式 | 场景 |
   |------|--------|----------|------|
   | 文本 | .txt, .md, .html, .css, .js, .ts, .py, .sql, .yaml 等 | 直接保存 | 代码、文档 |
   | 数据 | .csv, .tsv | 直接保存（Excel 可打开） | 数据导出 |
   | Excel | .xlsx | 从 CSV 数据生成 | 报表导出 |
   | JSON | .json | 格式化后保存 | 配置文件 |
   | PDF | .pdf | 从 Markdown 生成 | 文档报告 |
   | 图表 | .chart | ECharts 渲染为 PNG | 数据可视化 |

3. **ECharts 图表支持**
   - 配置格式：`{ "option": {...}, "width": 800, "height": 500 }`
   - 支持图表类型：柱状图、折线图、饼图、环形图、散点图、雷达图
   - 渲染为 Canvas → 导出 PNG
   - 图表内嵌预览 + 下载按钮
   - 支持下载 PNG 图片和 JSON 配置

4. **UI 展示**
   - 文件卡片：显示图标、文件名、文件大小、下载按钮
   - 图表卡片：内嵌图表预览 + PNG/JSON 双下载按钮
   - 样式统一，响应式设计

5. **提示词规范**
   - 明确告知 AI 文件生成能力
   - 提供完整示例
   - 限制输出格式（必须使用 [FILE] 标签）

### 非功能需求

1. **性能**
   - ECharts 动态加载，不影响首屏
   - 图表渲染异步，不阻塞 UI

2. **兼容性**
   - 支持 Chrome Extension 环境
   - 支持 Shadow DOM

3. **可维护性**
   - 文件生成逻辑统一到 `file-generators.ts`
   - 标签解析独立到 `file-tag-parser.ts`
   - ECharts 渲染独立到 `echart-renderer.ts`

## Technical Approach

### 架构设计

```
src/utils/
├── file-generators.ts      # 统一文件生成（xlsx, pdf, blob）
├── file-tag-parser.ts      # [FILE] 标签解析 + 文件卡片渲染
├── echart-renderer.ts      # ECharts 渲染 + 导出
└── file-parsers.ts         # 现有：文件上传解析（不动）

src/styles/
└── file-cards.css          # 文件卡片样式

entrypoints/content/components/
└── MessageItem.vue         # 修改：集成文件标签渲染

提示词文件：
src/input/prompts.ts        # 修改：添加文件生成能力说明
```

### 数据流

```
AI 回复文本
    ↓
parseFileTags() 解析 [FILE] 标签
    ↓
ParsedFile[] 数组
    ↓
├── 文本/数据/JSON/Excel/PDF → 文件卡片（下载按钮）
└── .chart → ECharts 渲染 → 图表卡片（预览 + PNG/JSON 下载）
```

### 核心接口

```typescript
// ParsedFile 接口
interface ParsedFile {
  filename: string;        // 文件名
  content: string;         // 原始内容
  extension: string;       // 扩展名
  category: 'text' | 'data' | 'excel' | 'json' | 'pdf' | 'chart';
  chartConfig?: ChartConfig; // 图表配置（仅 .chart）
}

// ChartConfig 接口
interface ChartConfig {
  option: EChartsOption;   // ECharts 配置
  width?: number;          // 宽度，默认 800
  height?: number;         // 高度，默认 500
}

// 核心函数
parseFileTags(text: string): ParsedFile[]
downloadParsedFile(file: ParsedFile): Promise<void>
downloadChartConfig(file: ParsedFile): void
renderChartToElement(el: HTMLElement, config: ChartConfig): Promise<void>
```

### 提示词设计要点

1. **强制规则**
   - 用户请求生成文件/图表时，必须使用 [FILE] 标签
   - 不要直接输出内容，必须包裹在标签中
   - 多个文件使用多个标签

2. **示例覆盖**
   - 每种文件类型至少一个示例
   - 图表类型覆盖：柱状图、折线图、饼图、环形图、散点图、雷达图
   - 多文件输出示例

3. **格式规范**
   - ECharts 必须包含完整 option 对象
   - 图表可选 width/height
   - 文件名要有意义

## Acceptance Criteria

- [ ] AI 能够通过 [FILE] 标签生成文件
- [ ] 支持文本、CSV、Excel、JSON、PDF、图表六种类型
- [ ] .chart 文件使用 ECharts 渲染为可视化图表
- [ ] 图表支持下载为 PNG 和 JSON 配置
- [ ] 文件卡片显示图标、文件名、大小、下载按钮
- [ ] 图表卡片内嵌预览，支持响应式
- [ ] 提示词完整，覆盖所有文件类型
- [ ] 多文件场景正常工作
- [ ] 样式统一，支持深色模式
- [ ] 不影响现有文件上传和下载功能

## Definition of Done

- [ ] 代码实现完成
- [ ] TypeScript 类型检查通过（`npm run compile`）
- [ ] 开发模式可运行（`npm run dev`）
- [ ] 提示词已更新到 `prompts.ts`
- [ ] 样式已添加到 `global.css` 或独立文件
- [ ] 文档更新（如有必要）

## Out of Scope

1. **ZIP 打包下载**：多个文件逐个下载，不引入 ZIP 依赖
2. **图表交互**：静态渲染，不支持交互式图表
3. **图表编辑**：不支持在线编辑图表配置
4. **文件预览**：图表内嵌预览，其他类型不预览（点击下载）
5. **历史文件管理**：不单独管理生成的文件，随消息持久化

## Technical Notes

### 依赖

- **echarts**：图表渲染（已有或需安装）
- **xlsx**：Excel 生成（已存在）
- **docx**：Word 生成（已存在）
- **jspdf**：PDF 生成（已存在）

### 现有代码复用

- `file-generators.ts`：复用 `generateXlsx()`, `generatePdf()`, `triggerDownload()`
- `file-parsers.ts`：不动，保留现有文件上传解析逻辑
- `file-type.ts`：复用 `getExtension()` 函数

### 风险

1. **ECharts 包体积**：约 800KB，需动态 import 按需加载
2. **图表渲染性能**：复杂图表可能需要 200-500ms
3. **Shadow DOM 兼容**：ECharts 需要 DOM 容器，需确保在 Shadow DOM 中正常工作

## Research References

- [ECharts 文档](https://echarts.apache.org/zh/index.html)
- [ECharts 配置项](https://echarts.apache.org/zh/option.html)
- [Chart.js vs ECharts](https://echarts.apache.org/zh/feature-comparison.html)

## Decision (ADR-lite)

**Context**: 需要选择图表库用于数据可视化

**Decision**: 使用 ECharts

**Consequences**:
- 优点：功能丰富、中文友好、文档完善、社区活跃
- 缺点：包体积较大（需动态加载）、配置较复杂
- 替代方案：Chart.js（更轻量但功能较少）、D3.js（灵活但学习成本高）

---

*PRD 创建时间：2026-06-19*
*任务状态：待确认*
