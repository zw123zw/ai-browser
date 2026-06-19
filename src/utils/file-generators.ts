/**
 * 统一文件生成工具
 *
 * 提供各种格式文件的生成和下载功能：
 * - Excel (.xlsx)
 * - PDF (.pdf)
 * - CSV (.csv)
 * - 图片 (.png)
 * - 通用 Blob
 */

import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';

// ============ 核心生成函数 ============

/**
 * 从二维数组生成 Excel Blob
 * @param rows 数据行数组，每行是字符串数组
 * @param sheetName 工作表名称
 */
export function generateXlsx(rows: string[][], sheetName = 'Sheet1'): Blob {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * 从 CSV 文本内容生成 Excel Blob
 * @param csvContent CSV 格式的文本内容
 */
export function generateXlsxFromCsv(csvContent: string): Blob {
  const rows = csvContent
    .split('\n')
    .filter(row => row.trim())
    .map(row => row.split(',').map(cell => cell.trim()));
  return generateXlsx(rows);
}

/**
 * 从文本内容解析为二维数组（支持 TSV、管道符、纯文本）
 * @param content 文本内容
 */
export function parseContentToRows(content: string): string[][] {
  // TSV 格式
  if (content.includes('\t')) {
    return content.split('\n').map(row => row.split('\t'));
  }
  // 管道符表格
  if (content.includes('|')) {
    return content.split('\n')
      .filter(row => row.trim() && !/^[\s|:-]+$/.test(row))
      .map(row => row.split('|').map(cell => cell.trim()).filter(Boolean));
  }
  // 纯文本
  return content.split('\n').map(row => [row]);
}

/**
 * 从文本内容生成 Excel Blob（智能解析格式）
 * @param content 文本内容
 */
export function generateXlsxFromContent(content: string): Blob {
  const rows = parseContentToRows(content);
  return generateXlsx(rows);
}

/**
 * 从文本内容生成 Word Blob
 * @param content 文本内容，按行分割为段落
 */
export async function generateDocx(content: string): Promise<Blob> {
  const paragraphs = content.split('\n').map(line =>
    new Paragraph({ children: [new TextRun(line)] })
  );
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBlob(doc);
}

/**
 * 从文本内容生成 PDF Blob
 * @param content 文本内容
 */
export function generatePdf(content: string): Blob {
  const doc = new jsPDF();
  const lines = doc.splitTextToSize(content, 180);
  doc.text(lines, 10, 10);
  return doc.output('blob');
}

/**
 * 从 Markdown 文本生成 PDF Blob（保留基本格式，支持中文）
 * @param markdown Markdown 文本
 */
export function generatePdfFromMarkdown(markdown: string): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let y = 10;
  const lineHeight = 7;
  const pageHeight = 280;
  const maxWidth = 180;

  // 设置支持中文的字体（使用内置的 Helvetica 作为后备）
  doc.setFont('helvetica');

  const lines = markdown.split('\n');

  for (const line of lines) {
    // 检查是否需要换页
    if (y > pageHeight) {
      doc.addPage();
      y = 10;
    }

    // 跳过 Markdown 格式符号，提取纯文本
    let text = line;
    let fontSize = 10;
    let isBold = false;

    // 标题处理
    if (text.startsWith('### ')) {
      text = text.replace(/^### /, '');
      fontSize = 12;
      isBold = true;
    } else if (text.startsWith('## ')) {
      text = text.replace(/^## /, '');
      fontSize = 14;
      isBold = true;
    } else if (text.startsWith('# ')) {
      text = text.replace(/^# /, '');
      fontSize = 18;
      isBold = true;
    } else if (text.startsWith('- ') || text.startsWith('* ')) {
      text = '  • ' + text.replace(/^[-*] /, '');
    } else if (text.startsWith('---') || text.startsWith('***')) {
      // 分隔线
      doc.setDrawColor(200, 200, 200);
      doc.line(10, y, 200, y);
      y += lineHeight;
      continue;
    }

    // 移除 Markdown 格式符号
    text = text
      .replace(/\*\*(.*?)\*\*/g, '$1')  // 粗体
      .replace(/\*(.*?)\*/g, '$1')      // 斜体
      .replace(/`(.*?)`/g, '$1')        // 行内代码
      .replace(/\[(.*?)\]\(.*?\)/g, '$1'); // 链接

    doc.setFontSize(fontSize);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');

    // 使用 splitTextToSize 处理长文本自动换行
    const splitText = doc.splitTextToSize(text, maxWidth);
    doc.text(splitText, 10, y);
    y += splitText.length * (lineHeight * fontSize / 10);

    // 标题后额外间距
    if (isBold) {
      y += 3;
    }
  }

  return doc.output('blob');
}

/**
 * dataUrl base64 转 Blob
 * @param dataUrl base64 数据 URL
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Canvas 转 Blob
 * @param canvas Canvas 元素
 * @param type 图片类型，默认 'image/png'
 * @param quality 图片质量（0-1），仅对 jpeg 有效
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality = 1
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas to Blob conversion failed'));
        }
      },
      type,
      quality
    );
  });
}

// ============ 下载工具 ============

/**
 * 触发浏览器下载
 * @param blob 文件 Blob
 * @param filename 文件名
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 从 dataUrl 触发下载
 * @param dataUrl base64 数据 URL
 * @param filename 文件名
 */
export function triggerDownloadFromDataUrl(dataUrl: string, filename: string): void {
  const blob = dataUrlToBlob(dataUrl);
  triggerDownload(blob, filename);
}

/**
 * 从 URL 触发下载
 * @param url 文件 URL
 * @param filename 文件名
 */
export function triggerDownloadFromUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ============ 格式化工具 ============

/**
 * 格式化字节数为可读字符串
 * @param bytes 字节数
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * 格式化 JSON 字符串
 * @param json JSON 字符串
 * @param indent 缩进空格数
 */
export function formatJson(json: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(json), null, indent);
  } catch {
    return json;
  }
}

// ============ 文本白名单 ============

/** 可直接作为文本下载的扩展名 */
export const TEXT_EXTENSIONS = new Set([
  // 标记语言
  'txt', 'md', 'html', 'htm', 'xml', 'svg',
  // 样式
  'css', 'scss', 'less', 'sass',
  // 脚本
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  // 编程语言
  'py', 'java', 'go', 'rs', 'rb', 'php', 'pl', 'swift', 'kt', 'scala',
  'c', 'cpp', 'h', 'hpp', 'cs', 'dart', 'lua', 'r', 'm',
  // Shell
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1',
  // 数据
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  // 数据库
  'sql', 'graphql', 'gql',
  // 其他
  'log', 'diff', 'patch', 'gitignore', 'dockerignore',
  'makefile', 'dockerfile', 'editorconfig',
]);

/**
 * 检查扩展名是否为文本类型
 * @param ext 扩展名（不含点号）
 */
export function isTextExtension(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * 获取文件的 MIME 类型
 * @param ext 扩展名（不含点号）
 */
export function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    // 文本
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    htm: 'text/html',
    xml: 'text/xml',
    svg: 'image/svg+xml',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    json: 'application/json',
    yaml: 'text/yaml',
    yml: 'text/yml',
    csv: 'text/csv',
    // 图片
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    // 文档
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 压缩
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
  };
  return mimeTypes[ext.toLowerCase()] ?? 'application/octet-stream';
}
