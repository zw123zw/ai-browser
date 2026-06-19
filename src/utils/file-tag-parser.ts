/**
 * AI 文件标签解析器
 *
 * 功能：
 * - 从 AI 回复中提取 [FILE:xxx]...[/FILE] 标签
 * - 解析文件内容和类型
 * - 生成文件卡片 HTML
 * - 处理文件下载
 */

import { Logger } from './logger';

const log = new Logger('FileTagParser');

import type { ChartConfig } from './echart-renderer';
import { parseChartConfig } from './echart-renderer';
import {
  generateXlsxFromCsv,
  generateDocx,
  generatePdfFromMarkdown,
  triggerDownload,
  formatBytes,
  formatJson,
  isTextExtension,
  getMimeType,
  TEXT_EXTENSIONS,
} from './file-generators';

// ============ 类型定义 ============

/** 文件分类 */
export type FileCategory = 'text' | 'data' | 'excel' | 'json' | 'pdf' | 'chart';

/** 解析后的文件信息 */
export interface ParsedFile {
  /** 文件名 */
  filename: string;
  /** 原始内容 */
  content: string;
  /** 扩展名（不含点号） */
  extension: string;
  /** 文件分类 */
  category: FileCategory;
  /** 图表配置（仅 .chart 文件） */
  chartConfig?: ChartConfig;
  /** 文件大小（字节） */
  size: number;
  /** 文件索引（在消息中的位置） */
  index: number;
}

/** 文件卡片渲染选项 */
export interface FileCardOptions {
  /** 是否显示预览 */
  showPreview?: boolean;
  /** 是否显示文件大小 */
  showSize?: boolean;
  /** 自定义类名 */
  className?: string;
}

// ============ 常量 ============

/**
 * 文件标签正则（兼容各种 AI 输出格式）
 *
 * 兼容情况：
 * - [FILE:xxx]内容[/FILE]          — 标准格式
 * - [FILE:xxx]\n内容[/FILE]        — 有换行
 * - [FILE:xxx]\r\n内容[/FILE]      — Windows 换行
 * - [FILE: xxx]内容[/FILE]         — 冒号后有空格
 * - [file:xxx]content[/file]       — 小写标签
 * - [FILE:xxx]\n\n内容[/FILE]      — 多个换行
 * - [FILE:xxx]内容                  — 无闭合标签（到文本结尾）
 *
 * 结构说明：
 * - `\[FILE:\s*`    — 开始标签，FILE 后允许可选空格
 * - `([^\]]+)`      — 捕获文件名（不含 ]）
 * - `\]`            — 文件名结束的 ]
 * - `\r?\n?`        — 可选的换行符（\r?\n 兼容 Windows/Linux）
 * - `([\s\S]*?)`    — 非贪婪捕获内容
 * - `(?:\[\/FILE\]|$)` — 结束标签或文本结尾
 */
const FILE_TAG_REGEX = /\[FILE:\s*([^\]]+)\]\r?\n?([\s\S]*?)(?:\[\/FILE\]|$)/gi;

/** 扩展名分类映射 */
const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  // 文本
  txt: 'text', md: 'text', html: 'text', htm: 'text', xml: 'text',
  css: 'text', scss: 'text', less: 'text',
  js: 'text', ts: 'text', jsx: 'text', tsx: 'text',
  py: 'text', java: 'text', go: 'text', rs: 'text', rb: 'text', php: 'text',
  c: 'text', cpp: 'text', h: 'text', hpp: 'text', cs: 'text',
  sh: 'text', bash: 'text', bat: 'text', ps1: 'text',
  sql: 'text', graphql: 'text', yaml: 'text', yml: 'text',
  ini: 'text', env: 'text', log: 'text', cfg: 'text', conf: 'text', toml: 'text',

  // 数据
  csv: 'data', tsv: 'data',

  // Excel
  xlsx: 'excel', xls: 'excel',

  // JSON
  json: 'json',

  // PDF
  pdf: 'pdf',

  // Word
  docx: 'text', doc: 'text',

  // 图表
  chart: 'chart',
};

/** 文件图标映射 */
const FILE_ICONS: Record<FileCategory, string> = {
  text: '📄',
  data: '📊',
  excel: '📗',
  json: '📋',
  pdf: '📕',
  chart: '📈',
};

/** 扩展名图标映射（更细粒度） */
const EXTENSION_ICONS: Record<string, string> = {
  // 代码文件
  js: '🟨', ts: '🔷', jsx: '⚛️', tsx: '⚛️',
  py: '🐍', java: '☕', go: '🔵', rs: '🦀', rb: '💎',
  // 文档
  md: '📝', html: '🌐', css: '🎨',
  docx: '📘', doc: '📘',
  // 数据
  json: '📋', yaml: '⚙️', yml: '⚙️',
  csv: '📊', xlsx: '📗', xls: '📗',
  pdf: '📕',
  // 图表
  chart: '📈',
};

// ============ 核心解析函数 ============

/**
 * 从 AI 回复文本中解析文件标签
 *
 * @param text AI 回复文本
 * @returns 解析后的文件数组
 */
export function parseFileTags(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let match;

  // 重置正则状态
  FILE_TAG_REGEX.lastIndex = 0;

  while ((match = FILE_TAG_REGEX.exec(text)) !== null) {
    const filename = match[1].trim();
    const content = match[2].trim();
    const ext = getExtension(filename);
    const category = EXTENSION_CATEGORY[ext] ?? 'text';

    const file: ParsedFile = {
      filename,
      content,
      extension: ext,
      category,
      size: new Blob([content]).size,
      index: files.length,
    };

    // 解析图表配置
    if (category === 'chart') {
      const config = parseChartConfig(content);
      file.chartConfig = config ?? undefined;
    }

    files.push(file);
  }

  return files;
}

/**
 * 检查文本中是否包含文件标签
 *
 * @param text 文本
 */
export function hasFileTags(text: string): boolean {
  // 重置正则状态，避免连续调用时 lastIndex 影响结果
  FILE_TAG_REGEX.lastIndex = 0;
  return FILE_TAG_REGEX.test(text);
}

/**
 * 获取文件扩展名（不含点号）
 *
 * @param filename 文件名
 * 支持识别 .pdf.md、.docx.md 等 AI 可能输出的复合扩展名
 */
function getExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length <= 1) return '';

  const lastExt = parts.pop()!.toLowerCase();

  // 如果最后扩展名是 md/txt，检查前面是否有目标格式扩展名
  if (lastExt === 'md' || lastExt === 'txt') {
    const targetExts = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
    for (const ext of targetExts) {
      if (parts.includes(ext)) {
        return ext;
      }
    }
  }

  return lastExt;
}

/**
 * 获取文件图标
 *
 * @param file 解析后的文件
 */
export function getFileIcon(file: ParsedFile): string {
  return EXTENSION_ICONS[file.extension] ?? FILE_ICONS[file.category] ?? '📄';
}

// ============ HTML 渲染 ============

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成文件卡片 HTML
 *
 * @param file 解析后的文件
 * @param options 渲染选项
 */
export function generateFileCardHtml(file: ParsedFile, options: FileCardOptions = {}): string {
  const {
    showSize = true,
    className = '',
  } = options;

  const icon = getFileIcon(file);
  const sizeStr = formatBytes(file.size);
  const cardClass = `aib-file-card ${className}`.trim();

  // 下载按钮 SVG
  const downloadIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  // 图表类型特殊处理
  if (file.category === 'chart') {
    return `
      <div class="${cardClass} aib-file-card--chart" data-file-index="${file.index}">
        <div class="aib-chart-preview" data-chart-index="${file.index}"></div>
        <div class="aib-file-card-body">
          <div class="aib-file-card-info">
            <span class="aib-file-card-icon">${icon}</span>
            <div class="aib-file-card-text">
              <div class="aib-file-card-name">${escapeHtml(file.filename)}</div>
              ${showSize ? `<div class="aib-file-card-size">${sizeStr}</div>` : ''}
            </div>
          </div>
        </div>
        <div class="aib-file-card-actions">
          <button class="aib-file-card-btn aib-file-card-btn--primary"
                  data-action="download-png"
                  data-file-index="${file.index}"
                  title="下载 PNG 图片">
            ${downloadIcon}
            <span>下载 PNG</span>
          </button>
          <button class="aib-file-card-btn aib-file-card-btn--secondary"
                  data-action="download-config"
                  data-file-index="${file.index}"
                  title="下载 JSON 配置">
            ${downloadIcon}
            <span>下载 JSON</span>
          </button>
        </div>
      </div>
    `;
  }

  // 普通文件卡片
  return `
    <div class="${cardClass}" data-file-index="${file.index}">
      <div class="aib-file-card-body">
        <div class="aib-file-card-info">
          <span class="aib-file-card-icon">${icon}</span>
          <div class="aib-file-card-text">
            <div class="aib-file-card-name">${escapeHtml(file.filename)}</div>
            ${showSize ? `<div class="aib-file-card-size">${sizeStr}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="aib-file-card-actions">
        <button class="aib-file-card-btn aib-file-card-btn--primary"
                data-action="download"
                data-file-index="${file.index}"
                title="下载文件">
          ${downloadIcon}
          <span>下载</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * 从 AI 回复中提取文件并渲染为 HTML
 *
 * 将 [FILE]...[/FILE] 标签替换为文件卡片 HTML
 *
 * @param text AI 回复文本
 * @param options 渲染选项
 * @returns 渲染后的 HTML 和解析的文件数组
 */
export function renderFileCards(
  text: string,
  options: FileCardOptions = {}
): {
  html: string;
  files: ParsedFile[];
} {
  const files = parseFileTags(text);

  if (files.length === 0) {
    return { html: text, files: [] };
  }

  let html = text;

  // 替换每个文件标签为卡片 HTML
  for (const file of files) {
    // 匹配原始文件名（可能包含空格）
    const tagRegex = new RegExp(
      `\\[FILE:\\s*${escapeRegex(file.filename)}\\]\\r?\\n?[\\s\\S]*?\\[/FILE\\]`,
      'i'
    );
    const cardHtml = generateFileCardHtml(file, options);
    html = html.replace(tagRegex, cardHtml);
  }

  return { html, files };
}

// ============ 文件下载 ============

/**
 * 生成文件 Blob
 *
 * @param file 解析后的文件
 * @returns Blob 对象
 */
export async function generateFileBlob(file: ParsedFile): Promise<Blob> {
  // docx 特殊处理
  if (file.extension === 'docx' || file.extension === 'doc') {
    return generateDocx(file.content);
  }

  switch (file.category) {
    case 'text':
      return new Blob([file.content], {
        type: getMimeType(file.extension) + ';charset=utf-8',
      });

    case 'data':
      // CSV/TSV 添加 BOM 以便 Excel 正确识别中文
      return new Blob(['﻿' + file.content], {
        type: 'text/csv;charset=utf-8',
      });

    case 'excel':
      return generateXlsxFromCsv(file.content);

    case 'json':
      return new Blob([formatJson(file.content)], {
        type: 'application/json;charset=utf-8',
      });

    case 'pdf':
      return await generatePdfFromMarkdown(file.content);

    case 'chart':
      // 图表默认下载为 JSON 配置
      return new Blob([JSON.stringify(file.chartConfig, null, 2)], {
        type: 'application/json;charset=utf-8',
      });

    default:
      return new Blob([file.content], {
        type: 'application/octet-stream',
      });
  }
}

/**
 * 下载文件
 *
 * @param file 解析后的文件
 * @param customFilename 自定义文件名（可选）
 */
export async function downloadParsedFile(
  file: ParsedFile,
  customFilename?: string
): Promise<void> {
  const blob = await generateFileBlob(file);
  const filename = customFilename || file.filename;
  triggerDownload(blob, filename);
}

/**
 * 下载图表为 PNG
 *
 * @param file 解析后的文件（必须是 chart 类型）
 */
export async function downloadChartAsPng(file: ParsedFile): Promise<void> {
  if (file.category !== 'chart' || !file.chartConfig) {
    throw new Error('不是有效的图表文件');
  }

  // 动态导入避免循环依赖
  const { renderChartToBlob } = await import('./echart-renderer');
  const blob = await renderChartToBlob(file.chartConfig);
  const filename = file.filename.replace(/\.chart$/i, '.png');
  triggerDownload(blob, filename);
}

/**
 * 下载图表配置为 JSON
 *
 * @param file 解析后的文件（必须是 chart 类型）
 */
export function downloadChartConfig(file: ParsedFile): void {
  if (file.category !== 'chart') {
    throw new Error('不是图表文件');
  }

  const blob = new Blob(
    [JSON.stringify(file.chartConfig, null, 2)],
    { type: 'application/json;charset=utf-8' }
  );
  const filename = file.filename.replace(/\.chart$/i, '.json');
  triggerDownload(blob, filename);
}

// ============ 事件处理 ============

/** 下载动作类型 */
export type DownloadAction = 'download' | 'download-png' | 'download-config';

/**
 * 处理文件下载点击事件
 *
 * @param action 动作类型
 * @param fileIndex 文件索引
 * @param files 文件数组
 */
export async function handleFileDownload(
  action: DownloadAction,
  fileIndex: number,
  files: ParsedFile[]
): Promise<void> {
  const file = files[fileIndex];
  if (!file) {
    log.warn(`文件索引 ${fileIndex} 不存在`);
    return;
  }

  switch (action) {
    case 'download':
      await downloadParsedFile(file);
      break;
    case 'download-png':
      await downloadChartAsPng(file);
      break;
    case 'download-config':
      downloadChartConfig(file);
      break;
    default:
      log.warn(`未知的下载动作: ${action}`);
  }
}

/**
 * 从点击事件中提取下载信息
 *
 * @param event 鼠标点击事件
 * @returns 下载信息或 null
 */
export function extractDownloadInfo(event: MouseEvent): {
  action: DownloadAction;
  fileIndex: number;
} | null {
  const target = event.target as HTMLElement;
  const button = target.closest('[data-action]') as HTMLElement;

  if (!button) {
    return null;
  }

  const action = button.getAttribute('data-action') as DownloadAction;
  const fileIndex = parseInt(button.getAttribute('data-file-index') || '-1', 10);

  if (!action || fileIndex < 0) {
    return null;
  }

  return { action, fileIndex };
}

// ============ 批量操作 ============

/**
 * 批量下载所有文件
 *
 * @param files 文件数组
 * @param delayBetween 文件间延迟（毫秒）
 */
export async function downloadAllFiles(
  files: ParsedFile[],
  delayBetween = 200
): Promise<void> {
  for (const file of files) {
    await downloadParsedFile(file);
    if (files.indexOf(file) < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetween));
    }
  }
}

/**
 * 获取文件摘要信息
 *
 * @param files 文件数组
 */
export function getFilesSummary(files: ParsedFile[]): string {
  if (files.length === 0) return '';

  const categories = files.reduce((acc, file) => {
    acc[file.category] = (acc[file.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const parts: string[] = [];
  if (categories.text) parts.push(`${categories.text} 个文本文件`);
  if (categories.data) parts.push(`${categories.data} 个数据文件`);
  if (categories.excel) parts.push(`${categories.excel} 个 Excel 文件`);
  if (categories.json) parts.push(`${categories.json} 个 JSON 文件`);
  if (categories.pdf) parts.push(`${categories.pdf} 个 PDF 文件`);
  if (categories.chart) parts.push(`${categories.chart} 个图表`);

  return parts.join('、');
}

// ============ 导出 ============

// 导出工具函数供外部使用
export { escapeHtml, escapeRegex, getExtension };
