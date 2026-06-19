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
import html2canvas from 'html2canvas-pro';

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
 * Markdown 转 HTML（简易解析）
 */
function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // 代码块
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html.push('</code></pre>');
        inCodeBlock = false;
      } else {
        html.push('<pre><code>');
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      continue;
    }

    // 标题
    if (line.startsWith('### ')) {
      html.push(`<h3>${line.slice(4)}</h3>`);
    } else if (line.startsWith('## ')) {
      html.push(`<h2>${line.slice(3)}</h2>`);
    } else if (line.startsWith('# ')) {
      html.push(`<h1>${line.slice(2)}</h1>`);
    } else if (line.startsWith('---') || line.startsWith('***')) {
      html.push('<hr>');
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      html.push(`<li>${line.slice(2)}</li>`);
    } else if (line.trim() === '') {
      html.push('<br>');
    } else {
      html.push(`<p>${line}</p>`);
    }
  }

  // 清理 markdown 标记
  return html
    .join('\n')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\(.*?\)/g, '<a>$1</a>');
}

/**
 * HTML 渲染为 canvas 并生成 PDF Blob
 *
 * 隔离策略：scoped 类名前缀 + !important，不污染主页面。
 * 分页策略：一次性截完整 canvas，再按 A4 高度逐页切分写入 PDF。
 *           自动降 scale 避免浏览器 canvas 高度上限(16384px)截断。
 */
async function htmlToPdf(htmlContent: string): Promise<Blob> {
  const A4_W = 210;
  const A4_H = 297;
  const PAD = 8;
  const WIDTH_PX = 794;
  const A4_PAGE_PX = 1123; // A4 高度 @ 96dpi

  // 注入 scoped 样式
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .aib-pdf-root h1 { font-size: 24px; font-weight: bold; margin: 16px 0 12px; }
    .aib-pdf-root h2 { font-size: 20px; font-weight: bold; margin: 14px 0 10px; }
    .aib-pdf-root h3 { font-size: 17px; font-weight: bold; margin: 12px 0 8px; }
    .aib-pdf-root p { margin: 6px 0; }
    .aib-pdf-root li { margin: 4px 0; padding-left: 16px; list-style: disc; }
    .aib-pdf-root pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 8px 0; }
    .aib-pdf-root code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-family: "Cascadia Code", "Fira Code", Consolas, monospace; font-size: 13px; }
    .aib-pdf-root pre code { background: none; padding: 0; }
    .aib-pdf-root hr { border: none; border-top: 1px solid #ddd; margin: 12px 0; }
    .aib-pdf-root a { color: #2563eb; text-decoration: none; }
    .aib-pdf-root strong { font-weight: bold; }
    .aib-pdf-root em { font-style: italic; }
  `;
  document.head.appendChild(styleEl);

  // 容器：absolute 正常文档流，不可见但在 DOM 中可渲染
  const container = document.createElement('div');
  container.className = 'aib-pdf-root';
  container.style.cssText = `
    position: absolute !important;
    left: -9999px !important;
    top: 0 !important;
    display: block !important;
    box-sizing: border-box !important;
    width: ${WIDTH_PX}px;
    padding: 40px;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif !important;
    font-size: 14px !important;
    line-height: 1.8 !important;
    color: #1a1a1a !important;
    background: #ffffff;
    word-wrap: break-word;
    overflow-wrap: break-word;
  `;
  container.innerHTML = htmlContent;
  document.body.appendChild(container);

  try {
    // 等待 DOM 渲染完成
    await new Promise(r => setTimeout(r, 300));
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const totalHeight = container.scrollHeight;

    // 自动选 scale：确保 canvas 高度不超过 16384px
    const MAX_CANVAS = 16384;
    let scale = 2;
    if (totalHeight * scale > MAX_CANVAS) {
      scale = Math.floor(MAX_CANVAS / totalHeight * 10) / 10; // 向下取整一位
      scale = Math.max(1, scale); // 最低 1x
    }

    // 一次性截完整 canvas
    const canvas = await html2canvas(container, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    // 按 A4 高度逐页切分
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const srcPageH = A4_PAGE_PX * scale; // canvas 中每页对应的高度(px)
    const totalPages = Math.ceil(canvas.height / srcPageH);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) doc.addPage();

      const sliceH = Math.min(srcPageH, canvas.height - page * srcPageH);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceH;

      pageCanvas.getContext('2d')!.drawImage(
        canvas,
        0, page * srcPageH,
        canvas.width, sliceH,
        0, 0,
        canvas.width, sliceH,
      );

      const imgW = A4_W - PAD * 2;
      const imgH = (sliceH / srcPageH) * (A4_H - PAD * 2); // 按比例算 PDF 高度
      doc.addImage(pageCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', PAD, PAD, imgW, imgH);
    }

    return doc.output('blob');
  } finally {
    document.body.removeChild(container);
    document.head.removeChild(styleEl);
  }
}

/**
 * 从文本内容生成 PDF Blob（canvas 截图）
 * @param content 纯文本
 */
export async function generatePdf(content: string): Promise<Blob> {
  const html = content
    .split('\n')
    .map(line => line.trim() === '' ? '<br>' : `<p>${line}</p>`)
    .join('\n');
  return htmlToPdf(html);
}

/**
 * 从 Markdown 文本生成 PDF Blob（canvas 截图）
 * @param markdown Markdown 文本
 */
export async function generatePdfFromMarkdown(markdown: string): Promise<Blob> {
  const html = markdownToHtml(markdown);
  return htmlToPdf(html);
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
